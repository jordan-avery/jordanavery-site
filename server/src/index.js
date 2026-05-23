import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { createFullDeck, shuffle, getCardTypeKey } from './deck.js';
import { canPlayOnTurn, canPlayOutOfTurn, canStackDraw, hasEligibleCard, canPlayInStarting } from './rules.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');
const STATS_FILE = join(DATA_DIR, 'stats.json');
const SIGS_FILE = join(DATA_DIR, 'signatures.json');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const loadJSON = (file, def) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return def; }
};
const saveJSON = (file, data) => { try { writeFileSync(file, JSON.stringify(data, null, 2)); } catch {} };

let stats = loadJSON(STATS_FILE, {});
let signatures = loadJSON(SIGS_FILE, {});

const PASSWORD = process.env.GAME_PASSWORD || 'whitecarnation';
const PORT = parseInt(process.env.PORT || '3001');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_ROOMS = 2;
const HAND_SIZE = 7;
const DRAW_TIMER_MS = 10000;
const UNO_WINDOW_MS = 5000;

const rooms = new Map();
const socketToRoom = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function getPlayer(room, socketId) {
  return room.players.find(p => p.socketId === socketId);
}

function getPlayerIndex(room, socketId) {
  return room.players.findIndex(p => p.socketId === socketId);
}

function nextIdx(room, fromIndex) {
  const n = room.players.length;
  return ((fromIndex + room.game.direction) % n + n) % n;
}

function clearGameTimers(room) {
  if (!room.game) return;
  const g = room.game;
  if (g.pendingDraw?.timerId) { clearTimeout(g.pendingDraw.timerId); g.pendingDraw.timerId = null; }
  if (g.unoState?.timerId) { clearTimeout(g.unoState.timerId); g.unoState.timerId = null; }
}

// ─── Draw cards (reshuffle discard if needed) ─────────────────────────────

function drawCards(game, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (game.deck.length === 0) {
      if (game.discardPile.length <= 1) break;
      const top = game.discardPile[game.discardPile.length - 1];
      game.deck = shuffle(game.discardPile.slice(0, -1));
      game.discardPile = [top];
    }
    if (game.deck.length > 0) drawn.push(game.deck.pop());
  }
  return drawn;
}

// ─── State serialization ──────────────────────────────────────────────────

function serializeCard(card) {
  const typeKey = getCardTypeKey(card);
  return {
    id: card.id,
    color: card.color,
    type: card.type,
    value: card.value,
    typeKey,
    signatures: signatures[typeKey] || [],
  };
}

function buildPublicState(room) {
  const g = room.game;
  return {
    code: room.code,
    status: room.status,
    hostSocketId: room.hostSocketId,
    players: room.players.map((p, i) => ({
      socketId: p.socketId,
      name: p.name,
      cardCount: p.hand.length,
      hasCalledUno: p.hasCalledUno,
      unoEligible: p.unoEligible,
      index: i,
    })),
    spectators: room.spectators.map(s => ({ socketId: s.socketId, name: s.name })),
    game: g ? {
      phase: g.phase,
      topCard: g.topCard ? serializeCard(g.topCard) : null,
      currentColor: g.currentColor,
      currentPlayerIndex: g.currentPlayerIndex,
      direction: g.direction,
      deckCount: g.deck.length,
      pendingDraw: g.pendingDraw ? {
        amount: g.pendingDraw.amount,
        type: g.pendingDraw.type,
        targetIndex: g.pendingDraw.targetIndex,
        endsAt: g.pendingDraw.endsAt,
      } : null,
      slapState: g.slapState ? {
        slappers: g.slapState.slappers,
        active: g.slapState.active,
      } : null,
      helpState: g.helpState ? {
        requestingPlayerId: g.helpState.requestingPlayerId,
        offers: g.helpState.offers.map(o => ({
          fromPlayerId: o.fromPlayerId,
          fromPlayerName: room.players.find(p => p.socketId === o.fromPlayerId)?.name || '',
        })),
      } : null,
      zeroTradeState: g.zeroTradeState || null,
      wildPlayerId: g.wildPlayerId || null,
      winner: g.winner || null,
      winnerName: g.winner ? room.players.find(p => p.socketId === g.winner)?.name : null,
      winnerCard: g.winnerCard ? serializeCard(g.winnerCard) : null,
      unoState: g.unoState ? {
        playerId: g.unoState.playerId,
        playerName: room.players.find(p => p.socketId === g.unoState.playerId)?.name || '',
        expired: g.unoState.expired,
      } : null,
      startingState: g.startingState || null,
    } : null,
  };
}

