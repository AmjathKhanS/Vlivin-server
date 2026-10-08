import { describe, expect, it } from 'vitest';
import { makeApp, pairedCouple, signUp } from './helpers.js';

describe('auth', () => {
  it('signs up with a phone OTP and rejects wrong codes', async () => {
    const { app } = await makeApp();
    const phone = '+919800000001';
    const { devCode } = (await app.inject({ method: 'POST', url: '/v1/auth/phone/request', payload: { phone } })).json();
    const bad = await app.inject({ method: 'POST', url: '/v1/auth/phone/verify', payload: { phone, code: devCode === '000000' ? '111111' : '000000' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/v1/auth/phone/verify', payload: { phone, code: devCode } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().isNew).toBe(true);
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${ok.json().token}` } });
    expect(me.json().pairing.state).toBe('unpaired');
  });

  it('validates phone format, throttles resend and protects routes', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'POST', url: '/v1/auth/phone/request', payload: { phone: '12345' } })).statusCode).toBe(400);
    const phone = '+919800000002';
    await app.inject({ method: 'POST', url: '/v1/auth/phone/request', payload: { phone } });
    expect((await app.inject({ method: 'POST', url: '/v1/auth/phone/request', payload: { phone } })).statusCode).toBe(429);
    expect((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
  });

  it('supports social sign-in with the dev verifier', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/v1/auth/social', payload: { provider: 'google', idToken: 'dev:sub-1:Asha' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe('Asha');
    const again = await app.inject({ method: 'POST', url: '/v1/auth/social', payload: { provider: 'google', idToken: 'dev:sub-1:Asha' } });
    expect(again.json().isNew).toBe(false);
    expect(again.json().user.id).toBe(res.json().user.id);
  });
});

describe('pairing', () => {
  it('pairs two users with an invite code', async () => {
    const { app } = await makeApp();
    const a = await signUp(app, 'Amjath');
    const b = await signUp(app, 'Fahmeda');
    const code = (await app.inject({ method: 'POST', url: '/v1/pairing/code', headers: a.auth })).json();
    expect(code.code).toMatch(/^[A-Z2-9]{6}$/);
    const status = await app.inject({ method: 'GET', url: '/v1/pairing/status', headers: a.auth });
    expect(status.json()).toMatchObject({ state: 'pending', hoursLeft: 24 });

    const join = await app.inject({ method: 'POST', url: '/v1/pairing/join', headers: b.auth, payload: { code: code.code.toLowerCase() } });
    expect(join.statusCode).toBe(201);
    const couple = await app.inject({ method: 'GET', url: '/v1/couple', headers: a.auth });
    expect(couple.json().partner.name).toBe('Fahmeda');
    expect((await app.inject({ method: 'GET', url: '/v1/couple', headers: b.auth })).json().partner.name).toBe('Amjath');
    // code is single-use
    const c = await signUp(app, 'Third');
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/join', headers: c.auth, payload: { code: code.code } })).statusCode).toBe(404);
  });

  it('rejects own code, expired code and double pairing', async () => {
    const { app, clock } = await makeApp();
    const a = await signUp(app); const b = await signUp(app);
    const { code } = (await app.inject({ method: 'POST', url: '/v1/pairing/code', headers: a.auth })).json();
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/join', headers: a.auth, payload: { code } })).json().error.code).toBe('own_code');
    clock.now = new Date(clock.now.getTime() + 25 * 3_600_000);
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/join', headers: b.auth, payload: { code } })).json().error.code).toBe('invalid_code');

    const { a: x } = await pairedCouple(app);
    expect((await app.inject({ method: 'POST', url: '/v1/pairing/code', headers: x.auth })).statusCode).toBe(409);
  });

  it('computes day count and countdown', async () => {
    const { app } = await makeApp(new Date('2026-10-08T10:00:00Z'));
    const { a } = await pairedCouple(app);
    await app.inject({ method: 'PATCH', url: '/v1/couple', headers: a.auth, payload: { togetherSince: '2025-08-17', meetDate: '2026-11-24' } });
    const c = (await app.inject({ method: 'GET', url: '/v1/couple', headers: a.auth })).json();
    expect(c.dayCount).toBe(418);
    expect(c.daysToGo).toBe(47);
  });

  it('blocks couple features until paired', async () => {
    const { app } = await makeApp();
    const a = await signUp(app);
    const res = await app.inject({ method: 'POST', url: '/v1/moods', headers: a.auth, payload: { mood: 'great' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('not_paired');
  });
});
