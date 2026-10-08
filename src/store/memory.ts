import type {
  Answer, Board, Couple, GameSession, LocationRecord, MoiItem, MoodEntry, PairCode, User,
} from '../domain/types.js';
import { notFound } from '../lib/errors.js';
import type { Store } from './store.js';

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryStore implements Store {
  private users = new Map<string, User>();
  private pairCodes = new Map<string, PairCode>();
  private couples = new Map<string, Couple>();
  private moods: MoodEntry[] = [];
  private locations = new Map<string, LocationRecord>();
  private answers = new Map<string, Answer>();
  private games = new Map<string, GameSession>();
  private boards = new Map<string, Board>();
  private moi = new Map<string, MoiItem>();

  async createUser(u: User) { this.users.set(u.id, clone(u)); return clone(u); }
  async getUser(id: string) { const u = this.users.get(id); return u ? clone(u) : null; }
  async findUserByPhone(phone: string) {
    for (const u of this.users.values()) if (u.phone === phone) return clone(u);
    return null;
  }
  async findUserBySocial(provider: 'apple' | 'google', sub: string) {
    for (const u of this.users.values()) {
      if ((provider === 'apple' ? u.appleSub : u.googleSub) === sub) return clone(u);
    }
    return null;
  }
  async updateUser(id: string, patch: Partial<Omit<User, 'id' | 'createdAt'>>) {
    const u = this.users.get(id);
    if (!u) throw notFound('user_not_found', 'User not found');
    Object.assign(u, patch);
    return clone(u);
  }

  async replacePairCode(code: PairCode) {
    await this.deletePairCodesForUser(code.userId);
    this.pairCodes.set(code.code, clone(code));
  }
  async getPairCode(code: string) { const c = this.pairCodes.get(code); return c ? clone(c) : null; }
  async getPairCodeForUser(userId: string) {
    for (const c of this.pairCodes.values()) if (c.userId === userId) return clone(c);
    return null;
  }
  async deletePairCodesForUser(userId: string) {
    for (const [k, c] of this.pairCodes) if (c.userId === userId) this.pairCodes.delete(k);
  }

  async createCouple(c: Couple) { this.couples.set(c.id, clone(c)); return clone(c); }
  async getCouple(id: string) { const c = this.couples.get(id); return c ? clone(c) : null; }
  async getCoupleByUser(userId: string) {
    for (const c of this.couples.values()) if (c.userA === userId || c.userB === userId) return clone(c);
    return null;
  }
  async updateCouple(id: string, patch: Partial<Pick<Couple, 'togetherSince' | 'meetDate'>>) {
    const c = this.couples.get(id);
    if (!c) throw notFound('couple_not_found', 'Couple not found');
    Object.assign(c, patch);
    return clone(c);
  }
  async deleteCouple(id: string) {
    this.couples.delete(id);
    this.moods = this.moods.filter((m) => m.coupleId !== id);
    for (const [k, a] of this.answers) if (a.coupleId === id) this.answers.delete(k);
    for (const [k, g] of this.games) if (g.coupleId === id) this.games.delete(k);
    for (const [k, b] of this.boards) if (b.coupleId === id) this.boards.delete(k);
    for (const [k, m] of this.moi) if (m.coupleId === id) this.moi.delete(k);
  }

  async addMood(m: MoodEntry) { this.moods.push(clone(m)); return clone(m); }
  async listMoods(coupleId: string, since: Date) {
    return this.moods
      .filter((m) => m.coupleId === coupleId && m.createdAt >= since)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }
  async latestMood(userId: string) {
    const mine = this.moods.filter((m) => m.userId === userId);
    const last = mine[mine.length - 1];
    return last ? clone(last) : null;
  }

  async upsertLocation(l: LocationRecord) { this.locations.set(l.userId, clone(l)); return clone(l); }
  async getLocation(userId: string) { const l = this.locations.get(userId); return l ? clone(l) : null; }

  private answerKey = (q: string, c: string, u: string) => `${q}|${c}|${u}`;
  async saveAnswer(a: Answer) {
    this.answers.set(this.answerKey(a.questionId, a.coupleId, a.userId), clone(a));
    return clone(a);
  }
  async getAnswer(questionId: string, coupleId: string, userId: string) {
    const a = this.answers.get(this.answerKey(questionId, coupleId, userId));
    return a ? clone(a) : null;
  }

  async saveGame(g: GameSession) { this.games.set(g.id, clone(g)); return clone(g); }
  async getGame(id: string) { const g = this.games.get(id); return g ? clone(g) : null; }
  async getLatestGame(coupleId: string, game: GameSession['game']) {
    let best: GameSession | null = null;
    for (const g of this.games.values()) {
      if (g.coupleId === coupleId && g.game === game && (!best || g.updatedAt > best.updatedAt)) best = g;
    }
    return best ? clone(best) : null;
  }

  async saveBoard(b: Board) { this.boards.set(b.id, clone(b)); return clone(b); }
  async getBoard(id: string) { const b = this.boards.get(id); return b ? clone(b) : null; }
  async getLatestBoard(coupleId: string) {
    let best: Board | null = null;
    for (const b of this.boards.values()) {
      if (b.coupleId === coupleId && (!best || b.createdAt > best.createdAt)) best = b;
    }
    return best ? clone(best) : null;
  }

  async saveMoi(m: MoiItem) { this.moi.set(m.id, clone(m)); return clone(m); }
  async getMoi(id: string) { const m = this.moi.get(id); return m ? clone(m) : null; }
  async listMoi(coupleId: string) {
    return [...this.moi.values()]
      .filter((m) => m.coupleId === coupleId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(clone);
  }
  async deleteMoi(id: string) { this.moi.delete(id); }
}