function broadcastRoomState(io, room) {
  const pub = buildPublicState(room);
  for (const p of room.players) {
    io.to(p.socketId).emit('room-state', pub);
    if (room.game) io.to(p.socketId).emit('your-hand', p.hand.map(serializeCard));
  }
  for (const s of room.spectators) {
    io.to(s.socketId).emit('room-state', pub);
  }
}

// ─── UNO timer ────────────────────────────────────────────────────────────

function startUnoTimer(io, room, playerId) {
  const player = getPlayer(room, playerId);
  if (!player || player.hand.length !== 1) return;
  player.unoEligible = true;
  if (room.game.unoState?.timerId) clearTimeout(room.game.unoState.timerId);
  room.game.unoState = {
    playerId,
    expired: false,
    timerId: setTimeout(() => {
      if (!room.game || room.game.unoState?.playerId !== playerId) return;
      const p = getPlayer(room, playerId);
      if (p && !p.hasCalledUno && p.hand.length === 1) {
        room.game.unoState.expired = true;
        room.game.unoState.timerId = null;
        broadcastRoomState(io, room);
      }
    }, UNO_WINDOW_MS),
  };
}

// ─── Pending draw timer ───────────────────────────────────────────────────

function startPendingDrawTimer(io, room) {
  const g = room.game;
  if (g.pendingDraw.timerId) clearTimeout(g.pendingDraw.timerId);
  const endsAt = Date.now() + DRAW_TIMER_MS;
  g.pendingDraw.endsAt = endsAt;
  g.pendingDraw.timerId = setTimeout(() => {
    if (!room.game || room.game.phase !== 'pending-draw') return;
    resolvePendingDraw(io, room);
  }, DRAW_TIMER_MS);
}

function resolvePendingDraw(io, room) {
  const g = room.game;
  if (!g || !g.pendingDraw) return;
  if (g.pendingDraw.timerId) { clearTimeout(g.pendingDraw.timerId); g.pendingDraw.timerId = null; }
  const targetIdx = g.pendingDraw.targetIndex;
  const targetPlayer = room.players[targetIdx];
  if (targetPlayer) {
    const drawn = drawCards(g, g.pendingDraw.amount);
    targetPlayer.hand.push(...drawn);
  }
  g.pendingDraw = null;
  g.phase = 'playing';
  g.currentPlayerIndex = nextIdx(room, targetIdx);
  broadcastRoomState(io, room);
}

// ─── Win handler ──────────────────────────────────────────────────────────

function handleWin(io, room, socketId, lastCard) {
  const g = room.game;
  clearGameTimers(room);
  g.phase = 'winner';
  g.winner = socketId;
  g.winnerCard = lastCard;
  const winnerPlayer = getPlayer(room, socketId);
  if (winnerPlayer) {
    const name = winnerPlayer.name;
    stats[name] = (stats[name] || 0) + 1;
    saveJSON(STATS_FILE, stats);
  }
  broadcastRoomState(io, room);
}

// ─── Apply card effects ───────────────────────────────────────────────────

