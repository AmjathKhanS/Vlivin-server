import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { OutboxPushService } from '../src/services/push.js';

export async function makeApp(now = new Date('2026-10-08T10:00:00Z')) {
  const clock = { now };
  const push = new OutboxPushService();
  const { app, ctx } = await buildApp({
    config: loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-1234' }),
    push,
    clock: () => clock.now,
  });
  await app.ready();
  return { app, ctx, push, clock };
}

export interface Person { token: string; id: string; auth: { authorization: string } }

let phoneCounter = 0;
export async function signUp(app: FastifyInstance, name = 'Tester'): Promise<Person> {
  const phone = `+9198765${String(10000 + phoneCounter++)}`;
  const req = await app.inject({ method: 'POST', url: '/v1/auth/phone/request', payload: { phone } });
  const { devCode } = req.json();
  const res = await app.inject({ method: 'POST', url: '/v1/auth/phone/verify', payload: { phone, code: devCode } });
  const body = res.json();
  const auth = { authorization: `Bearer ${body.token}` };
  await app.inject({ method: 'PATCH', url: '/v1/me', headers: auth, payload: { name } });
  return { token: body.token, id: body.user.id, auth };
}

export async function pairedCouple(app: FastifyInstance) {
  const a = await signUp(app, 'Amjath');
  const b = await signUp(app, 'Fahmeda');
  const code = (await app.inject({ method: 'POST', url: '/v1/pairing/code', headers: a.auth })).json().code;
  const join = await app.inject({ method: 'POST', url: '/v1/pairing/join', headers: b.auth, payload: { code } });
  return { a, b, coupleId: join.json().coupleId as string };
}
