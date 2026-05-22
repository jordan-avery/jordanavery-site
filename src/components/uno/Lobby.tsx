import { useState } from 'react';
import type { RoomState } from './types';
import type { Socket } from 'socket.io-client';

interface Props {
  socket: Socket;
  screen: 'auth' | 'lobby' | 'inroom';
  playerName: string;
  roomState: RoomState | null;
  mySocketId: string | null;
  statsData: Record<string, number>;
  error: string | null;
  onPlayerNameChange: (name: string) => void;
  onAuthSuccess: () => void;
}

export default function Lobby({ socket, screen, playerName, roomState, mySocketId, statsData, error, onPlayerNameChange, onAuthSuccess }: Props) {
  const [password, setPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showStats, setShowStats] = useState(false);

  function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    socket.emit('authenticate', password);
  }

  if (screen === 'auth') {
    return (
      <div className="lobby-screen">
        <div className="lobby-card">
          <div className="lobby-logo">
            <span className="logo-uno">UNO</span>
            <span className="logo-spicy">Spicy</span>
          </div>
          <form onSubmit={handleAuth} className="auth-form">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
            />
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn-primary">Enter</button>
          </form>
        </div>
      </div>
    );
  }

  if (screen === 'inroom' && roomState) {
    const isHost = roomState.hostSocketId === mySocketId;
    const canStart = isHost && roomState.players.length >= 2;

    return (
      <div className="lobby-screen">
        <div className="lobby-card room-card">
          <div className="room-header">
            <div className="lobby-logo small">
              <span className="logo-uno">UNO</span>
              <span className="logo-spicy">Spicy</span>
            </div>
            <div className="room-code-display">
              <span className="room-code-label">Room Code</span>
              <span className="room-code">{roomState.code}</span>
            </div>
          </div>

          <div className="player-list-lobby">
            <h3>Players ({roomState.players.length})</h3>
            {roomState.players.map(p => (
              <div key={p.socketId} className="lobby-player">
                <span>{p.name}</span>
                {p.socketId === roomState.hostSocketId && <span className="host-tag">host</span>}
                {p.socketId === mySocketId && <span className="you-tag">you</span>}
              </div>
            ))}
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="room-actions">
            {isHost && (
              <button
                className="btn-primary"
                disabled={!canStart}
                onClick={() => socket.emit('start-game')}
              >
                {canStart ? 'Begin Game' : 'Need 2+ players'}
              </button>
            )}
            {!isHost && <p className="waiting-text">Waiting for host to start…</p>}
            <button className="btn-leave" onClick={() => socket.emit('leave-room')}>Leave Room</button>
          </div>
        </div>
      </div>
    );
  }

  // Lobby screen (no room yet)
  const sortedStats = Object.entries(statsData).sort((a, b) => b[1] - a[1]);

  return (
    <div className="lobby-screen">
      <div className="lobby-card">
        <div className="lobby-logo">
          <span className="logo-uno">UNO</span>
          <span className="logo-spicy">Spicy</span>
        </div>

        <div className="name-field">
          <label>Your Name</label>
          <input
            type="text"
            value={playerName}
            onChange={e => onPlayerNameChange(e.target.value)}
            placeholder="Enter your name"
            maxLength={20}
          />
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="lobby-actions">
          <button
            className="btn-primary"
            disabled={!playerName.trim()}
            onClick={() => socket.emit('create-room', { playerName: playerName.trim() })}
          >
            Create Room
          </button>

          <div className="join-row">
            <input
              type="text"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Room code"
              maxLength={5}
              className="join-code-input"
            />
            <button
              className="btn-join"
              disabled={!playerName.trim() || joinCode.length < 5}
              onClick={() => socket.emit('join-room', { code: joinCode, playerName: playerName.trim() })}
            >
              Join
            </button>
          </div>

          <button className="btn-stats" onClick={() => { setShowStats(true); socket.emit('get-stats'); }}>
            View Win Stats
          </button>
        </div>
      </div>

      {showStats && (
        <div className="overlay-backdrop" onClick={() => setShowStats(false)}>
          <div className="stats-panel" onClick={e => e.stopPropagation()}>
            <h2>Win Statistics</h2>
            {sortedStats.length === 0 ? (
              <p className="no-stats">No wins recorded yet.</p>
            ) : (
              <table className="stats-table">
                <thead>
                  <tr><th>Player</th><th>Wins</th></tr>
                </thead>
                <tbody>
                  {sortedStats.map(([name, wins]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{wins}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button className="btn-close" onClick={() => setShowStats(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
