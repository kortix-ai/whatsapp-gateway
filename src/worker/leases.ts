import { config } from '../config.js';
import { prisma } from '../db/prisma.js';

export async function acquireLease(accountId: string): Promise<boolean> {
  const now = new Date();
  const leasedUntil = new Date(now.getTime() + config.LEASE_TTL_SECONDS * 1000);
  const updated = await prisma.whatsAppAccountLease.updateMany({
    where: { accountId, OR: [{ leasedUntil: { lt: now } }, { workerId: config.workerId }] },
    data: { workerId: config.workerId, leasedUntil, heartbeatAt: now, generation: { increment: 1 } },
  });
  if (updated.count === 1) return true;
  const created = await prisma.whatsAppAccountLease.createMany({
    data: [{ accountId, workerId: config.workerId, leasedUntil, heartbeatAt: now }],
    skipDuplicates: true,
  });
  return created.count === 1;
}

export async function heartbeatLease(accountId: string): Promise<boolean> {
  const now = new Date();
  const result = await prisma.whatsAppAccountLease.updateMany({
    where: { accountId, workerId: config.workerId, leasedUntil: { gte: now } },
    data: { leasedUntil: new Date(now.getTime() + config.LEASE_TTL_SECONDS * 1000), heartbeatAt: now },
  });
  return result.count === 1;
}

export async function releaseLease(accountId: string): Promise<void> {
  await prisma.whatsAppAccountLease.deleteMany({ where: { accountId, workerId: config.workerId } });
}
