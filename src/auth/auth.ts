import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { isAllowedEmail } from './allowlist.js';

export const gatewayPermissions = {
  accounts: ['read', 'write', 'pair', 'disconnect'],
  messages: ['read', 'write', 'send'],
  groups: ['read', 'write'],
  contacts: ['read', 'write'],
  chats: ['read', 'write'],
  presence: ['read', 'write'],
  profile: ['read', 'write'],
  privacy: ['read', 'write'],
  business: ['read', 'write'],
  communities: ['read', 'write'],
  newsletters: ['read', 'write'],
  calls: ['write'],
  webhooks: ['read', 'write', 'replay'],
  agent: ['skill'],
} as const;

export const auth = betterAuth({
  appName: 'WhatsApp Gateway',
  baseURL: config.BETTER_AUTH_URL,
  secret: config.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  trustedOrigins: [config.WEB_ORIGIN, config.PUBLIC_BASE_URL],
  advanced: {
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for'],
      trustedProxies: config.trustedProxyCidrs,
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => isAllowedEmail(user.email),
      },
    },
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } });
          return Boolean(user && isAllowedEmail(user.email));
        },
      },
    },
  },
  plugins: [
    apiKey({
      apiKeyHeaders: ['x-api-key', 'authorization'],
      defaultPrefix: 'wag_',
      defaultKeyLength: 40,
      requireName: true,
      enableMetadata: true,
      enableSessionForAPIKeys: false,
      rateLimit: {
        enabled: true,
        timeWindow: 60_000,
        maxRequests: 600,
      },
      permissions: {
        defaultPermissions: gatewayPermissions,
      },
    }),
  ],
});
