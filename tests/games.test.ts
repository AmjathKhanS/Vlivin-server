import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/services/tictactoe.js';
import { makeApp, pairedCouple } from './helpers.js';

describe('tic tac toe rules', () => {
  it('detects all 8 winning lines, draws and in-progress boards', () => {
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const line of lines) {
      const b: ('X' | 'O' | null)[] = Array(9).fill(null);
      line.forEach((i) => (b[i] = 'O'));
      expect(evaluate(b)).toMatchObject({ status: 'won', winner: 'O', line });
    }
    expect(evaluate(['X','O','X','X','O','O','O','X','X'])).toEqual({ status: 'draw' });
    expect(evaluate(Array(9).fill(null))).toEqual({ status: 'playing' });
  });
});

describe('tic tac toe game', () => {
  it('plays a full round, tracks score and rematches', async () => {
    const { app } = await makeApp();
    const { a, b } = await pairedCouple(app);
    const g = (await app.inject({ method: 'POST', url: '/v1/games/tic-tac-toe', headers: a.auth })).json();
    expect(g.yourTurn).toBe(true);
    // idempotent: partner gets the same session
    const gb = (await app.inject({ method: 'POST', url: '/v1/games/tic-tac-toe', headers: b.auth })).json();
    expect(gb.id).toBe(g.id);
    expect(gb.yourTurn).toBe(false);

    const move = (who: typeof a, cell: number) =>
      app.inject({ method: 'POST', url: `/v1/games/${g.id}/moves`, headers: who.auth, payload: { cell } });

    expect((await move(b, 0)).json().error.code).toBe('not_your_turn');
    await move(a, 0); await move(b, 3); await move(a, 1);
    expect((await move(a, 5)).json().error.code).toBe('not_your_turn');
    expect((await move(b, 1)).json().error.code).toBe('cell_taken');
    await move(b, 4);
    const win = (await move(a, 2)).json();
    expect(win.status).toBe('won');
    expect(win.line).toEqual([0, 1, 2]);
    expect(win.score).toEqual({ me: 1, partner: 0, draws: 0 });
    expect((await move(b, 8)).json().error.code).toBe('game_over');

    expect((await app.inject({ method: 'POST', url: `/v1/games/${g.id}/rematch`, headers: b.auth })).json()).toMatchObject({
      status: 'playing', yourTurn: true, mySymbol: 'X', score: { me: 0, partner: 1, draws: 0 },
    });
  });

  it('keeps games private to the couple and supports chat', async () => {
    const { app } = await makeApp();
    const { a } = await pairedCouple(app);
    const other = await pairedCouple(app);
    const g = (await app.inject({ method: 'POST', url: '/v1/games/tic-tac-toe', headers: a.auth })).json();
    expect((await app.inject({ method: 'GET', url: `/v1/games/${g.id}`, headers: other.a.auth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/v1/games/${g.id}/chat`, headers: a.auth, payload: { text: 'gl hf' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: `/v1/games/${g.id}`, headers: a.auth })).json().chat).toHaveLength(1);
  });
});

describe('drawing board', () => {
  const stroke = { color: '#F2416B', size: 9, points: [[1, 1], [2, 2]] };
  it('adds strokes, undoes only your own, clears and saves to Moi', async () => {
    const { app } = await makeApp();
    const { a, b } = await pairedCouple(app);
    const board = (await app.inject({ method: 'POST', url: '/v1/boards', headers: a.auth })).json();
    expect((await app.inject({ method: 'POST', url: '/v1/boards', headers: b.auth })).json().id).toBe(board.id);

    await app.inject({ method: 'POST', url: `/v1/boards/${board.id}/strokes`, headers: a.auth, payload: stroke });
    await app.inject({ method: 'POST', url: `/v1/boards/${board.id}/strokes`, headers: b.auth, payload: stroke });
    expect((await app.inject({ method: 'POST', url: `/v1/boards/${board.id}/strokes`, headers: a.auth, payload: { ...stroke, color: 'red' } })).statusCode).toBe(400);

    await app.inject({ method: 'POST', url: `/v1/boards/${board.id}/undo`, headers: a.auth });
    let cur = (await app.inject({ method: 'GET', url: `/v1/boards/${board.id}`, headers: a.auth })).json();
    expect(cur.strokes).toHaveLength(1);
    expect(cur.strokes[0].userId).toBe(b.id);

    const saved = await app.inject({ method: 'POST', url: `/v1/boards/${board.id}/save`, headers: a.auth, payload: { snapshotUrl: 'https://cdn.example.com/doodle.png' } });
    expect(saved.statusCode).toBe(200);
    const widget = (await app.inject({ method: 'GET', url: '/v1/widgets/summary', headers: b.auth })).json();
    expect(widget.latestDoodle.snapshotUrl).toBe('https://cdn.example.com/doodle.png');
    expect((await app.inject({ method: 'GET', url: '/v1/moi?type=doodle', headers: b.auth })).json()).toHaveLength(1);

    await app.inject({ method: 'POST', url: `/v1/boards/${board.id}/clear`, headers: b.auth });
    cur = (await app.inject({ method: 'GET', url: `/v1/boards/${board.id}`, headers: a.auth })).json();
    expect(cur.strokes).toHaveLength(0);
  });
});
