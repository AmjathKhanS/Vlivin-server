import type { Config } from '../config.js';
import type { Hub } from '../realtime/hub.js';
import type { Store } from '../store/store.js';
import type { PushService, PushMessage } from './push.js';
import type { Couple, User } from '../domain/types.js';
import { forbidden } from '../lib/errors.js';

export interface SocialVerifier {
  /** Verify a provider id token and return the stable subject + display name. */
  verify(provider: 'apple' | 'google', idToken: string): Promise<{ sub: string; name?: string }>;
}

export interface SmsSender {
  send(phone: string, text: string): Promise<void>;
}

export interface Ctx {
  config: Config;
  store: Store;
  hub: Hub;
  push: PushService;
  sms: SmsSender;
  social: SocialVerifier | null;
  clock: () => Date;
}

export async function requireCouple(ctx: Ctx, userId: string): Promise<{ couple: Couple; partnerId: string }> {
  const couple = await ctx.store.getCoupleByUser(userId);
  if (!couple) throw forbidden('not_paired', 'You need to pair with your partner first');
  return { couple, partnerId: couple.userA === userId ? couple.userB : couple.userA };
}

export async function notifyPartner(
  ctx: Ctx, partner: User | null, message: PushMessage,
): Promise<void> {
  if (partner?.pushToken) await ctx.push.send(partner.pushToken, message);
}

export function publicUser(u: User) {
  return { id: u.id, name: u.name, city: u.city, tz: u.tz, avatarUrl: u.avatarUrl };
}