function applyCardEffect(io, room, card, playerIdx) {
  const g = room.game;
  const n = room.players.length;

  if (card.type === 'skip') {
    const skipped = nextIdx(room, playerIdx);
    g.currentPlayerIndex = nextIdx(room, skipped);
  } else if (card.type === 'reverse') {
    g.direction *= -1;
    if (n === 2) {
      // acts like skip in 2-player
      g.currentPlayerIndex = nextIdx(room, nextIdx(room, playerIdx));
    } else {
      g.currentPlayerIndex = nextIdx(room, playerIdx);
    }
  } else if (card.type === 'draw2') {
    const target = nextIdx(room, playerIdx);
    if (g.pendingDraw) {
      g.pendingDraw.amount += 2;
      g.pendingDraw.targetIndex = nextIdx(room, playerIdx);
    } else {
      g.pendingDraw = { amount: 2, type: '+2', targetIndex: target, timerId: null, endsAt: 0 };
    }
    g.phase = 'pending-draw';
    g.currentPlayerIndex = target;
    startPendingDrawTimer(io, room);
    return;
  } else if (card.type === 'wild4') {
    const target = nextIdx(room, playerIdx);
    if (g.pendingDraw) {
      g.pendingDraw.amount += 4;
      g.pendingDraw.targetIndex = nextIdx(room, playerIdx);
    } else {
      g.pendingDraw = { amount: 4, type: '+4', targetIndex: target, timerId: null, endsAt: 0 };
    }
    g.phase = 'pending-draw';
    g.currentPlayerIndex = target;
    startPendingDrawTimer(io, room);
    return;
  } else if (card.type === 'number' && card.value === 0) {
    g.phase = 'zero-trade';
    g.zeroTradeState = { initiatorSocketId: room.players[playerIdx].socketId };
    return;
  } else if (card.type === 'number' && card.value === 6) {
    g.slapState = { slappers: [], active: true, resumePlayerIndex: nextIdx(room, playerIdx) };
    g.phase = 'slap';
    return;
  } else {
    g.currentPlayerIndex = nextIdx(room, playerIdx);
  }
}

// ─── Core play card ───────────────────────────────────────────────────────

function executePlay(io, room, socketId, card, chosenColor) {
  const g = room.game;
  const player = getPlayer(room, socketId);
  const playerIdx = getPlayerIndex(room, socketId);

  player.hand = player.hand.filter(c => c.id !== card.id);
  g.discardPile.push(card);
  g.topCard = card;

  if (card.type === 'wild' || card.type === 'wild4') {
    g.currentColor = chosenColor || 'red';
  } else {
    g.currentColor = card.color;
  }

  // Cancel help state if this player was requesting or the card came from help
  if (g.helpState && g.helpState.requestingPlayerId === socketId) {
    g.helpState = null;
    g.phase = 'playing';
  }

  // Clear any uno state for this player since they played
  if (g.unoState?.playerId === socketId) {
    if (g.unoState.timerId) clearTimeout(g.unoState.timerId);
    g.unoState = null;
  }
  player.unoEligible = false;
  player.hasCalledUno = false;

  if (player.hand.length === 0) {
    handleWin(io, room, socketId, card);
    return;
  }

  if (player.hand.length === 1) {
    startUnoTimer(io, room, socketId);
  }

  applyCardEffect(io, room, card, playerIdx);
  if (g.phase === 'playing') g.phase = 'playing';
  broadcastRoomState(io, room);
}

// ─── Starting phase logic ─────────────────────────────────────────────────

