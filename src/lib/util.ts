import { randomBytes, randomInt, createHash } from 'node:crypto';

export const newId = (): string => globalThis.crypto.randomUUID();

// Unambiguous alphabet (no 0/O/1/I) for invite codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomPairCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return out;
}

export const randomOtp = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

export const hashOtp = (phone: string, code: string): string =>
  createHash('sha256').update(`${phone}:${code}`).digest('hex');

export const dateKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Whole days between two calendar dates (UTC), b - a. */
export function daysBetween(a: Date, b: Date): number {
  const ms = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
    Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  return Math.round(ms / 86_400_000);
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localTime(tz: string, now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
}

export function stableIndex(seed: string, modulo: number): number {
  const h = createHash('sha256').update(seed).digest();
  return h.readUInt32BE(0) % modulo;
}
