import type { User } from '../domain/types.js';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';
import { hashOtp, isValidTimeZone, newId, randomOtp } from '../lib/util.js';
import type { Ctx } from './context.js';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_MS = 30_000;

interface OtpRecord { hash: string; expiresAt: number; attempts: number; sentAt: number }

export class AuthService {
  private otps = new Map<string, OtpRecord>();
  constructor(private ctx: Ctx) {}

  /** Returns the code only outside production (or in ALLOW_DEV_AUTH staging) so testers can sign in without SMS. */
  async requestOtp(phone: string): Promise<{ devCode?: string }> {
    const now = this.ctx.clock().getTime();
    const existing = this.otps.get(phone);
    if (existing && now - existing.sentAt < OTP_RESEND_MS) {
      throw new AppError(429, 'otp_too_soon', 'Please wait before requesting another code');
    }
    const code = randomOtp();
    this.otps.set(phone, {
      hash: hashOtp(phone, code), expiresAt: now + OTP_TTL_MS, attempts: 0, sentAt: now,
    });
    await this.ctx.sms.send(phone, `Your VLivIn code is ${code}`);
    const exposeCode = this.ctx.config.NODE_ENV !== 'production' || this.ctx.config.ALLOW_DEV_AUTH;
    return exposeCode ? { devCode: code } : {};
  }

  async verifyOtp(phone: string, code: string): Promise<{ user: User; isNew: boolean }> {
    const rec = this.otps.get(phone);
    const now = this.ctx.clock().getTime();
    if (!rec || rec.expiresAt < now) throw badRequest('otp_invalid', 'Code is invalid or expired');
    rec.attempts += 1;
    if (rec.attempts > OTP_MAX_ATTEMPTS) {
      this.otps.delete(phone);
      throw badRequest('otp_invalid', 'Code is invalid or expired');
    }
    if (rec.hash !== hashOtp(phone, code)) throw badRequest('otp_invalid', 'Code is invalid or expired');
    this.otps.delete(phone);

    const found = await this.ctx.store.findUserByPhone(phone);
    if (found) return { user: found, isNew: false };
    return { user: await this.createUser({ phone }), isNew: true };
  }

  async socialSignIn(
    provider: 'apple' | 'google', idToken: string,
  ): Promise<{ user: User; isNew: boolean }> {
    if (!this.ctx.social) throw new AppError(501, 'social_not_configured', 'Social sign-in is not configured');
    let identity;
    try {
      identity = await this.ctx.social.verify(provider, idToken);
    } catch {
      throw unauthorized('Invalid sign-in token');
    }
    const found = await this.ctx.store.findUserBySocial(provider, identity.sub);
    if (found) return { user: found, isNew: false };
    const user = await this.createUser({
      name: identity.name,
      ...(provider === 'apple' ? { appleSub: identity.sub } : { googleSub: identity.sub }),
    });
    return { user, isNew: true };
  }

  private createUser(init: Partial<User>): Promise<User> {
    return this.ctx.store.createUser({
      id: newId(), name: init.name?.trim() || 'Friend', phone: init.phone ?? null,
      appleSub: init.appleSub ?? null, googleSub: init.googleSub ?? null,
      city: null, tz: 'UTC', avatarUrl: null, pushToken: null, createdAt: this.ctx.clock(),
    });
  }
}

export async function updateProfile(
  ctx: Ctx, userId: string,
  patch: { name?: string; city?: string | null; tz?: string; avatarUrl?: string | null },
): Promise<User> {
  if (patch.tz !== undefined && !isValidTimeZone(patch.tz)) {
    throw badRequest('invalid_timezone', 'Unknown IANA time zone');
  }
  return ctx.store.updateUser(userId, patch);
}