function handleStartingPlay(io, room, socketId, card, chosenColor) {
  const g = room.game;
  const player = getPlayer(room, socketId);
  const playerIdx = getPlayerIndex(room, socketId);
  const n = room.players.length;

  if (!canPlayInStarting(card, g.currentColor, g.topCard)) {
    return { error: 'Card is not eligible to play' };
  }

  player.hand = player.hand.filter(c => c.id !== card.id);
  g.discardPile.push(card);
  g.topCard = card;
  g.currentColor = (card.type === 'wild' || card.type === 'wild4')
    ? (chosenColor || g.currentColor)
    : card.color;

  if (player.hand.length === 0) { handleWin(io, room, socketId, card); return {}; }
  if (player.hand.length === 1) startUnoTimer(io, room, socketId);

  if (g.startingState.firstPlayerIndex === -1) {
    g.startingState.firstPlayerIndex = playerIdx;
    if (n === 2) {
      g.direction = 1;
      g.currentPlayerIndex = (playerIdx + 1) % n;
      g.phase = 'playing';
      g.startingState = null;
    }
    // else: wait for a neighbor to play to determine direction
  } else {
    // Second play — determine direction
    const first = g.startingState.firstPlayerIndex;
    const rightNeighbor = (first + 1) % n;
    g.direction = playerIdx === rightNeighbor ? 1 : -1;
    g.currentPlayerIndex = playerIdx;
    g.phase = 'playing';
    g.startingState = null;
    // Apply next turn (starting cards have no action effects)
    g.currentPlayerIndex = nextIdx(room, playerIdx);
  }

  broadcastRoomState(io, room);
  return {};
}

// ─── Socket.io setup ──────────────────────────────────────────────────────

const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (CORS_ORIGIN === '*' || origin === CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN, methods: ['GET', 'POST'] },
});

app.get('/health', (_, res) => res.json({ ok: true }));

