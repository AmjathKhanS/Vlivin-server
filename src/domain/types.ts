export const MOODS = ['great', 'good', 'meh', 'low', 'missing'] as const;
export type Mood = (typeof MOODS)[number];

export interface User {
  id: string;
  name: string;
  phone: string | null;
  appleSub: string | null;
  googleSub: string | null;
  city: string | null;
  tz: string;
  avatarUrl: string | null;
  pushToken: string | null;
  createdAt: Date;
}

export interface Couple {
  id: string;
  userA: string;
  userB: string;
  /** ISO date (YYYY-MM-DD) */
  togetherSince: string | null;
  /** ISO date (YYYY-MM-DD) */
  meetDate: string | null;
  createdAt: Date;
}

export interface PairCode {
  code: string;
  userId: string;
  expiresAt: Date;
}

export interface MoodEntry {
  id: string;
  coupleId: string;
  userId: string;
  mood: Mood;
  note: string | null;
  createdAt: Date;
}

export const SHARING_MODES = ['off', 'always', 'while_using'] as const;
export type SharingMode = (typeof SHARING_MODES)[number];

export interface LocationRecord {
  userId: string;
  lat: number | null;
  lng: number | null;
  updatedAt: Date | null;
  sharingMode: SharingMode;
  pausedUntil: Date | null;
}

export interface Answer {
  questionId: string;
  coupleId: string;
  userId: string;
  text: string;
  createdAt: Date;
}

export type Symbol = 'X' | 'O';
export interface ChatMessage {
  id: string;
  userId: string;
  text: string;
  createdAt: string;
}
export interface GameSession {
  id: string;
  coupleId: string;
  game: 'tic_tac_toe';
  board: (Symbol | null)[];
  players: Record<Symbol, string>;
  turn: string | null;
  status: 'playing' | 'won' | 'draw';
  winner: string | null;
  line: number[] | null;
  /** Wins per user id, plus `draws`. Persists across rematches. */
  score: Record<string, number>;
  chat: ChatMessage[];
  updatedAt: Date;
}

export interface Stroke {
  id: string;
  userId: string;
  color: string;
  size: number;
  points: [number, number][];
}
export interface Board {
  id: string;
  coupleId: string;
  strokes: Stroke[];
  snapshotUrl: string | null;
  savedAt: Date | null;
  createdAt: Date;
}

export type MoiType = 'letter' | 'doodle' | 'photo';
export interface MoiItem {
  id: string;
  coupleId: string;
  authorId: string;
  type: MoiType;
  payload: Record<string, unknown>;
  unlockAt: Date | null;
  createdAt: Date;
}
