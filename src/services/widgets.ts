import { daysBetween } from '../lib/util.js';
import { requireCouple, type Ctx } from './context.js';
import { distanceBetween } from './couple.js';

/** Single payload for the WidgetKit / Glance widgets (the `couple_summary` endpoint). */
export async function coupleSummary(ctx: Ctx, userId: string) {
  const { couple, partnerId } = await requireCouple(ctx, userId);
  const [me, partner, partnerMood, board] = await Promise.all([
    ctx.store.getUser(userId), ctx.store.getUser(partnerId), ctx.store.latestMood(partnerId),
    ctx.store.getLatestBoard(couple.id),
  ]);
  const now = ctx.clock();
  const latestDoodle = board?.snapshotUrl
    ? { snapshotUrl: board.snapshotUrl, savedAt: board.savedAt?.toISOString() ?? null } : null;
  return {
    partnerName: partner?.name ?? null,
    daysTogether: couple.togetherSince ? daysBetween(new Date(couple.togetherSince), now) + 1 : null,
    daysToGo: couple.meetDate ? Math.max(0, daysBetween(now, new Date(couple.meetDate))) : null,
    meetDate: couple.meetDate,
    distanceKm: me && partner ? await distanceBetween(ctx, me, partner) : null,
    partnerMood: partnerMood
      ? { mood: partnerMood.mood, note: partnerMood.note, at: partnerMood.createdAt.toISOString() }
      : null,
    latestDoodle,
    generatedAt: now.toISOString(),
  };
}
