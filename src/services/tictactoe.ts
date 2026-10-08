import type { Symbol } from '../domain/types.js';

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
] as const;

export function evaluate(board: (Symbol | null)[]):
  | { status: 'won'; winner: Symbol; line: number[] }
  | { status: 'draw' }
  | { status: 'playing' } {
  for (const line of LINES) {
    const [a, b, c] = line;
    const s = board[a];
    if (s && s === board[b] && s === board[c]) return { status: 'won', winner: s, line: [...line] };
  }
  return board.every(Boolean) ? { status: 'draw' } : { status: 'playing' };
}
