import type { Mood, MoodEntry } from '../domain/types.js';
import { newId } from '../lib/util.js';
import { notifyPartner, requireCouple, type Ctx } from './context.js';

const MOOD_LABEL: Record<Mood, string> = {
  great: 'feeling great', good: 'feeling good', meh: 'feeling meh', low: 'feeling low',
  missing: 'missing you',
};

const view = (m: MoodEntry) => ({
  id: m.id, mood: m.mood, note: m.note, createdAt: m.createdAt.toISOString(),
});

export async function saveMood(ctx: Ctx, userId: string, mood: Mood, note?: string | null) {
  const { couple, partnerId } = await requireCouple(ctx, userId);
  const entry = await ctx.store.addMood({
    id: newId(), coupleId: couple.id, userId, mood, note: note?.trim() || null,
    createdAt: ctx.clock(),
  });
  const [me, partner] = await Promise.all([ctx.store.getUser(userId), ctx.store.getUser(partnerId)]);
  ctx.hub.broadcast(couple.id, 'mood.updated', { userId, ...view(entry) }, userId);
  ctx.hub.broadcast(couple.id, 'widget.refresh', { reason: 'mood' });
  await notifyPartner(ctx, partner, {
    title: me?.name ?? 'Your person', body: `is ${MOOD_LABEL[mood]}`,
    data: { type: 'mood', mood },
  });
  return view(entry);
}

/** Last 7 days (including today), latest mood per day for both partners. */
export async function weeklyMoods(ctx: Ctx, userId: string) {
  const { couple, partnerId } = await requireCouple(ctx, userId);
  const now = ctx.clock();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
  const entries = await ctx.store.listMoods(couple.id, start);
  const days = Array.from({ length: 7 }, (_, i) =>
    new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const build = (uid: string) => days.map((date) => {
    const day = entries.filter((e) => e.userId === uid && e.createdAt.toISOString().slice(0, 10) === date);
    const last = day[day.length - 1];
    return { date, mood: last?.mood ?? null, note: last?.note ?? null };
  });
  return { days, me: build(userId), partner: build(partnerId) };
}

export async function sendHug(ctx: Ctx, userId: string) {
  const { couple, partnerId } = await requireCouple(ctx, userId);
  const [me, partner] = await Promise.all([ctx.store.getUser(userId), ctx.store.getUser(partnerId)]);
  const sentAt = ctx.clock().toISOString();
  ctx.hub.broadcast(couple.id, 'hug.received', { from: userId, sentAt }, userId);
  await notifyPartner(ctx, partner, {
    title: `${me?.name ?? 'Your person'} sent you a hug`, body: 'Tap to hug back',
    data: { type: 'hug' },
  });
  return { sentAt };
}
