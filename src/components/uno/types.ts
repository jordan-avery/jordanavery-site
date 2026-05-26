export interface CardSignature {
  winner: string;
  text: string | null;
  drawing: string | null;
  date: string;
}

export interface Card {
  id: string;
  color: 'red' | 'yellow' | 'blue' | 'green' | 'wild';
  type: 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';
  value: number | null;
  typeKey: string;
  signatures: CardSignature[];
}

export interface PublicPlayer {
  socketId: string;
  name: string;
  cardCount: number;
  hasCalledUno: boolean;
  unoEligible: boolean;
  index: number;
}

export interface PendingDraw {
  amount: number;
  type: '+2' | '+4';
  targetIndex: number;
  endsAt: number;
}

export interface SlapState {
  slappers: string[];
  active: boolean;
}

export interface HelpState {
  requestingPlayerId: string;
  offers: Array<{ fromPlayerId: string; fromPlayerName: string }>;
}

export interface ZeroTradeState {
  initiatorSocketId: string;
}

export interface UnoState {
  playerId: string;
  playerName: string;
  expired: boolean;
}

export interface PileSelectState {
  pileCount: number;
  claims: Record<number, string>; // pileIndex -> socketId
}

export interface GameState {
  phase: 'pile-select' | 'starting' | 'playing' | 'pending-draw' | 'help' | 'zero-trade' | 'slap' | 'winner';
  topCard: Card | null;
  currentColor: 'red' | 'yellow' | 'blue' | 'green' | 'wild';
  currentPlayerIndex: number;
  direction: 1 | -1;
  deckCount: number;
  pendingDraw: PendingDraw | null;
  slapState: SlapState | null;
  helpState: HelpState | null;
  zeroTradeState: ZeroTradeState | null;
  wildPlayerId: string | null;
  winner: string | null;
  winnerName: string | null;
  winnerCard: Card | null;
  unoState: UnoState | null;
  startingState: { firstPlayerIndex: number } | null;
  pileSelectState: PileSelectState | null;
}

export interface RoomState {
  code: string;
  status: 'lobby' | 'playing' | 'ended';
  hostSocketId: string;
  players: PublicPlayer[];
  spectators: Array<{ socketId: string; name: string }>;
  game: GameState | null;
}

export type SortMode = 'color-number' | 'number-color';

export type UnoColor = 'red' | 'yellow' | 'blue' | 'green';
