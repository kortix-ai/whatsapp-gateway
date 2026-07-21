import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { BaileysSession } from '../baileys/session.js';
import { acquireLease, heartbeatLease, releaseLease } from './leases.js';

export class SessionSupervisor {
  private readonly sessions = new Map<string, BaileysSession>();
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  start() {
    logger.info({ workerId: config.workerId, capacity: config.WORKER_CAPACITY }, 'Starting Baileys worker');
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), 2_000);
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), config.LEASE_HEARTBEAT_SECONDS * 1000);
  }

  async stop() {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await Promise.all([...this.sessions.values()].map((session) => session.stop()));
    await Promise.all([...this.sessions.keys()].map((accountId) => releaseLease(accountId)));
    this.sessions.clear();
  }

  private async poll() {
    if (this.stopped || this.sessions.size >= config.WORKER_CAPACITY) return;
    const accounts = await prisma.whatsAppAccount.findMany({
      where: {
        OR: [
          { pairingMode: { not: null } },
          { authCredentials: { isNot: null } },
          { status: { in: ['connecting', 'pairing', 'reconnecting'] } },
        ],
      },
      select: { id: true },
      take: Math.max(config.WORKER_CAPACITY - this.sessions.size, 1) * 3,
      orderBy: { updatedAt: 'asc' },
    });
    for (const account of accounts) {
      if (this.sessions.size >= config.WORKER_CAPACITY) break;
      if (this.sessions.has(account.id) || !await acquireLease(account.id)) continue;
      const session = new BaileysSession(account.id, (accountId) => void this.closed(accountId));
      this.sessions.set(account.id, session);
      try {
        await session.start();
      } catch (error) {
        logger.error({ error, accountId: account.id }, 'Failed to start Baileys session');
        this.sessions.delete(account.id);
        await releaseLease(account.id);
        await prisma.whatsAppAccount.update({
          where: { id: account.id },
          data: { status: 'error', lastError: error instanceof Error ? error.message : String(error) },
        });
      }
    }
  }

  private async heartbeat() {
    for (const [accountId, session] of this.sessions) {
      if (!await heartbeatLease(accountId)) {
        logger.warn({ accountId }, 'Lease lost; stopping WhatsApp session');
        await session.stop();
      }
    }
  }

  private async closed(accountId: string) {
    this.sessions.delete(accountId);
    await releaseLease(accountId);
  }
}

export function startWorker() {
  const supervisor = new SessionSupervisor();
  supervisor.start();
  return supervisor;
}
