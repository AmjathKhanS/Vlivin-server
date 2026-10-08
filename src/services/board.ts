import type { Board, Stroke } from '../domain/types.js';
import { forbidden, notFound, unprocessable } from '../lib/errors.js';
import { newId } from '../lib/util.js';
import { requireCouple, type Ctx } from './context.js';
import { saveMoiItem } from './moi.js';

export const MAX_STROKES = 2000;
export const MAX_POINTS_PER_STROKE = 5000;

export type StrokeInput = { color: string; size: number; points: [number, number][] };

const view = (b: Board) => ({
  id: b.id, strokes: b.strokes, snapshotUrl: b.snapshotUrl,
  savedAt: b.savedAt?.toISOString() ?? null,
});

async function load(ctx: Ctx, userId: string, boardId: string) {
  const b = await ctx.store.getBoard(boardId);
  if (!b) throw notFound('board_not_found', 'Board not found');
  const { couple } = await requireCouple(ctx, userId);
  if (b.coupleId !== couple.id) throw forbidden('not_your_board', 'This board belongs to another couple');
  return b;
}

/** The couple shares one live board; `fresh` starts a new blank one. */
export async function openBoard(ctx: Ctx, userId: string, fresh = false) {
  const { couple } = await requireCouple(ctx, userId);
  const existing = fresh ? null : await ctx.store.getLatestBoard(couple.id);
  if (existing) return view(existing);
  const b = await ctx.store.saveBoard({
    id: newId(), coupleId: couple.id, strokes: [], snapshotUrl: null, savedAt: null,
    createdAt: ctx.clock(),
  });
  return view(b);
}

export async function getBoard(ctx: Ctx, userId: string, boardId: string) {
  return view(await load(ctx, userId, boardId));
}

export async function addStroke(ctx: Ctx, userId: string, boardId: string, input: StrokeInput) {
  const b = await load(ctx, userId, boardId);
  if (b.strokes.length >= MAX_STROKES) throw unprocessable('board_full', 'Board is full. Clear it to keep drawing.');
  if (input.points.length > MAX_POINTS_PER_STROKE) throw unprocessable('stroke_too_long', 'Stroke has too many points');
  const stroke: Stroke = { id: newId(), userId, ...input };
  b.strokes.push(stroke);
  await ctx.store.saveBoard(b);
  ctx.hub.broadcast(b.coupleId, 'board.stroke', { boardId, stroke }, userId);
  return stroke;
}

/** Undo removes only the caller's own most recent stroke. */
export async function undoStroke(ctx: Ctx, userId: string, boardId: string) {
  const b = await load(ctx, userId, boardId);
  for (let i = b.strokes.length - 1; i >= 0; i--) {
    if (b.strokes[i]!.userId === userId) {
      const [removed] = b.strokes.splice(i, 1);
      await ctx.store.saveBoard(b);
      ctx.hub.broadcast(b.coupleId, 'board.undo', { boardId, strokeId: removed!.id }, userId);
      return { removedStrokeId: removed!.id };
    }
  }
  return { removedStrokeId: null };
}

export async function clearBoard(ctx: Ctx, userId: string, boardId: string) {
  const b = await load(ctx, userId, boardId);
  b.strokes = []; b.snapshotUrl = null;
  await ctx.store.saveBoard(b);
  ctx.hub.broadcast(b.coupleId, 'board.clear', { boardId }, userId);
  return view(b);
}

/**
 * Save the board to Moi. The client renders the PNG and uploads it to storage,
 * then sends the resulting URL; we store it and refresh the doodle widget.
 */
export async function saveBoard(ctx: Ctx, userId: string, boardId: string, snapshotUrl: string) {
  const b = await load(ctx, userId, boardId);
  b.snapshotUrl = snapshotUrl; b.savedAt = ctx.clock();
  await ctx.store.saveBoard(b);
  const item = await saveMoiItem(ctx, userId, 'doodle', { boardId, snapshotUrl, strokeCount: b.strokes.length });
  ctx.hub.broadcast(b.coupleId, 'widget.refresh', { reason: 'doodle' });
  return { board: view(b), moiItemId: item.id };
}
