import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

const globalForPrisma = globalThis as unknown as { gatewayPrisma?: PrismaClient };

export const prisma = globalForPrisma.gatewayPrisma ?? new PrismaClient({
  log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (config.NODE_ENV !== 'production') globalForPrisma.gatewayPrisma = prisma;
