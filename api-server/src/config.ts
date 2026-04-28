import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGO_URI: z.string().min(1),
  MONGO_DB: z.string().min(1).default('polywatch'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  REDIS_CHANNEL: z.string().min(1).default('whales'),
  JWT_SECRET: z.string().min(1),
  JWT_PREVIOUS_SECRET: z.string().optional(),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  CORS_ORIGINS: z.string().default('https://polywatch.app,https://www.polywatch.app'),
  MAX_PUSHES_PER_USER_PER_HOUR: z.coerce.number().int().positive().default(5),
  SENTRY_DSN: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

export type Config = typeof config;