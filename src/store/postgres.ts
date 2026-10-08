import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Answer, Board, Couple, GameSession, LocationRecord, MoiItem, MoodEntry, PairCode, User,
} from '../domain/types.js';
import { conflict, notFound } from '../lib/errors.js';
import type { Store } from './store.js';

/** Minimal driver surface so the same store runs on `pg` (prod) and PGlite (tests). */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Pick<Db, 'query'>) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

type Row = Record<string, any>;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');

/** Applies any `db/migrations/*.sql` files not yet recorded, in filename order. */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.transaction(async (tx) => {
      await tx.query(sql);
      await tx.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}

/** Connect with node-postgres. Imported lazily so tests don't need a server. */
export async function connectPg(connectionString: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString, max: 10,
    ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
  });
  return {
    async query(sql, params) { return (await pool.query(sql, params as any[])).rows; },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({ query: async (sql, params) => (await client.query(sql, params as any[])).rows as any });
        await client.query('commit');
        return out;
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

const iso = (d: Date | null) => d;
const date = (v: string | null) => v;

const toUser = (r: Row): User => ({
  id: r.id, name: r.name, phone: r.phone, appleSub: r.apple_sub, googleSub: r.google_sub,
  city: r.city, tz: r.tz, avatarUrl: r.avatar_url, pushToken: r.push_token, createdAt: r.created_at,
});
const toCouple = (r: Row): Couple => ({
  id: r.id, userA: r.user_a, userB: r.user_b, togetherSince: r.together_since, meetDate: r.meet_date,
  createdAt: r.created_at,
});
const COUPLE_COLS = `id, user_a, user_b, to_char(together_since,'YYYY-MM-DD') as together_since,
  to_char(meet_date,'YYYY-MM-DD') as meet_date, created_at`;
const toMood = (r: Row): MoodEntry => ({
  id: r.id, coupleId: r.couple_id, userId: r.user_id, mood: r.mood, note: r.note, createdAt: r.created_at,
});
const toLocation = (r: Row): LocationRecord => ({
  userId: r.user_id, lat: r.lat, lng: r.lng, updatedAt: r.updated_at, sharingMode: r.sharing_mode,
  pausedUntil: r.paused_until,
});
const toGame = (r: Row): GameSession => ({
  id: r.id, coupleId: r.couple_id, game: r.game, board: r.state.board, players: r.state.players,
  turn: r.turn, status: r.state.status, winner: r.state.winner, line: r.state.line,
  score: r.score, chat: r.state.chat, updatedAt: r.updated_at,
});
const toBoard = (r: Row): Board => ({
  id: r.id, coupleId: r.couple_id, strokes: r.strokes, snapshotUrl: r.snapshot_url,
  savedAt: r.saved_at, createdAt: r.created_at,
});
const toMoi = (r: Row): MoiItem => ({
  id: r.id, coupleId: r.couple_id, authorId: r.author_id, type: r.type, payload: r.payload,
  unlockAt: r.unlock_at, createdAt: r.created_at,
});

const USER_COLUMNS: Record<string, string> = {
  name: 'name', phone: 'phone', appleSub: 'apple_sub', googleSub: 'google_sub', city: 'city',
  tz: 'tz', avatarUrl: 'avatar_url', pushToken: 'push_token',
};

export class PostgresStore implements Store {
  constructor(private db: Db) {}

  private one = async <T>(sql: string, params: unknown[], map: (r: Row) => T): Promise<T | null> => {
    const rows = await this.db.query<Row>(sql, params);
    return rows[0] ? map(rows[0]) : null;
  };

  // ---- users
  async createUser(u: User) {
    await this.db.query(
      `insert into users (id,name,phone,apple_sub,google_sub,city,tz,avatar_url,push_token,created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [u.id, u.name, u.phone, u.appleSub, u.googleSub, u.city, u.tz, u.avatarUrl, u.pushToken, u.createdAt],
    );
    return u;
  }
  getUser(id: string) { return this.one('select * from users where id=$1', [id], toUser); }
  findUserByPhone(phone: string) { return this.one('select * from users where phone=$1', [phone], toUser); }
  findUserBySocial(provider: 'apple' | 'google', sub: string) {
    const col = provider === 'apple' ? 'apple_sub' : 'google_sub';
    return this.one(`select * from users where ${col}=$1`, [sub], toUser);
  }
  async updateUser(id: string, patch: Partial<Omit<User, 'id' | 'createdAt'>>) {
    const entries = Object.entries(patch).filter(([k, v]) => k in USER_COLUMNS && v !== undefined);
    if (entries.length) {
      const sets = entries.map(([k], i) => `${USER_COLUMNS[k]}=$${i + 2}`).join(', ');
      await this.db.query(`update users set ${sets} where id=$1`, [id, ...entries.map(([, v]) => v)]);
    }
    const u = await this.getUser(id);
    if (!u) throw notFound('user_not_found', 'User not found');
    return u;
  }

  // ---- pairing
  async replacePairCode(c: PairCode) {
    await this.db.transaction(async (tx) => {
      await tx.query('delete from pair_codes where user_id=$1', [c.userId]);
      await tx.query('insert into pair_codes (code,user_id,expires_at) values ($1,$2,$3)', [c.code, c.userId, c.expiresAt]);
    });
  }
  private toCode = (r: Row): PairCode => ({ code: r.code, userId: r.user_id, expiresAt: r.expires_at });
  getPairCode(code: string) { return this.one('select * from pair_codes where code=$1', [code], this.toCode); }
  getPairCodeForUser(userId: string) { return this.one('select * from pair_codes where user_id=$1', [userId], this.toCode); }
  async deletePairCodesForUser(userId: string) { await this.db.query('delete from pair_codes where user_id=$1', [userId]); }

  // ---- couples
  async createCouple(c: Couple) {
    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          'insert into couples (id,user_a,user_b,together_since,meet_date,created_at) values ($1,$2,$3,$4,$5,$6)',
          [c.id, c.userA, c.userB, date(c.togetherSince), date(c.meetDate), c.createdAt],
        );
        await tx.query('insert into couple_members (user_id,couple_id) values ($1,$3),($2,$3)', [c.userA, c.userB, c.id]);
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('already_paired', 'One of you is already paired');
      throw err;
    }
    return c;
  }
  getCouple(id: string) { return this.one(`select ${COUPLE_COLS} from couples where id=$1`, [id], toCouple); }
  getCoupleByUser(userId: string) {
    return this.one(`select ${COUPLE_COLS} from couples where user_a=$1 or user_b=$1`, [userId], toCouple);
  }
  async updateCouple(id: string, patch: Partial<Pick<Couple, 'togetherSince' | 'meetDate'>>) {
    const sets: string[] = []; const params: unknown[] = [id];
    if (patch.togetherSince !== undefined) { params.push(patch.togetherSince); sets.push(`together_since=$${params.length}`); }
    if (patch.meetDate !== undefined) { params.push(patch.meetDate); sets.push(`meet_date=$${params.length}`); }
    if (sets.length) await this.db.query(`update couples set ${sets.join(', ')} where id=$1`, params);
    const c = await this.getCouple(id);
    if (!c) throw notFound('couple_not_found', 'Couple not found');
    return c;
  }
  async deleteCouple(id: string) { await this.db.query('delete from couples where id=$1', [id]); }

  // ---- moods
  async addMood(m: MoodEntry) {
    await this.db.query(
      'insert into moods (id,couple_id,user_id,mood,note,created_at) values ($1,$2,$3,$4,$5,$6)',
      [m.id, m.coupleId, m.userId, m.mood, m.note, m.createdAt],
    );
    return m;
  }
  async listMoods(coupleId: string, since: Date) {
    const rows = await this.db.query<Row>(
      'select * from moods where couple_id=$1 and created_at>=$2 order by created_at, seq', [coupleId, since]);
    return rows.map(toMood);
  }
  latestMood(userId: string) {
    return this.one('select * from moods where user_id=$1 order by created_at desc, seq desc limit 1', [userId], toMood);
  }

  // ---- locations
  async upsertLocation(l: LocationRecord) {
    await this.db.query(
      `insert into locations (user_id,lat,lng,updated_at,sharing_mode,paused_until) values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id) do update set lat=$2, lng=$3, updated_at=$4, sharing_mode=$5, paused_until=$6`,
      [l.userId, l.lat, l.lng, iso(l.updatedAt), l.sharingMode, iso(l.pausedUntil)],
    );
    return l;
  }
  getLocation(userId: string) { return this.one('select * from locations where user_id=$1', [userId], toLocation); }

  // ---- answers
  async saveAnswer(a: Answer) {
    await this.db.query(
      `insert into answers (question_id,couple_id,user_id,text,created_at) values ($1,$2,$3,$4,$5)
       on conflict (question_id,couple_id,user_id) do update set text=$4, created_at=$5`,
      [a.questionId, a.coupleId, a.userId, a.text, a.createdAt],
    );
    return a;
  }
  getAnswer(questionId: string, coupleId: string, userId: string) {
    return this.one('select * from answers where question_id=$1 and couple_id=$2 and user_id=$3',
      [questionId, coupleId, userId],
      (r) => ({ questionId: r.question_id, coupleId: r.couple_id, userId: r.user_id, text: r.text, createdAt: r.created_at }));
  }

  // ---- games
  async saveGame(g: GameSession) {
    const state = { board: g.board, players: g.players, status: g.status, winner: g.winner, line: g.line, chat: g.chat };
    await this.db.query(
      `insert into game_sessions (id,couple_id,game,state,turn,score,updated_at) values ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7)
       on conflict (id) do update set state=$4::jsonb, turn=$5, score=$6::jsonb, updated_at=$7`,
      [g.id, g.coupleId, g.game, JSON.stringify(state), g.turn, JSON.stringify(g.score), g.updatedAt],
    );
    return g;
  }
  getGame(id: string) { return this.one('select * from game_sessions where id=$1', [id], toGame); }
  getLatestGame(coupleId: string, game: GameSession['game']) {
    return this.one('select * from game_sessions where couple_id=$1 and game=$2 order by updated_at desc, seq desc limit 1',
      [coupleId, game], toGame);
  }

  // ---- boards
  async saveBoard(b: Board) {
    await this.db.query(
      `insert into boards (id,couple_id,strokes,snapshot_url,saved_at,created_at) values ($1,$2,$3::jsonb,$4,$5,$6)
       on conflict (id) do update set strokes=$3::jsonb, snapshot_url=$4, saved_at=$5`,
      [b.id, b.coupleId, JSON.stringify(b.strokes), b.snapshotUrl, iso(b.savedAt), b.createdAt],
    );
    return b;
  }
  getBoard(id: string) { return this.one('select * from boards where id=$1', [id], toBoard); }
  getLatestBoard(coupleId: string) {
    return this.one('select * from boards where couple_id=$1 order by created_at desc, seq desc limit 1', [coupleId], toBoard);
  }

  // ---- moi
  async saveMoi(m: MoiItem) {
    await this.db.query(
      `insert into moi_items (id,couple_id,author_id,type,payload,unlock_at,created_at) values ($1,$2,$3,$4,$5::jsonb,$6,$7)
       on conflict (id) do update set payload=$5::jsonb, unlock_at=$6`,
      [m.id, m.coupleId, m.authorId, m.type, JSON.stringify(m.payload), iso(m.unlockAt), m.createdAt],
    );
    return m;
  }
  getMoi(id: string) { return this.one('select * from moi_items where id=$1', [id], toMoi); }
  async listMoi(coupleId: string) {
    const rows = await this.db.query<Row>('select * from moi_items where couple_id=$1 order by created_at desc, seq desc', [coupleId]);
    return rows.map(toMoi);
  }
  async deleteMoi(id: string) { await this.db.query('delete from moi_items where id=$1', [id]); }
}
