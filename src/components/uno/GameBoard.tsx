import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Card as CardType, RoomState, SortMode, UnoColor } from './types';
import Card, { CardBack } from './Card';
import SignatureModal from './SignatureModal';

const COLOR_ORDER: Record<string, number> = { red: 0, yellow: 1, blue: 2, green: 3, wild: 4 };
const TYPE_ORDER: Record<string, number> = { number: 0, skip: 10, reverse: 11, draw2: 12, wild: 20, wild4: 21 };
const COLOR_HEX: Record<string, string> = { red: '#E53935', yellow: '#F9A825', blue: '#1565C0', green: '#2E7D32' };
const COLOR_LABELS: Record<string, string> = { red: 'Red', yellow: 'Yellow', blue: 'Blue', green: 'Green' };

function sortHand(hand: CardType[], mode: SortMode): CardType[] {
  return [...hand].sort((a, b) => {
    const aType = a.type === 'number' ? (a.value ?? 0) : TYPE_ORDER[a.type];
    const bType = b.type === 'number' ? (b.value ?? 0) : TYPE_ORDER[b.type];
    if (mode === 'color-number') {
      const cDiff = COLOR_ORDER[a.color] - COLOR_ORDER[b.color];
      return cDiff !== 0 ? cDiff : aType - bType;
    }
    return aType !== bType ? aType - bType : COLOR_ORDER[a.color] - COLOR_ORDER[b.color];
  });
}

function isPlayableOnTurn(card: CardType, game: RoomState['game']): boolean {
  if (!game) return false;
  if (game.phase === 'pending-draw') {
    return (game.pendingDraw?.type === '+2' && card.type === 'draw2') ||
           (game.pendingDraw?.type === '+4' && card.type === 'wild4');
  }
  if (card.type === 'wild' || card.type === 'wild4') return true;
  if (card.color === game.currentColor) return true;
  const top = game.topCard;
  if (top?.type === 'number' && card.type === 'number' && card.value === top.value) return true;
  if (top && !['number','wild','wild4'].includes(top.type) && card.type === top.type) return true;
  return false;
}

function isPlayableOutOfTurn(card: CardType, game: RoomState['game']): boolean {
  if (!game) return false;
  if (game.phase !== 'playing' && game.phase !== 'pending-draw') return false;
  if (game.phase === 'pending-draw') {
    return (game.pendingDraw?.type === '+2' && card.type === 'draw2') ||
           (game.pendingDraw?.type === '+4' && card.type === 'wild4');
  }
  const top = game.topCard;
  if (!top) return false;
  if (card.type === 'wild' && top.type === 'wild') return true;
  if (card.type === 'wild4' && top.type === 'wild4') return true;
  if (card.type === 'number' && top.type === 'number') return card.color === game.currentColor && card.value === top.value;
  if (['skip','reverse','draw2'].includes(card.type)) return card.color === game.currentColor && card.type === top.type;
  return false;
}

function cardLabel(card: CardType): string {
  const name = card.type === 'number' ? String(card.value) : card.type === 'draw2' ? 'Draw Two' :
    card.type === 'wild4' ? 'Wild Draw Four' : card.type.charAt(0).toUpperCase() + card.type.slice(1);
  return card.color === 'wild' ? name : `${card.color.charAt(0).toUpperCase() + card.color.slice(1)} ${name}`;
}

function playSlap() {
  try {
    const ctx = new AudioContext();
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr * 0.15, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.025)) * 0.8;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  } catch {}
}

interface Props {
  socket: Socket;
  roomState: RoomState;
  myHand: CardType[];
  mySocketId: string;
  sortMode: SortMode;
  mustPlayCardId: string | null;
  notification: string | null;
  notifType: string;
  cardSignedData: { typeKey: string; winnerName: string } | null;
  onChangeSortMode: (m: SortMode) => void;
  onClearNotif: () => void;
}

