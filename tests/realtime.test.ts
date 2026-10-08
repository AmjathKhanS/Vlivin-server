import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { makeApp, pairedCouple } from './helpers.js';

const next = (ws: WebSocket, type: string) =>
  new Promise<{ type: string; data: any }>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 3000);
    const onMsg = (raw: Buffer) => {
      const m = JSON.parse(raw.toString());
      if (m.type === type) { clearTimeout(t); ws.off('message', onMsg); resolve(m); }
    };
    ws.on('message', onMsg);
  });

const online = async (ctx: any, coupleId: string, userId: string) => {
  for (let i = 0; i < 50 && !ctx.hub.isOnline(coupleId, userId); i++) await new Promise((r) => setTimeout(r, 10));
  expect(ctx.hub.isOnline(coupleId, userId)).toBe(true);
};

describe('realtime', () => {
  const open: WebSocket[] = [];
  afterEach(() => { open.splice(0).forEach((w) => w.close()); });

  it('rejects unauthenticated sockets', async () => {
    const { app } = await makeApp();
    const ws = await app.injectWS('/v1/ws?token=nope');
    const code = await new Promise<number>((r) => ws.on('close', (c) => r(c)));
    expect(code).toBe(4401);
  });

  it('syncs tic tac toe moves, chat, strokes and presence between partners', async () => {
    const { app, ctx } = await makeApp();
    const { a, b, coupleId } = await pairedCouple(app);

    const wsA = await app.injectWS(`/v1/ws?token=${a.token}`); open.push(wsA);
    await online(ctx, coupleId, a.id);
    const presence = next(wsA, 'presence');
    const wsB = await app.injectWS(`/v1/ws?token=${b.token}`); open.push(wsB);
    await online(ctx, coupleId, b.id);
    expect((await presence).data).toEqual({ userId: b.id, online: true });

    const g = (await app.inject({ method: 'POST', url: '/v1/games/tic-tac-toe', headers: a.auth })).json();

    const bSees = next(wsB, 'game.updated');
    wsA.send(JSON.stringify({ type: 'game.move', gameId: g.id, cell: 4 }));
    const update = (await bSees).data;
    expect(update.board[4]).toBe('X');
    expect(update.yourTurn).toBe(true); // perspective of B

    const chat = next(wsA, 'game.chat');
    wsB.send(JSON.stringify({ type: 'game.chat', gameId: g.id, text: 'nice one' }));
    expect((await chat).data.message.text).toBe('nice one');

    const board = (await app.inject({ method: 'POST', url: '/v1/boards', headers: a.auth })).json();
    const stroke = next(wsB, 'board.stroke');
    wsA.send(JSON.stringify({ type: 'board.stroke', boardId: board.id, stroke: { color: '#22A060', size: 22, points: [[0, 0], [5, 5]] } }));
    expect((await stroke).data.stroke.color).toBe('#22A060');

    const err = next(wsB, 'error');
    wsB.send(JSON.stringify({ type: 'game.move', gameId: g.id, cell: 4 }));
    expect((await err).data.code).toBe('cell_taken');
  });

  it('broadcasts offline presence when a partner disconnects (real socket)', async () => {
    const { app, ctx } = await makeApp();
    const { a, b, coupleId } = await pairedCouple(app);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const connect = (token: string) => new Promise<WebSocket>((resolve) => {
      const w = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?token=${token}`);
      w.on('open', () => resolve(w));
    });
    const wsA = await connect(a.token); const wsB = await connect(b.token);
    open.push(wsA, wsB);
    await online(ctx, coupleId, a.id); await online(ctx, coupleId, b.id);
    const off = next(wsB, 'presence');
    wsA.close();
    expect((await off).data).toEqual({ userId: a.id, online: false });
    await app.close();
  });
});
