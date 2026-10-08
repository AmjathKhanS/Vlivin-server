import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  JWT_SECRET: z.string().default('dev-only-secret-change-me-dev-only-secret'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  CORS_ORIGINS: z.string().default('*'),
  PAIR_CODE_TTL_HOURS: z.coerce.number().positive().default(24),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (config.NODE_ENV === 'production' && config.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters in production');
  }
  if (config.NODE_ENV === 'production' && config.JWT_SECRET.startsWith('dev-only')) {
    throw new Error('JWT_SECRET must not use the development default in production');
  }
  return config;
}
