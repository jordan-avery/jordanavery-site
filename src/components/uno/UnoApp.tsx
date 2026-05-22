import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Card, RoomState, SortMode } from './types';
import Lobby from './Lobby';
import GameBoard from './GameBoard';
import './uno.css';

interface Props {
  serverUrl: string;
}

type Screen = 'auth' | 'lobby' | 'inroom' | 'game';

export default function UnoApp({ serverUrl }: Props) {
  const socketRef = useRef<Socket | null>(null);
  const [_connected, setConnected] = useState(false);
  const [screen, setScreen] = useState<Screen>('auth');
  const [playerName, setPlayerName] = useState('');
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [myHand, setMyHand] = useState<Card[]>([]);
  const [mustPlayCardId, setMustPlayCardId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('color-number');
  const [notification, setNotification] = useState<string | null>(null);
  const [notifType, setNotifType] = useState<string>('info');
  const [error, setError] = useState<string | null>(null);
  const [statsData, setStatsData] = useState<Record<string, number>>({});
  const [cardSignedData, setCardSignedData] = useState<{ typeKey: string; winnerName: string } | null>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNotif(msg: string, type = 'info', duration = 3500) {
    if (notifTimer.current) clearTimeout(notifTimer.current);
    setNotification(msg);
    setNotifType(type);
    notifTimer.current = setTimeout(() => setNotification(null), duration);
  }

  useEffect(() => {
    const socket = io(serverUrl, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setMySocketId(socket.id ?? null);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('auth-result', ({ ok }: { ok: boolean }) => {
      if (ok) {
        setScreen('lobby');
        setError(null);
      } else {
        setError('Incorrect password.');
      }
    });

    socket.on('stats', (data: Record<string, number>) => {
      setStatsData(data);
    });

    socket.on('room-state', (state: RoomState) => {
      setRoomState(state);
      setError(null);

      if (state.status === 'lobby') {
        const inRoom = state.players.some(p => p.socketId === socket.id) ||
                       state.spectators.some(s => s.socketId === socket.id);
        setScreen(inRoom ? 'inroom' : 'lobby');
      } else if (state.status === 'playing' || state.status === 'ended') {
        setScreen('game');
      }

      // Reset signed card data when a new game starts
      if (state.game?.phase !== 'winner') {
        setCardSignedData(null);
      }
    });

    socket.on('your-hand', (hand: Card[]) => {
      setMyHand(hand);
    });

    socket.on('must-play', (card: Card | null) => {
      setMustPlayCardId(card?.id ?? null);
    });

    socket.on('room-error', (msg: string) => {
      setError(msg);
    });

    socket.on('game-error', (msg: string) => {
      showNotif(msg, 'error');
    });

    socket.on('room-closed', ({ reason }: { reason: string }) => {
      setRoomState(null);
      setMyHand([]);
      setScreen('lobby');
      showNotif(reason, 'error');
    });

    socket.on('game-aborted', ({ reason }: { reason: string }) => {
      setMyHand([]);
      setScreen('inroom');
      showNotif(reason, 'error');
    });

    socket.on('uno-declared', ({ playerName: name }: { playerName: string }) => {
      showNotif(`UNO! — ${name}`, 'uno', 2500);
    });

    socket.on('uno-penalized', ({ playerName: name, catcherName }: { playerName: string; catcherName: string }) => {
      showNotif(`${catcherName} caught ${name} without UNO! +2 cards.`, 'error', 3000);
    });

    socket.on('slap-result', ({ loserName, lastSlapperName }: { loserName: string; lastSlapperName: string }) => {
      showNotif(`${lastSlapperName} slapped last! ${loserName} draws 2.`, 'slap', 3500);
    });

    socket.on('card-signed', (data: { typeKey: string; winnerName: string }) => {
      setCardSignedData(data);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl]);

  // When hand changes, clear mustPlayCardId if card is no longer in hand
  useEffect(() => {
    if (mustPlayCardId && !myHand.find(c => c.id === mustPlayCardId)) {
      setMustPlayCardId(null);
    }
  }, [myHand, mustPlayCardId]);

  const socket = socketRef.current;

  if (!socket) {
    return (
      <div className="uno-loading">
        <div className="uno-spinner" />
        <p>Connecting…</p>
      </div>
    );
  }

  if (screen === 'game' && roomState?.game) {
    return (
      <GameBoard
        socket={socket}
        roomState={roomState}
        myHand={myHand}
        mySocketId={mySocketId ?? ''}
        sortMode={sortMode}
        mustPlayCardId={mustPlayCardId}
        notification={notification}
        notifType={notifType}
        cardSignedData={cardSignedData}
        onChangeSortMode={setSortMode}
        onClearNotif={() => setNotification(null)}
      />
    );
  }

  return (
    <Lobby
      socket={socket}
      screen={screen === 'game' ? 'lobby' : (screen as 'auth' | 'lobby' | 'inroom')}
      playerName={playerName}
      roomState={roomState}
      mySocketId={mySocketId}
      statsData={statsData}
      error={error}
      onPlayerNameChange={setPlayerName}
      onAuthSuccess={() => setScreen('lobby')}
    />
  );
}