export default function GameBoard({ socket, roomState, myHand, mySocketId, sortMode, mustPlayCardId, notification, notifType, cardSignedData, onChangeSortMode, onClearNotif }: Props) {
  const game = roomState.game;
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [unoFlash, setUnoFlash] = useState<string | null>(null);
  const [showSignModal, setShowSignModal] = useState(false);
  const [cardSignedDisplay, setCardSignedDisplay] = useState(false);
  const handRef = useRef<HTMLDivElement>(null);
  const [shakingCardId, setShakingCardId] = useState<string | null>(null);
  const [showInvalidHint, setShowInvalidHint] = useState(false);
  const [newCardIds, setNewCardIds] = useState<Set<string>>(new Set());
  const prevHandIdsRef = useRef<Set<string>>(new Set());
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pilesDealDone, setPilesDealDone] = useState(false);

  // Pending draw countdown
  useEffect(() => {
    if (!game?.pendingDraw?.endsAt) { setCountdown(0); return; }
    const tick = () => setCountdown(Math.max(0, Math.ceil((game.pendingDraw!.endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [game?.pendingDraw?.endsAt]);

  // Show sign modal when winner is determined and I'm the winner
  useEffect(() => {
    if (game?.phase === 'winner' && game.winner === mySocketId) {
      setShowSignModal(true);
    }
    if (game?.phase === 'winner' && cardSignedData) {
      setShowSignModal(false);
      setCardSignedDisplay(true);
    }
  }, [game?.phase, game?.winner, cardSignedData, mySocketId]);

  // Track newly added cards for deal animation
  useEffect(() => {
    const prev = prevHandIdsRef.current;
    const added = myHand.filter(c => !prev.has(c.id)).map(c => c.id);
    prevHandIdsRef.current = new Set(myHand.map(c => c.id));
    if (added.length > 0) {
      setNewCardIds(new Set(added));
      const t = setTimeout(() => setNewCardIds(new Set()), 900);
      return () => clearTimeout(t);
    }
  }, [myHand]);

  // Unlock pile clicking after deal animation finishes
  useEffect(() => {
    if (game?.phase === 'pile-select' && game.pileSelectState) {
      setPilesDealDone(false);
      // Round-robin: last card is at step (7 * pileCount - 1), each step = 80ms, plus 280ms animation
      const delay = (7 * game.pileSelectState.pileCount - 1) * 80 + 450;
      const t = setTimeout(() => setPilesDealDone(true), delay);
      return () => clearTimeout(t);
    }
  }, [game?.phase]);

  if (!game) return <div className="felt-bg"><p style={{ color: '#fff', padding: 20 }}>Waiting for game…</p></div>;

  const myIndex = roomState.players.findIndex(p => p.socketId === mySocketId);
  const isSpectator = myIndex === -1;
  const isMyTurn = game.currentPlayerIndex === myIndex;
  const amHelper = game.phase === 'help' && game.helpState?.requestingPlayerId === mySocketId;
  const imOfferingHelp = !isSpectator && game.phase === 'help' && game.helpState?.requestingPlayerId !== mySocketId;
  const myOffer = game.helpState?.offers.find(o => o.fromPlayerId === mySocketId);

  // Starting phase eligibility
  let isMyStartingTurn = false;
  if (game.phase === 'starting' && !isSpectator) {
    const first = game.startingState?.firstPlayerIndex;
    if (first === undefined || first === -1) {
      isMyStartingTurn = true;
    } else {
      const n = roomState.players.length;
      isMyStartingTurn = myIndex === (first + 1) % n || myIndex === ((first - 1) + n) % n;
    }
  }

  const canActOnTurn = (isMyTurn || amHelper) && ['playing', 'help'].includes(game.phase);
  const canDraw = canActOnTurn && !myHand.some(c => isPlayableOnTurn(c, game));
  const canHelp = canDraw && game.phase !== 'pending-draw';

  const sortedHand = sortHand(myHand, sortMode);

  // UNO button state for ME
  const myPlayer = roomState.players[myIndex];
  const myUnoState = game.unoState;
  const iMustCallUno = myUnoState?.playerId === mySocketId && !myPlayer?.hasCalledUno;
  const canCatchUno = myUnoState?.expired && myUnoState?.playerId !== mySocketId && !isSpectator;

  function triggerShake(cardId: string) {
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    setShakingCardId(cardId);
    setShowInvalidHint(true);
    shakeTimerRef.current = setTimeout(() => {
      setShakingCardId(null);
      setShowInvalidHint(false);
    }, 600);
  }

  function handleCardClick(card: CardType) {
    if (isSpectator) return;
    if (mustPlayCardId && card.id !== mustPlayCardId) { triggerShake(card.id); return; }

    // Offering help
    if (imOfferingHelp) {
      if (myOffer?.fromPlayerId === mySocketId) {
        socket.emit('withdraw-help-offer');
      }
      socket.emit('offer-help', { cardId: card.id });
      return;
    }

    const myTurnActive = isMyTurn || amHelper || isMyStartingTurn;
    if (!myTurnActive) {
      // Check out-of-turn eligibility
      if (!isPlayableOutOfTurn(card, game)) return;
    }

    const eligible = isMyStartingTurn
      ? true // will be validated by server
      : (canActOnTurn ? isPlayableOnTurn(card, game) : isPlayableOutOfTurn(card, game));
    if (!eligible) { if (isMyTurn || amHelper || isMyStartingTurn) triggerShake(card.id); return; }

    if (card.type === 'wild' || card.type === 'wild4') {
      setSelectedCardId(card.id);
      setShowColorPicker(true);
      return;
    }

    socket.emit('play-card', { cardId: card.id });
    setSelectedCardId(null);
  }

  function handleColorPick(color: UnoColor) {
    if (!selectedCardId) return;
    socket.emit('play-card', { cardId: selectedCardId, chosenColor: color });
    setSelectedCardId(null);
    setShowColorPicker(false);
  }

  function handleSlap() {
    playSlap();
    socket.emit('slap');
  }

  if (game.phase === 'pile-select' && game.pileSelectState) {
    const ps = game.pileSelectState;
    const myClaimedEntry = Object.entries(ps.claims).find(([, sid]) => sid === mySocketId);
    const myClaimed = !!myClaimedEntry;
    const claimedCount = Object.keys(ps.claims).length;
    const allClaimed = claimedCount === roomState.players.length;

    return (
      <div className="felt-bg">
        {notification && (
          <div className={`notif-toast notif-${notifType}`} onClick={onClearNotif}>
            {notification}
          </div>
        )}
        <div className="pile-select-screen">
          <div className="pile-select-header">
            <div className="pile-select-title">
              {!pilesDealDone
                ? 'Dealing your hands…'
                : allClaimed
                ? '🃏 Starting…'
                : myClaimed
                ? 'Waiting for others…'
                : 'Choose Your Hand'}
            </div>
            <p className="pile-select-sub">
              {!pilesDealDone
                ? ''
                : allClaimed
                ? 'Everyone has chosen!'
                : myClaimed
                ? `${claimedCount} / ${roomState.players.length} chosen`
                : 'Pick any pile — no peeking!'}
            </p>
          </div>

          {/* Dealer deck shown while dealing */}
          {!pilesDealDone && (
            <div className="pile-dealer-area">
              <div className="pile-dealer-label">Deck</div>
              <div className="pile-dealer-deck">
                <CardBack size="md" />
                <div className="pile-dealer-count">{ps.pileCount * 7}</div>
              </div>
            </div>
          )}

          {/* Starting card shown after dealing */}
          {pilesDealDone && game.topCard && (
            <div className="pile-top-card-row">
              <span className="pile-top-card-label">Starting card</span>
              <Card card={game.topCard} size="md" />
            </div>
          )}

          <div className="pile-select-piles">
            {Array.from({ length: ps.pileCount }).map((_, i) => {
              const claimedBySocketId = ps.claims[i];
              const claimedByPlayer = claimedBySocketId
                ? roomState.players.find(p => p.socketId === claimedBySocketId)
                : null;
              const isMine = claimedBySocketId === mySocketId;
              const isClaimed = !!claimedBySocketId;
              const isClickable = pilesDealDone && !isSpectator && !myClaimed && !isClaimed;
              // Horizontal start offset biased toward center (simulates flying from center deck)
              const centerOffset = Math.round((i - (ps.pileCount - 1) / 2) * -40);

              return (
                <div
                  key={i}
                  className={`pile-item${isClickable ? ' pile-clickable' : ''}${isMine ? ' pile-mine' : ''}${isClaimed && !isMine ? ' pile-taken' : ''}`}
                  onClick={isClickable ? () => socket.emit('claim-pile', { pileIndex: i }) : undefined}
                >
                  <div className="pile-stack-wrap">
                    <div className="pile-cards-vis">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <div
                          key={j}
                          className="pile-card-back"
                          style={{
                            bottom: j * 3,
                            zIndex: j,
                            '--tx-start': `${centerOffset}px`,
                            animationDelay: `${(j * ps.pileCount + i) * 80}ms`,
                          } as React.CSSProperties}
                        />
                      ))}
                    </div>
                    <div className="pile-card-count">7</div>
                  </div>
                  <div className="pile-label">
                    {isMine ? '✓ Yours!' : claimedByPlayer ? claimedByPlayer.name : `Pile ${i + 1}`}
                  </div>
                </div>
              );
            })}
          </div>

          {isSpectator && (
            <p className="pile-select-spectator">Spectating — players are choosing their hands</p>
          )}
        </div>
      </div>
    );
  }

  const activeColorHex = COLOR_HEX[game.currentColor] || '#888';

  return (
    <div className="felt-bg">
      {/* Notification toast */}
      {notification && (
        <div className={`notif-toast notif-${notifType}`} onClick={onClearNotif}>
          {notification}
        </div>
      )}

      {/* UNO flash overlay */}
      {unoFlash && (
        <div className="uno-flash" onClick={() => setUnoFlash(null)}>
          <span>UNO!</span>
        </div>
      )}

      {/* Color picker overlay */}
      {showColorPicker && (
        <div className="overlay-backdrop" onClick={() => { setShowColorPicker(false); setSelectedCardId(null); }}>
          <div className="color-picker-panel" onClick={e => e.stopPropagation()}>
            <p>Choose a color</p>
            <div className="color-picker-grid">
              {(['red','yellow','blue','green'] as UnoColor[]).map(c => (
                <button key={c} className="color-btn" style={{ background: COLOR_HEX[c] }} onClick={() => handleColorPick(c)}>
                  {COLOR_LABELS[c]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Slap overlay */}
      {game.phase === 'slap' && game.slapState?.active && !isSpectator && (
        <div className="slap-overlay">
          <button className="slap-btn" onClick={handleSlap}
            disabled={game.slapState.slappers.includes(mySocketId)}>
            👋 SLAP!
          </button>
          <p className="slap-count">{game.slapState.slappers.length} / {roomState.players.length - 1} slapped</p>
        </div>
      )}

      {/* Help overlay — for the requester (hidden once they have a must-play card) */}
      {game.phase === 'help' && amHelper && !mustPlayCardId && (
        <div className="overlay-backdrop">
          <div className="help-panel">
            <h3>Ask for Help</h3>
            {game.helpState && game.helpState.offers.length > 0 ? (
              <>
                <p>Choose a card to accept:</p>
                <div className="help-offers">
                  {game.helpState.offers.map(offer => (
                    <div key={offer.fromPlayerId} className="help-offer-item">
                      <CardBack size="md" />
                      <span>{offer.fromPlayerName}</span>
                      <button onClick={() => socket.emit('accept-help', { fromPlayerId: offer.fromPlayerId })}>Accept</button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="waiting-text">Waiting for others to offer cards…</p>
            )}
            <div className="help-actions">
              <button className="btn-draw" onClick={() => socket.emit('draw-card')}>Draw Instead</button>
            </div>
          </div>
        </div>
      )}

      {/* Help overlay — for offereres */}
      {game.phase === 'help' && imOfferingHelp && (
        <div className="help-banner">
          <span><strong>{roomState.players.find(p => p.socketId === game.helpState?.requestingPlayerId)?.name}</strong> needs help — click a card to offer it</span>
          {myOffer && (
            <button className="btn-sm" onClick={() => socket.emit('withdraw-help-offer')}>Withdraw Offer</button>
          )}
        </div>
      )}

      {/* Zero trade overlay */}
      {game.phase === 'zero-trade' && game.zeroTradeState?.initiatorSocketId === mySocketId && (
        <div className="overlay-backdrop">
          <div className="trade-panel">
            <h3>Zero Card — Trade Hands!</h3>
            <p>Choose someone to swap with, or keep your hand:</p>
            <div className="trade-players">
              {roomState.players.filter(p => p.socketId !== mySocketId).map(p => (
                <button key={p.socketId} className="trade-player-btn" onClick={() => socket.emit('trade-hand', { targetPlayerId: p.socketId })}>
                  <span className="trade-name">{p.name}</span>
                  <span className="trade-count">{p.cardCount} cards</span>
                </button>
              ))}
            </div>
            <button className="btn-keep" onClick={() => socket.emit('keep-hand')}>Keep My Hand</button>
          </div>
        </div>
      )}
      {game.phase === 'zero-trade' && game.zeroTradeState?.initiatorSocketId !== mySocketId && (
        <div className="overlay-banner">
          <strong>{roomState.players.find(p => p.socketId === game.zeroTradeState?.initiatorSocketId)?.name}</strong> played a Zero — choosing who to swap with…
        </div>
      )}

      {/* Winner screen */}
      {game.phase === 'winner' && (
        <>
          {showSignModal && game.winner === mySocketId && game.winnerCard && (
            <SignatureModal
              winnerName={game.winnerName || ''}
              cardLabel={cardLabel(game.winnerCard)}
              onSign={(data) => { socket.emit('sign-card', data); setShowSignModal(false); }}
              onSkip={() => { socket.emit('sign-card', {}); setShowSignModal(false); }}
            />
          )}
          {!showSignModal && (
            <div className="overlay-backdrop winner-backdrop">
              <div className="winner-panel">
                <div className="winner-crown">🏆</div>
                <h2>{game.winnerName} wins!</h2>
                {game.winnerCard && (
                  <div className="winner-card-display">
                    <Card card={game.winnerCard} size="lg" showSignature />
                  </div>
                )}
                {game.winner !== mySocketId && game.phase === 'winner' && !cardSignedData && (
                  <p className="waiting-text">Waiting for {game.winnerName} to sign their card…</p>
                )}
                {cardSignedDisplay && (
                  <p className="signed-msg">Signed! The card is permanently marked.</p>
                )}
                {roomState.hostSocketId === mySocketId && !showSignModal && (
                  <div className="winner-actions">
                    <button className="btn-newgame" onClick={() => socket.emit('start-new-game')}>New Game</button>
                    <button className="btn-lobby" onClick={() => socket.emit('return-to-lobby')}>Return to Lobby</button>
                  </div>
                )}
                {roomState.hostSocketId !== mySocketId && (
                  <p className="waiting-text">Waiting for host to start a new game…</p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Main layout */}
      <div className="game-layout">
        {/* Top bar */}
        <div className="game-topbar">
          <div className="active-color-badge" style={{ background: activeColorHex }}>
            {COLOR_LABELS[game.currentColor] || game.currentColor}
          </div>
          <div className="turn-indicator">
            {game.phase === 'starting'
              ? 'Game starting — play a card!'
              : game.phase === 'winner'
              ? `${game.winnerName} wins!`
              : isMyTurn || isMyStartingTurn
              ? 'Your turn'
              : `${roomState.players[game.currentPlayerIndex]?.name || '?'}'s turn`}
          </div>
        </div>

        {/* Center + sidebar */}
        <div className="game-center-row">
          {/* Discard + draw area */}
          <div className="discard-area">
            <div className="table-center">
              <div className={`deck-pile${canDraw ? ' clickable' : ''}`} onClick={canDraw ? () => socket.emit('draw-card') : undefined}>
                <CardBack size="lg" />
                <div className="deck-pile-count">{game.deckCount}</div>
              </div>
              {game.topCard && <Card card={game.topCard} size="lg" showSignature />}
            </div>

            {/* Pending draw timer */}
            {game.phase === 'pending-draw' && game.pendingDraw && (
              <div className="pending-draw-box">
                <div className="draw-info">
                  <strong>Draw {game.pendingDraw.amount}!</strong>
                  <span className="draw-timer">{countdown}s</span>
                </div>
                <p className="draw-sub">Play a matching {game.pendingDraw.type} to stack, or…</p>
                {game.pendingDraw.targetIndex === myIndex && (
                  <button className="btn-drawforme" onClick={() => socket.emit('draw-for-me')}>
                    Draw {game.pendingDraw.amount} for me
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Player sidebar */}
          <div className="player-sidebar">
            <h3 className="sidebar-title">Players</h3>
            {roomState.players.map((p, i) => {
              const isCurrent = game.currentPlayerIndex === i;
              const hasUnoAlert = game.unoState?.playerId === p.socketId;
              return (
                <div key={p.socketId} className={`sidebar-player${isCurrent ? ' current-turn' : ''}${p.socketId === mySocketId ? ' is-me' : ''}`}>
                  <div className="sidebar-player-info">
                    <span className="sidebar-name">{p.name}{p.socketId === mySocketId ? ' (you)' : ''}</span>
                    {p.hasCalledUno && <span className="uno-badge">UNO!</span>}
                    {hasUnoAlert && !p.hasCalledUno && <span className="uno-danger">❗</span>}
                    {p.socketId === roomState.hostSocketId && <span className="host-badge">host</span>}
                  </div>
                  <div className="sidebar-cards">
                    <span className="card-count">{p.cardCount}</span>
                    <div className="card-stack-vis">
                      {Array.from({ length: Math.min(p.cardCount, 6) }).map((_, j) => (
                        <div key={j} className="stack-card" style={{ right: j * 3, zIndex: j }} />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {roomState.spectators.length > 0 && (
              <div className="spectators-section">
                <h4>Watching</h4>
                {roomState.spectators.map(s => (
                  <div key={s.socketId} className="spectator-row">{s.name}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Hand area */}
        {!isSpectator && (
          <div className="hand-area">
            {/* Controls row */}
            <div className="hand-controls">
              <div className="sort-btns">
                <button className={sortMode === 'color-number' ? 'active' : ''} onClick={() => onChangeSortMode('color-number')}>Color → #</button>
                <button className={sortMode === 'number-color' ? 'active' : ''} onClick={() => onChangeSortMode('number-color')}># → Color</button>
              </div>

              <div className="action-btns">
                <button
                  className={`btn-draw${canDraw ? ' must-draw' : ''}`}
                  disabled={!canDraw}
                  onClick={() => socket.emit('draw-card')}
                >
                  Draw
                </button>
                <button
                  className="btn-help"
                  disabled={!canHelp || game.phase === 'help'}
                  onClick={() => socket.emit('request-help')}
                >
                  Help
                </button>
              </div>

              {/* UNO button */}
              <button
                className={`btn-uno${iMustCallUno ? ' uno-red' : canCatchUno ? ' uno-blue' : ''}`}
                disabled={!iMustCallUno && !canCatchUno}
                onClick={() => {
                  if (iMustCallUno) socket.emit('declare-uno');
                  else if (canCatchUno && myUnoState) socket.emit('penalize-uno', { targetPlayerId: myUnoState.playerId });
                }}
              >
                UNO!
              </button>
            </div>

            {/* Cards */}
            <div className={`hand-cards${canActOnTurn && !mustPlayCardId ? ' my-turn' : ''}`} ref={handRef}>
              {sortedHand.map(card => {
                const onTurn = isPlayableOnTurn(card, game);
                const outOfTurn = !isMyTurn && !isMyStartingTurn && isPlayableOutOfTurn(card, game);
                const isActiveTurn = isMyTurn || amHelper || isMyStartingTurn;
                const playable = isActiveTurn ? onTurn : outOfTurn;
                const isMust = mustPlayCardId === card.id;
                const isOfferTarget = imOfferingHelp;
                const isShaking = shakingCardId === card.id;
                const isNewCard = newCardIds.has(card.id);
                const newCardIdx = isNewCard ? [...newCardIds].indexOf(card.id) : 0;
                return (
                  <div
                    key={card.id}
                    className={`hand-card-wrap${isMust ? ' must-play-wrap' : ''}${isShaking ? ' card-shaking' : ''}${isNewCard ? ' card-new' : ''}`}
                    style={isNewCard ? { animationDelay: `${newCardIdx * 55}ms` } : undefined}
                  >
                    <Card
                      card={card}
                      size="md"
                      playable={playable || isOfferTarget}
                      mustPlay={isMust}
                      selected={selectedCardId === card.id}
                      onClick={() => handleCardClick(card)}
                    />
                  </div>
                );
              })}
            </div>
            {showInvalidHint && <div className="invalid-hint">Invalid card — select another</div>}
          </div>
        )}

        {isSpectator && (
          <div className="spectator-bar">
            <span>You are spectating. Watching the game…</span>
          </div>
        )}
      </div>
    </div>
  );
}