io.on('connection', (socket) => {

  // ── Auth ──
  socket.on('authenticate', (password) => {
    socket.emit('auth-result', { ok: password === PASSWORD });
  });

  // ── Stats ──
  socket.on('get-stats', () => {
    socket.emit('stats', stats);
  });

  // ── Create room ──
  socket.on('create-room', ({ playerName }) => {
    if (rooms.size >= MAX_ROOMS) {
      return socket.emit('room-error', 'All rooms are currently full. Try again later.');
    }
    const existingRoom = rooms.get(socketToRoom.get(socket.id));
    if (existingRoom) leaveRoom(io, socket);

    const code = generateCode();
    const room = {
      code,
      hostSocketId: socket.id,
      status: 'lobby',
      players: [{ socketId: socket.id, name: playerName, hand: [], hasCalledUno: false, unoEligible: false }],
      spectators: [],
      game: null,
    };
    rooms.set(code, room);
    socketToRoom.set(socket.id, code);
    socket.join(code);
    broadcastRoomState(io, room);
  });

  // ── Join room ──
  socket.on('join-room', ({ code, playerName }) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return socket.emit('room-error', 'Room not found.');

    const existingRoom = rooms.get(socketToRoom.get(socket.id));
    if (existingRoom) leaveRoom(io, socket);

    socketToRoom.set(socket.id, room.code);
    socket.join(room.code);

    if (room.status === 'playing' || room.status === 'ended') {
      room.spectators.push({ socketId: socket.id, name: playerName });
    } else {
      room.players.push({ socketId: socket.id, name: playerName, hand: [], hasCalledUno: false, unoEligible: false });
    }
    broadcastRoomState(io, room);
  });

  // ── Leave room ──
  socket.on('leave-room', () => leaveRoom(io, socket));

  // ── Start game ──
  socket.on('start-game', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('room-error', 'Need at least 2 players.');
    if (room.status === 'playing') return;

    // Shuffle player order
    for (let i = room.players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
    }

    const deck = shuffle(createFullDeck());
    const hands = room.players.map(() => []);
    for (let i = 0; i < HAND_SIZE; i++) {
      for (const hand of hands) hand.push(deck.pop());
    }
    room.players.forEach((p, i) => { p.hand = hands[i]; p.hasCalledUno = false; p.unoEligible = false; });

    // Draw starting card (skip wilds)
    let topCard;
    do { topCard = deck.pop(); if (topCard.type === 'wild' || topCard.type === 'wild4') deck.unshift(topCard); }
    while (topCard.type === 'wild' || topCard.type === 'wild4');

    room.status = 'playing';
    room.game = {
      phase: 'starting',
      deck,
      discardPile: [topCard],
      topCard,
      currentColor: topCard.color,
      currentPlayerIndex: -1,
      direction: 1,
      pendingDraw: null,
      slapState: null,
      helpState: null,
      zeroTradeState: null,
      wildPlayerId: null,
      winner: null,
      winnerCard: null,
      unoState: null,
      startingState: { firstPlayerIndex: -1 },
    };
    broadcastRoomState(io, room);
  });

  // ── Play card ──
  socket.on('play-card', ({ cardId, chosenColor }) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.status !== 'playing') return;
    const player = getPlayer(room, socket.id);
    if (!player) return;
    const card = player.hand.find(c => c.id === cardId);
    if (!card) return socket.emit('game-error', 'Card not in hand.');
    const g = room.game;
    const playerIdx = getPlayerIndex(room, socket.id);
    const isMyTurn = playerIdx === g.currentPlayerIndex;

    // Starting phase
    if (g.phase === 'starting') {
      const first = g.startingState.firstPlayerIndex;
      if (first !== -1) {
        const n = room.players.length;
        const left = (first - 1 + n) % n;
        const right = (first + 1) % n;
        if (playerIdx !== left && playerIdx !== right) {
          return socket.emit('game-error', 'Wait for direction to be set.');
        }
      }
      const result = handleStartingPlay(io, room, socket.id, card, chosenColor);
      if (result?.error) socket.emit('game-error', result.error);
      return;
    }

    // Pending-draw: only stacking allowed
    if (g.phase === 'pending-draw') {
      if (!canStackDraw(card, g.pendingDraw.type)) {
        return socket.emit('game-error', 'Can only stack a matching draw card.');
      }
      if (g.pendingDraw.timerId) { clearTimeout(g.pendingDraw.timerId); g.pendingDraw.timerId = null; }
      // Wild4 stacker picks color
      const color = (card.type === 'wild4') ? (chosenColor || g.currentColor) : card.color;
      g.currentColor = color;
      executePlay(io, room, socket.id, card, color);
      return;
    }

    // Slap / zero-trade / winner phases block regular play
    if (['slap', 'zero-trade', 'winner'].includes(g.phase)) {
      return socket.emit('game-error', 'Cannot play right now.');
    }

    // Help phase: the requestor may play a card they just received
    if (g.phase === 'help' && g.helpState?.requestingPlayerId !== socket.id) {
      return socket.emit('game-error', 'Not your turn.');
    }

    if (isMyTurn || g.phase === 'help') {
      if (!canPlayOnTurn(card, g.currentColor, g.topCard, null)) {
        return socket.emit('game-error', 'Cannot play that card.');
      }
      if (g.phase === 'help') g.phase = 'playing';
      executePlay(io, room, socket.id, card, chosenColor);
    } else {
      // Out-of-turn play
      if (!canPlayOutOfTurn(card, g.topCard, g.currentColor)) {
        return socket.emit('game-error', 'That card cannot be played out of turn.');
      }
      // Update current player context so effects are relative to this player
      g.currentPlayerIndex = playerIdx;
      executePlay(io, room, socket.id, card, chosenColor);
    }
  });

  // ── Draw card ──
  socket.on('draw-card', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.status !== 'playing') return;
    const g = room.game;
    const playerIdx = getPlayerIndex(room, socket.id);
    if (playerIdx !== g.currentPlayerIndex) return socket.emit('game-error', 'Not your turn.');
    if (!['playing', 'help'].includes(g.phase)) return socket.emit('game-error', 'Cannot draw right now.');

    const player = getPlayer(room, socket.id);
    if (hasEligibleCard(player.hand, g.currentColor, g.topCard, null)) {
      return socket.emit('game-error', 'You have a playable card — you must play it.');
    }

    if (g.helpState?.requestingPlayerId === socket.id) {
      g.helpState = null;
      g.phase = 'playing';
    }

    const drawn = drawCards(g, 1);
    if (drawn.length === 0) {
      // No cards left anywhere — pass turn
      g.currentPlayerIndex = nextIdx(room, playerIdx);
      broadcastRoomState(io, room);
      return;
    }
    player.hand.push(...drawn);

    const drawnCard = drawn[0];
    if (canPlayOnTurn(drawnCard, g.currentColor, g.topCard, null)) {
      socket.emit('must-play', serializeCard(drawnCard));
    } else if (!hasEligibleCard(player.hand, g.currentColor, g.topCard, null)) {
      // Still can't play — send updated hand, player can draw again
    } else {
      // Now has an eligible card in hand (pre-existing)
      socket.emit('must-play', null);
    }

    if (player.hand.length === 1) startUnoTimer(io, room, socket.id);
    broadcastRoomState(io, room);
  });

  // ── Request help ──
  socket.on('request-help', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.status !== 'playing') return;
    const g = room.game;
    const playerIdx = getPlayerIndex(room, socket.id);
    if (playerIdx !== g.currentPlayerIndex) return socket.emit('game-error', 'Not your turn.');
    if (g.phase !== 'playing') return socket.emit('game-error', 'Cannot request help right now.');
    const player = getPlayer(room, socket.id);
    if (hasEligibleCard(player.hand, g.currentColor, g.topCard, null)) {
      return socket.emit('game-error', 'You have a playable card.');
    }
    g.phase = 'help';
    g.helpState = { requestingPlayerId: socket.id, offers: [] };
    broadcastRoomState(io, room);
  });

  // ── Offer help ──
  socket.on('offer-help', ({ cardId }) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || !room.game?.helpState) return;
    const g = room.game;
    if (g.helpState.requestingPlayerId === socket.id) return;
    const player = getPlayer(room, socket.id);
    if (!player) return;
    const card = player.hand.find(c => c.id === cardId);
    if (!card) return;
    // Replace existing offer from this player
    g.helpState.offers = g.helpState.offers.filter(o => o.fromPlayerId !== socket.id);
    g.helpState.offers.push({ fromPlayerId: socket.id, cardId: card.id, card });
    broadcastRoomState(io, room);
  });

  // ── Withdraw help offer ──
  socket.on('withdraw-help-offer', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || !room.game?.helpState) return;
    room.game.helpState.offers = room.game.helpState.offers.filter(o => o.fromPlayerId !== socket.id);
    broadcastRoomState(io, room);
  });

  // ── Accept help ──
  socket.on('accept-help', ({ fromPlayerId }) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || !room.game?.helpState) return;
    const g = room.game;
    if (g.helpState.requestingPlayerId !== socket.id) return;
    const offer = g.helpState.offers.find(o => o.fromPlayerId === fromPlayerId);
    if (!offer) return socket.emit('game-error', 'Offer not found.');

    const fromPlayer = getPlayer(room, fromPlayerId);
    const toPlayer = getPlayer(room, socket.id);
    if (!fromPlayer || !toPlayer) return;

    fromPlayer.hand = fromPlayer.hand.filter(c => c.id !== offer.cardId);
    toPlayer.hand.push(offer.card);
    g.helpState = null;

    if (canPlayOnTurn(offer.card, g.currentColor, g.topCard, null)) {
      g.phase = 'help'; // stay in help phase so player can play the received card
      g.helpState = { requestingPlayerId: socket.id, offers: [] };
      socket.emit('must-play', serializeCard(offer.card));
    } else {
      g.phase = 'help'; // still on their turn, can draw or ask again
      g.helpState = { requestingPlayerId: socket.id, offers: [] };
    }

    io.to(fromPlayerId).emit('your-hand', fromPlayer.hand.map(serializeCard));
    if (fromPlayer.hand.length === 1) startUnoTimer(io, room, fromPlayerId);
    if (fromPlayer.hand.length === 0) { handleWin(io, room, fromPlayerId, null); return; }
    broadcastRoomState(io, room);
  });

  // ── Slap ──
  socket.on('slap', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || !room.game?.slapState?.active) return;
    const g = room.game;
    if (g.slapState.slappers.includes(socket.id)) return;
    g.slapState.slappers.push(socket.id);
    const n = room.players.length + room.spectators.length;
    const totalEligible = room.players.length;
    if (g.slapState.slappers.length >= totalEligible - 1) {
      // Find who didn't slap
      const lastSlapperName = room.players.find(p => p.socketId === g.slapState.slappers[g.slapState.slappers.length - 1])?.name || '?';
      const loser = room.players.find(p => !g.slapState.slappers.includes(p.socketId));
      if (loser) {
        const penalty = drawCards(g, 2);
        loser.hand.push(...penalty);
        io.to(loser.socketId).emit('your-hand', loser.hand.map(serializeCard));
      }
      const resumeIdx = g.slapState.resumePlayerIndex;
      g.slapState = null;
      g.phase = 'playing';
      g.currentPlayerIndex = resumeIdx;
      io.to(room.code).emit('slap-result', {
        loserName: loser?.name || '?',
        lastSlapperName,
      });
      broadcastRoomState(io, room);
    } else {
      broadcastRoomState(io, room);
    }
  });

  // ── Declare UNO ──
  socket.on('declare-uno', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || !room.game) return;
    const g = room.game;
    const player = getPlayer(room, socket.id);
    if (!player || player.hand.length !== 1 || !player.unoEligible) return;
    if (g.unoState?.timerId) { clearTimeout(g.unoState.timerId); g.unoState.timerId = null; }
    player.hasCalledUno = true;
    player.unoEligible = false;
    g.unoState = null;
    io.to(room.code).emit('uno-declared', { playerName: player.name });
    broadcastRoomState(io, room);
  });

  // ── Penalize UNO (another player catches them) ──
  socket.on('penalize-uno', ({ targetPlayerId }) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || !room.game?.unoState) return;
    const g = room.game;
    if (!g.unoState.expired) return;
    if (g.unoState.playerId !== targetPlayerId) return;
    const target = getPlayer(room, targetPlayerId);
    if (!target || target.hand.length !== 1 || target.hasCalledUno) return;
    const penalty = drawCards(g, 2);
    target.hand.push(...penalty);
    target.unoEligible = false;
    if (g.unoState.timerId) clearTimeout(g.unoState.timerId);
    g.unoState = null;
    io.to(targetPlayerId).emit('your-hand', target.hand.map(serializeCard));
    io.to(room.code).emit('uno-penalized', { playerName: target.name, catcherName: room.players.find(p => p.socketId === socket.id)?.name || '?' });
    broadcastRoomState(io, room);
  });

  // ── Zero card trade ──
  socket.on('trade-hand', ({ targetPlayerId }) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.game?.phase !== 'zero-trade') return;
    const g = room.game;
    if (g.zeroTradeState.initiatorSocketId !== socket.id) return;
    const initiator = getPlayer(room, socket.id);
    const target = getPlayer(room, targetPlayerId);
    if (!initiator || !target) return;
    [initiator.hand, target.hand] = [target.hand, initiator.hand];
    g.zeroTradeState = null;
    g.phase = 'playing';
    const initiatorIdx = getPlayerIndex(room, socket.id);
    g.currentPlayerIndex = nextIdx(room, initiatorIdx);
    io.to(targetPlayerId).emit('your-hand', target.hand.map(serializeCard));
    io.to(socket.id).emit('your-hand', initiator.hand.map(serializeCard));
    broadcastRoomState(io, room);
  });

  socket.on('keep-hand', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.game?.phase !== 'zero-trade') return;
    const g = room.game;
    if (g.zeroTradeState.initiatorSocketId !== socket.id) return;
    const initiatorIdx = getPlayerIndex(room, socket.id);
    g.zeroTradeState = null;
    g.phase = 'playing';
    g.currentPlayerIndex = nextIdx(room, initiatorIdx);
    broadcastRoomState(io, room);
  });

  // ── Draw for me (pending draw) ──
  socket.on('draw-for-me', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.game?.phase !== 'pending-draw') return;
    const g = room.game;
    const playerIdx = getPlayerIndex(room, socket.id);
    if (playerIdx !== g.pendingDraw.targetIndex) return socket.emit('game-error', 'Not your draw.');
    resolvePendingDraw(io, room);
  });

  // ── Sign winning card ──
  socket.on('sign-card', ({ text, drawing }) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || !room.game || room.game.phase !== 'winner') return;
    if (room.game.winner !== socket.id) return;
    const winnerCard = room.game.winnerCard;
    if (!winnerCard) return;
    const typeKey = getCardTypeKey(winnerCard);
    const winner = getPlayer(room, socket.id);
    if (!signatures[typeKey]) signatures[typeKey] = [];
    signatures[typeKey].push({ winner: winner?.name || '?', text: text || null, drawing: drawing || null, date: new Date().toISOString() });
    saveJSON(SIGS_FILE, signatures);
    room.game.winnerCard = { ...winnerCard };
    broadcastRoomState(io, room);
    io.to(room.code).emit('card-signed', {
      typeKey,
      signatures: signatures[typeKey],
      winnerName: winner?.name,
    });
  });

  // ── Start new game ──
  socket.on('start-new-game', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.game?.phase !== 'winner') return;
    clearGameTimers(room);
    room.game = null;
    // Move any spectators who want to play back to players? No — just clear game
    // The host can start game again from lobby state
    room.status = 'lobby';
    broadcastRoomState(io, room);
  });

  socket.on('return-to-lobby', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.hostSocketId !== socket.id) return;
    clearGameTimers(room);
    room.game = null;
    room.status = 'lobby';
    broadcastRoomState(io, room);
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    leaveRoom(io, socket, true);
  });
});

