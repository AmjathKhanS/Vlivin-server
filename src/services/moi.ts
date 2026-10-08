import type { MoiItem, MoiType } from '../domain/types.js';
import { forbidden, notFound } from '../lib/errors.js';
import { newId } from '../lib/util.js';
import { requireCouple, notifyPartner, type Ctx } from './context.js';

export async function saveMoiItem(
  ctx: Ctx, userId: string, type: MoiType, payload: Record<string, unknown>, unlockAt?: Date | null,
): Promise<MoiItem> {
  const { couple } = await requireCouple(ctx, userId);
  return ctx.store.saveMoi({
    id: newId(), coupleId: couple.id, authorId: userId, type, payload,
    unlockAt: unlockAt ?? null, createdAt: ctx.clock(),
  });
}

/** Sealed letters hide their body from the recipient until `unlockAt`. */
function view(ctx: Ctx, item: MoiItem, viewerId: string) {
  const sealed = !!item.unlockAt && item.unlockAt > ctx.clock() && item.authorId !== viewerId;
  const base = {
    id: item.id, type: item.type, authorId: item.authorId, mine: item.authorId === viewerId,
    createdAt: item.createdAt.toISOString(), unlockAt: item.unlockAt?.toISOString() ?? null,
    sealed,
  };
  if (!sealed) return { ...base, payload: item.payload };
  const { title } = item.payload as { title?: string };
  return { ...base, payload: { title: title ?? null } };
}

export async function listMoi(ctx: Ctx, userId: string, type?: MoiType) {
  const { couple } = await requireCouple(ctx, userId);
  const items = await ctx.store.listMoi(couple.id);
  return items.filter((i) => !type || i.type === type).map((i) => view(ctx, i, userId));
}

export async function writeLetter(
  ctx: Ctx, userId: string, input: { title?: string; body: string; unlockAt?: Date },
) {
  const item = await saveMoiItem(
    ctx, userId, 'letter', { title: input.title?.trim() || null, body: input.body.trim() },
    input.unlockAt ?? null,
  );
  const { partnerId } = await requireCouple(ctx, userId);
  const [me, partner] = await Promise.all([ctx.store.getUser(userId), ctx.store.getUser(partnerId)]);
  await notifyPartner(ctx, partner, {
    title: 'A letter for you',
    body: item.unlockAt ? `${me?.name ?? 'Your person'} sealed a letter for you` : `${me?.name ?? 'Your person'} wrote you a letter`,
    data: { type: 'letter', itemId: item.id },
  });
  return view(ctx, item, userId);
}

export async function addPhoto(ctx: Ctx, userId: string, url: string, caption?: string) {
  const item = await saveMoiItem(ctx, userId, 'photo', { url, caption: caption?.trim() || null });
  return view(ctx, item, userId);
}

export async function deleteMoi(ctx: Ctx, userId: string, id: string) {
  const item = await ctx.store.getMoi(id);
  const { couple } = await requireCouple(ctx, userId);
  if (!item || item.coupleId !== couple.id) throw notFound('moi_not_found', 'Item not found');
  if (item.authorId !== userId) throw forbidden('not_author', 'Only the author can delete this');
  await ctx.store.deleteMoi(id);
}
