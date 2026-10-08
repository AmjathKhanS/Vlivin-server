import { z } from 'zod';
import { MOODS, SHARING_MODES } from '../domain/types.js';
import { AppError } from '../lib/errors.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new AppError(400, 'validation_error', `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`);
  }
  return r.data;
}

// E.164 phone number
export const phone = z.string().regex(/^\+[1-9]\d{7,14}$/, 'must be in E.164 format, e.g. +919876543210');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date');
const httpsUrl = z.string().url().max(2048).refine((u) => u.startsWith('https://'), 'must be https');

export const schemas = {
  otpRequest: z.object({ phone }),
  otpVerify: z.object({ phone, code: z.string().regex(/^\d{6}$/) }),
  social: z.object({ provider: z.enum(['apple', 'google']), idToken: z.string().min(10) }),
  profile: z.object({
    name: z.string().trim().min(1).max(60).optional(),
    city: z.string().trim().max(80).nullable().optional(),
    tz: z.string().min(1).max(64).optional(),
    avatarUrl: httpsUrl.nullable().optional(),
  }).strict(),
  pushToken: z.object({ token: z.string().min(10).max(255).nullable() }),
  join: z.object({ code: z.string().trim().min(4).max(12) }),
  couple: z.object({
    togetherSince: isoDate.nullable().optional(),
    meetDate: isoDate.nullable().optional(),
  }).strict(),
  mood: z.object({ mood: z.enum(MOODS), note: z.string().trim().max(280).nullish() }),
  sharing: z.object({
    mode: z.enum(SHARING_MODES),
    pauseMinutes: z.number().int().min(1).max(24 * 60).optional(),
  }),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  answer: z.object({ text: z.string().trim().min(1).max(1000) }),
  pack: z.object({ pack: z.enum(['silly', 'long-distance', 'know-me']).optional() }),
  move: z.object({ cell: z.number().int().min(0).max(8) }),
  chat: z.object({ text: z.string().trim().min(1).max(500) }),
  stroke: z.object({
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    size: z.number().min(1).max(64),
    points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(1).max(5000),
  }),
  save: z.object({ snapshotUrl: httpsUrl }),
  letter: z.object({
    title: z.string().trim().max(80).optional(),
    body: z.string().trim().min(1).max(10_000),
    unlockAt: z.coerce.date().optional(),
  }),
  photo: z.object({ url: httpsUrl, caption: z.string().trim().max(200).optional() }),
  moiQuery: z.object({ type: z.enum(['letter', 'doodle', 'photo']).optional() }),
};
