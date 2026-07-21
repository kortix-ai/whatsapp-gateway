import { prisma } from '../db/prisma.js';
import { id } from '../ids.js';

export async function ensureTenant(userId: string, name = 'My workspace') {
  return prisma.tenant.upsert({
    where: { ownerUserId: userId },
    create: { id: id('ten'), ownerUserId: userId, name },
    update: {},
    select: { id: true, name: true },
  });
}
