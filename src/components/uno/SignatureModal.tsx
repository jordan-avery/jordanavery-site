import { useEffect, useRef, useState } from 'react';

interface Props {
  winnerName: string;
  cardLabel: string;
  onSign: (data: { text?: string; drawing?: string }) => void;
  onSkip: () => void;
}

export default function SignatureModal({ winnerName, cardLabel, onSign, onSkip }: Props) {
  const [tab, setTab] = useState<'text' | 'draw'>('text');
  const [text, setText] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Initialize canvas when switching to draw tab
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [tab]);

  // Non-passive touch listeners so preventDefault works on mobile
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || tab !== 'draw') return;

    function getPos(clientX: number, clientY: number) {
      const rect = canvas!.getBoundingClientRect();
      return {
        x: (clientX - rect.left) * (canvas!.width / rect.width),
        y: (clientY - rect.top) * (canvas!.height / rect.height),
      };
    }

    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      drawing.current = true;
      lastPos.current = getPos(e.touches[0].clientX, e.touches[0].clientY);
    }

    function onTouchMove(e: TouchEvent) {
      if (!drawing.current) return;
      e.preventDefault();
      const ctx = canvas!.getContext('2d')!;
      const pos = getPos(e.touches[0].clientX, e.touches[0].clientY);
      if (lastPos.current) {
        ctx.beginPath();
        ctx.moveTo(lastPos.current.x, lastPos.current.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
      lastPos.current = pos;
    }

    function onTouchEnd() {
      drawing.current = false;
      lastPos.current = null;
    }

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [tab]);

  function getMousePos(e: React.MouseEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function startDraw(e: React.MouseEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    lastPos.current = getMousePos(e, canvas);
  }

  function continueDraw(e: React.MouseEvent) {
    const canvas = canvasRef.current;
    if (!canvas || !drawing.current) return;
    const ctx = canvas.getContext('2d')!;
    const pos = getMousePos(e, canvas);
    if (lastPos.current) {
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
    lastPos.current = pos;
  }

  function endDraw() {
    drawing.current = false;
    lastPos.current = null;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function handleSubmit() {
    if (tab === 'text') {
      onSign({ text: text.trim() || undefined });
    } else {
      const canvas = canvasRef.current;
      if (canvas) onSign({ drawing: canvas.toDataURL('image/png') });
    }
  }

  return (
    <div className="overlay-backdrop">
      <div className="sig-modal">
        <h2>Sign Your Card!</h2>
        <p className="sig-subtitle">
          You won with the <strong>{cardLabel}</strong>. Leave your mark on it, {winnerName}.
        </p>

        <div className="sig-tabs">
          <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>Text</button>
          <button className={tab === 'draw' ? 'active' : ''} onClick={() => setTab('draw')}>Draw</button>
        </div>

        {tab === 'text' ? (
          <textarea
            className="sig-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Your name, a message, anything..."
            maxLength={80}
            autoFocus
          />
        ) : (
          <div className="canvas-wrap">
            <canvas
              ref={canvasRef}
              width={320}
              height={120}
              className="sig-canvas"
              onMouseDown={startDraw}
              onMouseMove={continueDraw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              style={{ touchAction: 'none' }}
            />
            <button className="clear-btn" onClick={clearCanvas}>Clear</button>
          </div>
        )}

        <div className="sig-actions">
          <button className="btn-skip" onClick={onSkip}>Skip</button>
          <button className="btn-sign" onClick={handleSubmit}>Sign It!</button>
        </div>
      </div>
    </div>
  );
}
