import type {
  Answer, Board, Couple, GameSession, LocationRecord, MoiItem, MoodEntry, PairCode, User,
} from '../domain/types.js';

/**
 * Persistence boundary. Services only talk to this interface, so the in-memory
 * implementation (dev/tests) can be replaced by a Postgres/Supabase one.
 */
export interface Store {
  createUser(u: User): Promise<User>;
  getUser(id: string): Promise<User | null>;
  findUserByPhone(phone: string): Promise<User | null>;
  findUserBySocial(provider: 'apple' | 'google', sub: string): Promise<User | null>;
  updateUser(id: string, patch: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User>;

  replacePairCode(code: PairCode): Promise<void>;
  getPairCode(code: string): Promise<PairCode | null>;
  getPairCodeForUser(userId: string): Promise<PairCode | null>;
  deletePairCodesForUser(userId: string): Promise<void>;

  createCouple(c: Couple): Promise<Couple>;
  getCouple(id: string): Promise<Couple | null>;
  getCoupleByUser(userId: string): Promise<Couple | null>;
  updateCouple(id: string, patch: Partial<Pick<Couple, 'togetherSince' | 'meetDate'>>): Promise<Couple>;
  deleteCouple(id: string): Promise<void>;

  addMood(m: MoodEntry): Promise<MoodEntry>;
  listMoods(coupleId: string, since: Date): Promise<MoodEntry[]>;
  latestMood(userId: string): Promise<MoodEntry | null>;

  upsertLocation(l: LocationRecord): Promise<LocationRecord>;
  getLocation(userId: string): Promise<LocationRecord | null>;

  saveAnswer(a: Answer): Promise<Answer>;
  getAnswer(questionId: string, coupleId: string, userId: string): Promise<Answer | null>;

  saveGame(g: GameSession): Promise<GameSession>;
  getGame(id: string): Promise<GameSession | null>;
  getLatestGame(coupleId: string, game: GameSession['game']): Promise<GameSession | null>;

  saveBoard(b: Board): Promise<Board>;
  getBoard(id: string): Promise<Board | null>;
  getLatestBoard(coupleId: string): Promise<Board | null>;

  saveMoi(m: MoiItem): Promise<MoiItem>;
  getMoi(id: string): Promise<MoiItem | null>;
  listMoi(coupleId: string): Promise<MoiItem[]>;
  deleteMoi(id: string): Promise<void>;
}
