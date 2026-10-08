import type { LocationRecord, SharingMode } from '../domain/types.js';
import { forbidden } from '../lib/errors.js';
import { haversineKm, localTime, daysBetween } from '../lib/util.js';
import { requireCouple, type Ctx } from './context.js';

const blank = (userId: string): LocationRecord => ({
  userId, lat: null, lng: null, updatedAt: null, sharingMode: 'off', pausedUntil: null,
});

export async function setSharing(
  ctx: Ctx, userId: string, mode: SharingMode, pauseMinutes?: number,
): Promise<LocationRecord> {
  const cur = (await ctx.store.getLocation(userId)) ?? blank(userId);
  const pausedUntil = pauseMinutes
    ? new Date(ctx.clock().getTime() + pauseMinutes * 60_000) : null;
  const next: LocationRecord = { ...cur, sharingMode: mode, pausedUntil };
  // Turning sharing off removes the stored coordinates.
  if (mode === 'off') { next.lat = null; next.lng = null; next.updatedAt = null; }
  return ctx.store.upsertLocation(next);
}

export async function updateLocation(ctx: Ctx, userId: string, lat: number, lng: number) {
  const cur = (await ctx.store.getLocation(userId)) ?? blank(userId);
  if (cur.sharingMode === 'off') throw forbidden('sharing_off', 'Turn on location sharing first');
  if (cur.pausedUntil && cur.pausedUntil > ctx.clock()) {
    throw forbidden('sharing_paused', 'Location sharing is paused');
  }
  const saved = await ctx.store.upsertLocation({
    ...cur, lat, lng, updatedAt: ctx.clock(), pausedUntil: null,
  });
  const { couple } = await requireCouple(ctx, userId);
  ctx.hub.broadcast(couple.id, 'location.updated', { userId }, userId);
  return saved;
}

export async function getMyLocationState(ctx: Ctx, userId: string) {
  const l = (await ctx.store.getLocation(userId)) ?? blank(userId);
  return {
    sharingMode: l.sharingMode,
    pausedUntil: l.pausedUntil && l.pausedUntil > ctx.clock() ? l.pausedUntil.toISOString() : null,
    updatedAt: l.updatedAt?.toISOString() ?? null,
  };
}

/** Both pins, distance, last seen, partner local time and the countdown. */
export async function partnerLocation(ctx: Ctx, userId: string) {
  const { couple, partnerId } = await requireCouple(ctx, userId);
  const now = ctx.clock();
  const [partner, mine, theirs] = await Promise.all([
    ctx.store.getUser(partnerId), ctx.store.getLocation(userId), ctx.store.getLocation(partnerId),
  ]);
  const visible = !!theirs && theirs.sharingMode !== 'off' && theirs.lat !== null &&
    !(theirs.pausedUntil && theirs.pausedUntil > now);
  const meVisible = !!mine && mine.lat !== null;
  const distanceKm = visible && meVisible
    ? Math.round(haversineKm(mine!.lat!, mine!.lng!, theirs!.lat!, theirs!.lng!)) : null;
  return {
    partnerSharing: visible,
    partner: visible
      ? { lat: theirs!.lat, lng: theirs!.lng, updatedAt: theirs!.updatedAt?.toISOString() ?? null }
      : null,
    me: meVisible ? { lat: mine!.lat, lng: mine!.lng } : null,
    distanceKm,
    partnerLocalTime: partner ? localTime(partner.tz, now) : null,
    daysToGo: couple.meetDate ? Math.max(0, daysBetween(now, new Date(couple.meetDate))) : null,
  };
}
