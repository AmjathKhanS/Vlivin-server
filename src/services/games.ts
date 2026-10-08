import type { ChatMessage, GameSession, Symbol } from '../domain/types.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { newId } from '../lib/util.js';
import { requireCouple, notifyPartner, type Ctx } from './context.js';
import { evaluate } from './tictactoe.js';

export const GAME_CATALOG = [
  { id: 'chess', name: 'Chess', available: false },
  { id: 'ludo', name: 'Ludo', available: false },
  { id: 'carrom', name: 'Carrom', available: false },
  { id: 'sea_battle', name: 'Sea Battle', available: false },
  { id: 'four_in_a_row', name: 'Four in a Row', available: false },
  { id: 'snakes_ladders', name: 'Snakes & Ladders', available: false },
  { id: 'tic_tac_toe', name: 'Tic Tac Toe', available: true },
  { id: 'draw', name: 'Draw together', available: true },
] as const;

const MAX_CHAT = 100;

export function gameView(g: GameSession, viewerId: string) {
  const mySymbol: Symbol = g.players.X === viewerId ? 'X' : 'O';
  const partnerId = g.players[mySymbol === 'X' ? 'O' : 'X'];
  return {
    id: g.id, game: g.game, board: g.board, status: g.status, line: g.line,
    mySymbol, turn: g.turn, yourTurn: g.status === 'playing' && g.turn === viewerId,
    winner: g.winner,
    score: { me: g.score[viewerId] ?? 0, partner: g.score[partnerId] ?? 0, draws: g.score.draws ?? 0 },
    chat: g.chat, updatedAt: g.updatedAt.toISOString(),
  };
}

/** Fan out each viewer's own perspective (mySymbol / yourTurn differ per player). */
function publish(ctx: Ctx, g: GameSession, type: string) {
  for (const uid of [g.players.X, g.players.O]) {
    ctx.hub.sendTo(g.coupleId, uid, type, gameView(g, uid));
  }
  ctx.hub.broadcast(g.coupleId, 'widget.refresh', { reason: 'game' });
}

async function loadForPlayer(ctx: Ctx, userId: string, gameId: string) {
  const g = await ctx.store.getGame(gameId);
  if (!g) throw notFound('game_not_found', 'Game not found');
  const { couple } = await requireCouple(ctx, userId);
  if (g.coupleId !== couple.id) throw forbidden('not_your_game', 'This game belongs to another couple');
  return g;
}

/** Get the couple's current Tic Tac Toe session, creating one the first time. */
export async function startTicTacToe(ctx: Ctx, userId: string) {
  const { couple, partnerId } = await requireCouple(ctx, userId);
  const existing = await ctx.store.getLatestGame(couple.id, 'tic_tac_toe');
  if (existing) return gameView(existing, userId);
  const g: GameSession = {
    id: newId(), coupleId: couple.id, game: 'tic_tac_toe', board: Array(9).fill(null),
    players: { X: userId, O: partnerId }, turn: userId, status: 'playing', winner: null,
    line: null, score: { [userId]: 0, [partnerId]: 0, draws: 0 }, chat: [], updatedAt: ctx.clock(),
  };
  await ctx.store.saveGame(g);
  const partner = await ctx.store.getUser(partnerId);
  const me = await ctx.store.getUser(userId);
  await notifyPartner(ctx, partner, {
    title: 'Tic Tac Toe', body: `${me?.name ?? 'Your person'} wants to play`, data: { type: 'game', gameId: g.id },
  });
  publish(ctx, g, 'game.updated');
  return gameView(g, userId);
}

export async function getGame(ctx: Ctx, userId: string, gameId: string) {
  return gameView(await loadForPlayer(ctx, userId, gameId), userId);
}

export async function playMove(ctx: Ctx, userId: string, gameId: string, cell: number) {
  const g = await loadForPlayer(ctx, userId, gameId);
  if (g.status !== 'playing') throw conflict('game_over', 'This round is over. Start a rematch.');
  if (g.turn !== userId) throw conflict('not_your_turn', "It's not your turn");
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) throw unprocessable('invalid_cell', 'Cell must be 0-8');
  if (g.board[cell]) throw conflict('cell_taken', 'That cell is already taken');

  const symbol: Symbol = g.players.X === userId ? 'X' : 'O';
  g.board[cell] = symbol;
  const result = evaluate(g.board);
  const other = g.players[symbol === 'X' ? 'O' : 'X'];
  if (result.status === 'won') {
    g.status = 'won'; g.winner = userId; g.line = result.line; g.turn = null;
    g.score[userId] = (g.score[userId] ?? 0) + 1;
  } else if (result.status === 'draw') {
    g.status = 'draw'; g.turn = null; g.score.draws = (g.score.draws ?? 0) + 1;
  } else {
    g.turn = other;
  }
  g.updatedAt = ctx.clock();
  await ctx.store.saveGame(g);
  publish(ctx, g, 'game.updated');
  return gameView(g, userId);
}

/** New round: keep the score, swap who is X and who starts. */
export async function rematch(ctx: Ctx, userId: string, gameId: string) {
  const g = await loadForPlayer(ctx, userId, gameId);
  if (g.status === 'playing') throw conflict('round_in_progress', 'The current round is not finished');
  g.players = { X: g.players.O, O: g.players.X };
  g.board = Array(9).fill(null);
  g.status = 'playing'; g.winner = null; g.line = null; g.turn = g.players.X;
  g.updatedAt = ctx.clock();
  await ctx.store.saveGame(g);
  publish(ctx, g, 'game.updated');
  return gameView(g, userId);
}

export async function sendChat(ctx: Ctx, userId: string, gameId: string, text: string) {
  const g = await loadForPlayer(ctx, userId, gameId);
  const clean = text.trim();
  if (!clean) throw unprocessable('empty_message', 'Message cannot be empty');
  const msg: ChatMessage = {
    id: newId(), userId, text: clean.slice(0, 500), createdAt: ctx.clock().toISOString(),
  };
  g.chat = [...g.chat, msg].slice(-MAX_CHAT);
  await ctx.store.saveGame(g);
  ctx.hub.broadcast(g.coupleId, 'game.chat', { gameId: g.id, message: msg });
  return msg;
}
