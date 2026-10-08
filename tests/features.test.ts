import { describe, expect, it } from 'vitest';
import { makeApp, pairedCouple } from './helpers.js';

describe('mood & hugs', () => {
  it('saves a mood, notifies partner and shows the weekly grid', async () => {
    const { app, push } = await makeApp();
    const { a, b } = await pairedCouple(app);
    await app.inject({ method: 'PUT', url: '/v1/me/push-token', headers: b.auth, payload: { token: 'ExponentPushToken[abcdefgh]' } });
    const res = await app.inject({ method: 'POST', url: '/v1/moods', headers: a.auth, payload: { mood: 'missing', note: 'Wish you were here' } });
    expect(res.statusCode).toBe(201);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]!.message.body).toContain('missing you');

    const week = (await app.inject({ method: 'GET', url: '/v1/moods/week', headers: b.auth })).json();
    expect(week.days).toHaveLength(7);
    expect(week.partner[6].mood).toBe('missing');
    expect(week.me[6].mood).toBeNull();

    expect((await app.inject({ method: 'POST', url: '/v1/moods', headers: a.auth, payload: { mood: 'angry' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/hugs', headers: a.auth })).statusCode).toBe(200);
  });
});

describe('location', () => {
  it('is opt-in, computes distance and honours pause', async () => {
    const { app } = await makeApp();
    const { a, b } = await pairedCouple(app);
    expect((await app.inject({ method: 'PUT', url: '/v1/location', headers: a.auth, payload: { lat: 13.08, lng: 80.27 } })).statusCode).toBe(403);

    await app.inject({ method: 'PUT', url: '/v1/location/sharing', headers: a.auth, payload: { mode: 'always' } });
    await app.inject({ method: 'PUT', url: '/v1/location/sharing', headers: b.auth, payload: { mode: 'while_using' } });
    await app.inject({ method: 'PUT', url: '/v1/location', headers: a.auth, payload: { lat: 13.0827, lng: 80.2707 } }); // Chennai
    await app.inject({ method: 'PUT', url: '/v1/location', headers: b.auth, payload: { lat: 51.5072, lng: -0.1276 } }); // London

    const p = (await app.inject({ method: 'GET', url: '/v1/location/partner', headers: a.auth })).json();
    expect(p.partnerSharing).toBe(true);
    expect(p.distanceKm).toBeGreaterThan(8000);
    expect(p.distanceKm).toBeLessThan(9000);

    await app.inject({ method: 'PUT', url: '/v1/location/sharing', headers: b.auth, payload: { mode: 'while_using', pauseMinutes: 60 } });
    const paused = (await app.inject({ method: 'GET', url: '/v1/location/partner', headers: a.auth })).json();
    expect(paused.partnerSharing).toBe(false);
    expect(paused.partner).toBeNull();

    await app.inject({ method: 'PUT', url: '/v1/location/sharing', headers: b.auth, payload: { mode: 'off' } });
    const off = (await app.inject({ method: 'GET', url: '/v1/location/partner', headers: a.auth })).json();
    expect(off.partnerSharing).toBe(false);
  });
});

describe('daily question', () => {
  it('hides the partner answer until you answer', async () => {
    const { app } = await makeApp();
    const { a, b } = await pairedCouple(app);
    const q = (await app.inject({ method: 'GET', url: '/v1/questions/today', headers: a.auth })).json();
    const qb = (await app.inject({ method: 'GET', url: '/v1/questions/today', headers: b.auth })).json();
    expect(qb.id).toBe(q.id);

    await app.inject({ method: 'POST', url: `/v1/questions/${q.id}/answer`, headers: a.auth, payload: { text: 'Pizza' } });
    const bView = (await app.inject({ method: 'GET', url: '/v1/questions/today', headers: b.auth })).json();
    expect(bView.partnerAnswered).toBe(true);
    expect(bView.partnerAnswer).toBeNull();

    const after = (await app.inject({ method: 'POST', url: `/v1/questions/${q.id}/answer`, headers: b.auth, payload: { text: 'Biryani' } })).json();
    expect(after.partnerAnswer.text).toBe('Pizza');
    expect((await app.inject({ method: 'POST', url: '/v1/questions/nope/answer', headers: a.auth, payload: { text: 'x' } })).statusCode).toBe(404);
  });
});

describe('Moi', () => {
  it('seals letters until their unlock date', async () => {
    const { app, clock } = await makeApp();
    const { a, b } = await pairedCouple(app);
    const unlockAt = new Date(clock.now.getTime() + 5 * 86_400_000).toISOString();
    expect((await app.inject({ method: 'POST', url: '/v1/moi/letters', headers: a.auth, payload: { title: 'Open on Aug 12', body: 'I love you', unlockAt: '2020-01-01T00:00:00Z' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/moi/letters', headers: a.auth, payload: { title: 'Open later', body: 'I love you', unlockAt } })).statusCode).toBe(201);

    const forB = (await app.inject({ method: 'GET', url: '/v1/moi?type=letter', headers: b.auth })).json();
    expect(forB[0].sealed).toBe(true);
    expect(forB[0].payload.body).toBeUndefined();
    const forA = (await app.inject({ method: 'GET', url: '/v1/moi?type=letter', headers: a.auth })).json();
    expect(forA[0].payload.body).toBe('I love you');

    clock.now = new Date(clock.now.getTime() + 6 * 86_400_000);
    const opened = (await app.inject({ method: 'GET', url: '/v1/moi', headers: b.auth })).json();
    expect(opened[0].sealed).toBe(false);
    expect(opened[0].payload.body).toBe('I love you');

    // only the author can delete
    expect((await app.inject({ method: 'DELETE', url: `/v1/moi/${opened[0].id}`, headers: b.auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/v1/moi/${opened[0].id}`, headers: a.auth })).statusCode).toBe(204);
  });
});
