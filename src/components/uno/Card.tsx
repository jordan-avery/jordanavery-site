import type { Card as CardType } from './types';

const COLOR_MAP: Record<string, string> = {
  red: '#E53935',
  yellow: '#F9A825',
  blue: '#1565C0',
  green: '#2E7D32',
};

function cardSymbol(card: CardType): string {
  if (card.type === 'number') return String(card.value);
  if (card.type === 'skip') return '⊘';
  if (card.type === 'reverse') return '↺';
  if (card.type === 'draw2') return '+2';
  if (card.type === 'wild') return '';
  if (card.type === 'wild4') return '+4';
  return '';
}

function cardColor(card: CardType): string {
  if (card.color === 'wild') return 'transparent';
  return COLOR_MAP[card.color] || '#333';
}

interface Props {
  card: CardType;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  playable?: boolean;
  mustPlay?: boolean;
  onClick?: () => void;
  showSignature?: boolean;
  activeColor?: string;
}

export default function Card({ card, size = 'md', selected, playable, mustPlay, onClick, showSignature }: Props) {
  const sym = cardSymbol(card);
  const isWild = card.color === 'wild';
  const bg = isWild ? undefined : cardColor(card);
  const symColor = card.color === 'yellow' ? '#7a5c00' : card.color === 'wild' ? '#fff' : (COLOR_MAP[card.color] || '#333');

  const hasSignature = card.signatures && card.signatures.length > 0;
  const latestSig = hasSignature ? card.signatures[card.signatures.length - 1] : null;

  const sizePx = size === 'sm' ? 50 : size === 'lg' ? 90 : 70;
  const heightPx = Math.round(sizePx * 1.43);
  const fontSize = size === 'sm' ? '1.1rem' : size === 'lg' ? '2.2rem' : '1.6rem';
  const cornerSize = size === 'sm' ? '0.45rem' : '0.6rem';

  return (
    <div
      className={`uno-card${selected ? ' selected' : ''}${playable ? ' playable' : ''}${mustPlay ? ' must-play' : ''}`}
      style={{
        width: sizePx,
        height: heightPx,
        background: isWild ? undefined : bg,
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
      title={hasSignature && latestSig ? `Signed by: ${latestSig.winner}` : undefined}
    >
      {isWild && (
        <div className="wild-bg" />
      )}

      {/* Corner top-left */}
      <div className="corner corner-tl" style={{ fontSize: cornerSize, color: isWild ? '#fff' : 'rgba(255,255,255,0.95)' }}>
        <span>{sym || (isWild ? 'W' : '')}</span>
      </div>

      {/* Center oval */}
      <div className="card-oval" style={{ borderColor: isWild ? undefined : bg }}>
        <span className="card-sym" style={{ color: symColor, fontSize }}>{sym || (isWild ? '🎨' : '')}</span>
      </div>

      {/* Corner bottom-right */}
      <div className="corner corner-br" style={{ fontSize: cornerSize, color: isWild ? '#fff' : 'rgba(255,255,255,0.95)' }}>
        <span>{sym || (isWild ? 'W' : '')}</span>
      </div>

      {/* Signature strip */}
      {showSignature && latestSig && (
        <div className="sig-strip">
          {latestSig.drawing ? (
            <img src={latestSig.drawing} alt="sig" className="sig-img" />
          ) : (
            <span className="sig-text">{latestSig.text}</span>
          )}
        </div>
      )}

      {/* Signature count badge */}
      {!showSignature && hasSignature && (
        <div className="sig-badge">{card.signatures.length}</div>
      )}
    </div>
  );
}

export function CardBack({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizePx = size === 'sm' ? 50 : size === 'lg' ? 90 : 70;
  const heightPx = Math.round(sizePx * 1.43);
  return (
    <div
      className="uno-card card-back"
      style={{ width: sizePx, height: heightPx }}
    >
      <div className="card-back-inner">
        <span className="card-back-label">UNO</span>
      </div>
    </div>
  );
}
