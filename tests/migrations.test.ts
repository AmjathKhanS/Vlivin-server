import { describe, expect, it } from 'vitest';
import { createPglite } from '../src/store/pglite.js';
import { migrate, PostgresStore } from '../src/store/postgres.js';

describe('postgres migrations', () => {
  it('applies once, is idempotent, and survives a "restart" with data intact', async () => {
    const db = await createPglite();
    expect((await migrate(db)).length).toBeGreaterThan(0);
    expect(await migrate(db)).toEqual([]);

    const first = new PostgresStore(db);
    await first.createUser({
      id: '11111111-1111-4111-8111-111111111111', name: 'Amjath', phone: '+919800000000', appleSub: null,
      googleSub: null, city: null, tz: 'Asia/Kolkata', avatarUrl: null, pushToken: null, createdAt: new Date(),
    });
    const second = new PostgresStore(db); // new store instance, same database
    expect((await second.findUserByPhone('+919800000000'))?.name).toBe('Amjath');
  });

  it('prevents a user from being in two couples', async () => {
    const db = await createPglite();
    await migrate(db);
    const s = new PostgresStore(db);
    const mk = (n: number) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`, name: `U${n}`, phone: `+9198000000${n}0`, appleSub: null,
      googleSub: null, city: null, tz: 'UTC', avatarUrl: null, pushToken: null, createdAt: new Date(),
    });
    for (const n of [1, 2, 3]) await s.createUser(mk(n));
    const couple = (id: string, a: number, b: number) => ({
      id, userA: mk(a).id, userB: mk(b).id, togetherSince: null, meetDate: null, createdAt: new Date(),
    });
    await s.createCouple(couple('aaaaaaaa-0000-4000-8000-000000000001', 1, 2));
    await expect(s.createCouple(couple('aaaaaaaa-0000-4000-8000-000000000002', 3, 2))).rejects.toMatchObject({ code: 'already_paired' });
    expect(await s.getCoupleByUser(mk(3).id)).toBeNull();
  });
});
