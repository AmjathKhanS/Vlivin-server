import type { Couple, User } from '../domain/types.js';
import { conflict, badRequest, notFound } from '../lib/errors.js';
import { daysBetween, haversineKm, localTime, newId, randomPairCode } from '../lib/util.js';
import { publicUser, requireCouple, type Ctx } from './context.js';

export async function createPairCode(ctx: Ctx, userId: string) {
  if (await ctx.store.getCoupleByUser(userId)) throw conflict('already_paired', 'You are already paired');
  const now = ctx.clock();
  const expiresAt = new Date(now.getTime() + ctx.config.PAIR_CODE_TTL_HOURS * 3_600_000);
  let code = randomPairCode();
  while (await ctx.store.getPairCode(code)) code = randomPairCode();
  await ctx.store.replacePairCode({ code, userId, expiresAt });
  return { code, expiresAt: expiresAt.toISOString() };
}

export async function joinWithCode(ctx: Ctx, userId: string, rawCode: string): Promise<Couple> {
  const code = rawCode.trim().toUpperCase();
  if (await ctx.store.getCoupleByUser(userId)) throw conflict('already_paired', 'You are already paired');
  const pc = await ctx.store.getPairCode(code);
  if (!pc || pc.expiresAt <= ctx.clock()) throw notFound('invalid_code', 'This invite code is invalid or expired');
  if (pc.userId === userId) throw badRequest('own_code', "You can't join your own invite code");
  if (await ctx.store.getCoupleByUser(pc.userId)) {
    await ctx.store.deletePairCodesForUser(pc.userId);
    throw notFound('invalid_code', 'This invite code is invalid or expired');
  }
  const couple = await ctx.store.createCouple({
    id: newId(), userA: pc.userId, userB: userId, togetherSince: null, meetDate: null,
    createdAt: ctx.clock(),
  });
  await ctx.store.deletePairCodesForUser(pc.userId);
  await ctx.store.deletePairCodesForUser(userId);
  const me = await ctx.store.getUser(userId);
  const inviter = await ctx.store.getUser(pc.userId);
  if (inviter?.pushToken) {
    await ctx.push.send(inviter.pushToken, {
      title: 'You are paired!', body: `${me?.name ?? 'Your person'} joined you on VLivIn`,
    });
  }
  ctx.hub.broadcast(couple.id, 'couple.paired', { coupleId: couple.id });
  return couple;
}

export async function pairingStatus(ctx: Ctx, userId: string) {
  const couple = await ctx.store.getCoupleByUser(userId);
  if (couple) return { state: 'paired' as const, coupleId: couple.id };
  const pc = await ctx.store.getPairCodeForUser(userId);
  if (pc && pc.expiresAt > ctx.clock()) {
    const msLeft = pc.expiresAt.getTime() - ctx.clock().getTime();
    return {
      state: 'pending' as const, code: pc.code, expiresAt: pc.expiresAt.toISOString(),
      hoursLeft: Math.ceil(msLeft / 3_600_000),
    };
  }
  return { state: 'unpaired' as const };
}

export async function describeCouple(ctx: Ctx, userId: string) {
  const { couple, partnerId } = await requireCouple(ctx, userId);
  const [me, partner] = await Promise.all([ctx.store.getUser(userId), ctx.store.getUser(partnerId)]);
  if (!me || !partner) throw notFound('user_not_found', 'User not found');
  const now = ctx.clock();

  const dayCount = couple.togetherSince
    ? daysBetween(new Date(couple.togetherSince), now) + 1 : null;
  const daysToGo = couple.meetDate
    ? Math.max(0, daysBetween(now, new Date(couple.meetDate))) : null;

  const distanceKm = await distanceBetween(ctx, me, partner);
  return {
    id: couple.id,
    togetherSince: couple.togetherSince,
    meetDate: couple.meetDate,
    dayCount,
    daysToGo,
    distanceKm,
    me: { ...publicUser(me), localTime: localTime(me.tz, now) },
    partner: {
      ...publicUser(partner), localTime: localTime(partner.tz, now),
      online: ctx.hub.isOnline(couple.id, partner.id),
    },
  };
}

/** Distance is only revealed when the partner is actively sharing and I am too. */
export async function distanceBetween(ctx: Ctx, me: User, partner: User): Promise<number | null> {
  const [a, b] = await Promise.all([ctx.store.getLocation(me.id), ctx.store.getLocation(partner.id)]);
  const now = ctx.clock();
  const sharing = (l: typeof a) =>
    !!l && l.sharingMode !== 'off' && l.lat !== null && l.lng !== null &&
    !(l.pausedUntil && l.pausedUntil > now);
  if (!sharing(a) || !sharing(b)) return null;
  return Math.round(haversineKm(a!.lat!, a!.lng!, b!.lat!, b!.lng!));
}

export async function updateCouple(
  ctx: Ctx, userId: string, patch: { togetherSince?: string | null; meetDate?: string | null },
) {
  const { couple } = await requireCouple(ctx, userId);
  const updated = await ctx.store.updateCouple(couple.id, patch);
  ctx.hub.broadcast(couple.id, 'widget.refresh', { reason: 'couple.updated' });
  return updated;
}

export async function unpair(ctx: Ctx, userId: string): Promise<void> {
  const { couple } = await requireCouple(ctx, userId);
  ctx.hub.broadcast(couple.id, 'couple.unpaired', {});
  await ctx.store.deleteCouple(couple.id);
}