// ─── Leave room helper ────────────────────────────────────────────────────

function leaveRoom(io, socket, isDisconnect = false) {
  const code = socketToRoom.get(socket.id);
  if (!code) return;
  const room = rooms.get(code);
  if (!room) { socketToRoom.delete(socket.id); return; }

  socketToRoom.delete(socket.id);
  socket.leave(code);

  const isHost = room.hostSocketId === socket.id;

  // Remove from spectators
  room.spectators = room.spectators.filter(s => s.socketId !== socket.id);

  // Remove from players
  const playerIdx = room.players.findIndex(p => p.socketId === socket.id);
  if (playerIdx !== -1) {
    room.players.splice(playerIdx, 1);
    // Adjust currentPlayerIndex
    if (room.game) {
      if (room.game.currentPlayerIndex >= playerIdx) {
        room.game.currentPlayerIndex = Math.max(0, room.game.currentPlayerIndex - 1);
      }
      if (room.game.pendingDraw?.targetIndex >= playerIdx) {
        room.game.pendingDraw.targetIndex = Math.max(0, room.game.pendingDraw.targetIndex - 1);
      }
    }
  }

  if (isHost) {
    // Host left — close room
    clearGameTimers(room);
    io.to(code).emit('room-closed', { reason: 'Host left the room.' });
    for (const p of room.players) socketToRoom.delete(p.socketId);
    for (const s of room.spectators) socketToRoom.delete(s.socketId);
    rooms.delete(code);
    return;
  }

  if (room.players.length === 0 && room.spectators.length === 0) {
    clearGameTimers(room);
    rooms.delete(code);
    return;
  }

  // If game in progress and only 1 player left, end it
  if (room.game && room.players.length < 2 && room.game.phase !== 'winner') {
    clearGameTimers(room);
    room.game = null;
    room.status = 'lobby';
    io.to(code).emit('game-aborted', { reason: 'Not enough players.' });
  }

  broadcastRoomState(io, room);
}

// ─── Start server ─────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Spicy Uno server running on port ${PORT}`);
});
