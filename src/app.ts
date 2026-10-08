import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig, type Config } from './config.js';
import { AppError, unauthorized } from './lib/errors.js';
import { Hub } from './realtime/hub.js';
import { registerWs } from './realtime/ws.js';
import { registerRoutes } from './routes/index.js';
import { AuthService } from './services/auth.js';
import type { Ctx, SmsSender, SocialVerifier } from './services/context.js';
import { ExpoPushService, OutboxPushService, type PushService } from './services/push.js';
import { MemoryStore } from './store/memory.js';
import type { Store } from './store/store.js';

export interface AppDeps {
  config?: Config;
  store?: Store;
  push?: PushService;
  sms?: SmsSender;
  social?: SocialVerifier | null;
  clock?: () => Date;
  hub?: Hub;
}

/** Dev-only verifier: accepts `dev:<sub>:<name>` tokens. Never enabled in production. */
const devSocialVerifier: SocialVerifier = {
  async verify(_provider, idToken) {
    const [prefix, sub, name] = idToken.split(':');
    if (prefix !== 'dev' || !sub) throw new Error('bad token');
    return { sub, name };
  },
};

export async function buildApp(deps: AppDeps = {}): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const config = deps.config ?? loadConfig();
  const isProd = config.NODE_ENV === 'production';
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: isProd ? 'info' : 'debug' },
    trustProxy: true,
  });

  const ctx: Ctx = {
    config,
    store: deps.store ?? new MemoryStore(),
    hub: deps.hub ?? new Hub(),
    push: deps.push ??
      (config.EXPO_ACCESS_TOKEN ? new ExpoPushService(config.EXPO_ACCESS_TOKEN, (m) => app.log.warn(m)) : new OutboxPushService()),
    sms: deps.sms ?? { send: async (phone) => { app.log.info({ phone }, 'SMS provider not configured; OTP not sent'); } },
    social: deps.social !== undefined ? deps.social : isProd && !config.ALLOW_DEV_AUTH ? null : devSocialVerifier,
    clock: deps.clock ?? (() => new Date()),
  };

  if (config.ALLOW_DEV_AUTH && isProd) {
    app.log.warn('ALLOW_DEV_AUTH is on: sign-in codes are returned in API responses. Staging only!');
  }

  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGINS === '*' ? true : config.CORS_ORIGINS.split(',').map((s) => s.trim()),
  });
  // Route-level limits (OTP, pairing) apply outside tests.
  if (config.NODE_ENV !== 'test') await app.register(rateLimit, { global: false });
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: config.JWT_EXPIRES_IN } });
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });

  app.decorate('authenticate', async (req) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized();
    }
    // Reject tokens for users that no longer exist.
    if (!(await ctx.store.getUser(req.user.sub))) throw unauthorized();
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: 'bad_request', message: err.message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong' } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'Route not found' } }));

  registerRoutes(app, ctx, new AuthService(ctx));
  registerWs(app, ctx);
  return { app, ctx };
}
