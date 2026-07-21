import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  RUNTIME_ROLE: z.enum(['api', 'worker', 'webhooks', 'all']).default('all'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1).default('postgresql://postgres:postgres@localhost:54329/whatsapp_gateway'),
  BETTER_AUTH_SECRET: z.string().min(32).default('development-only-secret-change-me-123456'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:8080'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  TRUSTED_PROXY_CIDRS: z.string().default(''),
  AUTH_ALLOWLIST_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  ALLOWED_EMAILS: z.string().default('marko@kortix.ai'),
  ENCRYPTION_KEY: z.string().default('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
  WORKER_ID: z.string().optional(),
  WORKER_CAPACITY: z.coerce.number().int().positive().default(25),
  LEASE_TTL_SECONDS: z.coerce.number().int().min(10).default(30),
  LEASE_HEARTBEAT_SECONDS: z.coerce.number().int().min(3).default(10),
  RECONNECT_STABLE_SECONDS: z.coerce.number().int().min(10).default(300),
  PAIRING_TTL_SECONDS: z.coerce.number().int().min(60).default(300),
  WEBHOOK_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  WEBHOOK_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(12),
  ALLOW_PRIVATE_WEBHOOKS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  ALLOW_INSECURE_DEVELOPMENT_DEFAULTS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  LOG_LEVEL: z.string().default('info'),
  GATEWAY_RELEASE: z.string().default('development'),
});

const parsed = schema.parse(process.env);
const encryptionKey = Buffer.from(parsed.ENCRYPTION_KEY, 'base64');
if (encryptionKey.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be exactly 32 bytes encoded as base64');
}
if (parsed.NODE_ENV === 'production' && !parsed.ALLOW_INSECURE_DEVELOPMENT_DEFAULTS) {
  if (parsed.BETTER_AUTH_SECRET.startsWith('development-only')) throw new Error('Set a production BETTER_AUTH_SECRET');
  if (parsed.ENCRYPTION_KEY === 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=') throw new Error('Set a production ENCRYPTION_KEY');
}

export const config = {
  ...parsed,
  encryptionKey,
  allowedEmails: parsed.ALLOWED_EMAILS.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
  trustedProxyCidrs: parsed.TRUSTED_PROXY_CIDRS.split(',').map((cidr) => cidr.trim()).filter(Boolean),
  workerId: parsed.WORKER_ID || `worker_${randomUUID()}`,
};

export type RuntimeRole = typeof config.RUNTIME_ROLE;
