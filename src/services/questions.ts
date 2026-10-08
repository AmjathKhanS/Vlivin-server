import { notFound, unprocessable } from '../lib/errors.js';
import { dateKey, stableIndex } from '../lib/util.js';
import { requireCouple, notifyPartner, type Ctx } from './context.js';

export const PACKS = [
  { id: 'silly', name: 'Silly & fun' },
  { id: 'long-distance', name: 'Long distance' },
  { id: 'know-me', name: 'How well do you know me?' },
] as const;
export type PackId = (typeof PACKS)[number]['id'];

interface Question { id: string; pack: PackId; text: string }

const bank: Record<PackId, string[]> = {
  silly: [
    'If we swapped lives for a day, what would you do first?',
    'What would our couple superhero names be?',
    'Which cartoon character is most like me?',
    'What is the silliest thing you have googled lately?',
    'If we opened a restaurant together, what would be the worst dish on the menu?',
  ],
  'long-distance': [
    'What is the first thing we should do when we finally meet?',
    'What small daily ritual helps you feel close to me?',
    'What do you miss most about being in the same room?',
    'Describe our perfect first day back together.',
    'What is one thing we should plan for the next visit?',
  ],
  'know-me': [
    'What is my go-to comfort food?',
    'What song do I play when I am in a good mood?',
    'What is my biggest fear?',
    'What is the first thing I do in the morning?',
    'What was my favourite childhood memory?',
  ],
};

export const QUESTIONS: Question[] = (Object.keys(bank) as PackId[]).flatMap((pack) =>
  bank[pack].map((text, i) => ({ id: `${pack}-${i + 1}`, pack, text })));

const byId = new Map(QUESTIONS.map((q) => [q.id, q]));

export function listPacks() {
  return PACKS.map((p) => ({ ...p, count: bank[p.id].length }));
}

export async function todaysQuestion(ctx: Ctx, userId: string, pack?: PackId) {
  const { couple, partnerId } = await requireCouple(ctx, userId);
  const pool = pack ? QUESTIONS.filter((q) => q.pack === pack) : QUESTIONS;
  const q = pool[stableIndex(`${couple.id}:${dateKey(ctx.clock())}:${pack ?? 'all'}`, pool.length)]!;
  return questionView(ctx, q, couple.id, userId, partnerId);
}

async function questionView(ctx: Ctx, q: Question, coupleId: string, userId: string, partnerId: string) {
  const [mine, theirs] = await Promise.all([
    ctx.store.getAnswer(q.id, coupleId, userId), ctx.store.getAnswer(q.id, coupleId, partnerId),
  ]);
  return {
    id: q.id, pack: q.pack, text: q.text,
    myAnswer: mine ? { text: mine.text, createdAt: mine.createdAt.toISOString() } : null,
    partnerAnswered: !!theirs,
    // The partner's answer is only revealed once you've answered yourself.
    partnerAnswer: mine && theirs
      ? { text: theirs.text, createdAt: theirs.createdAt.toISOString() } : null,
  };
}

export async function answerQuestion(ctx: Ctx, userId: string, questionId: string, text: string) {
  const q = byId.get(questionId);
  if (!q) throw notFound('question_not_found', 'Unknown question');
  const { couple, partnerId } = await requireCouple(ctx, userId);
  const trimmed = text.trim();
  if (!trimmed) throw unprocessable('empty_answer', 'Answer cannot be empty');
  await ctx.store.saveAnswer({
    questionId, coupleId: couple.id, userId, text: trimmed, createdAt: ctx.clock(),
  });
  const [me, partner] = await Promise.all([ctx.store.getUser(userId), ctx.store.getUser(partnerId)]);
  ctx.hub.broadcast(couple.id, 'question.answered', { questionId, userId }, userId);
  await notifyPartner(ctx, partner, {
    title: 'Daily question', body: `${me?.name ?? 'Your person'} answered. Answer to unlock theirs.`,
    data: { type: 'question', questionId },
  });
  return questionView(ctx, q, couple.id, userId, partnerId);
}
