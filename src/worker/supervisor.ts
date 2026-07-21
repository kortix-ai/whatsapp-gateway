import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { BaileysSession } from '../baileys/session.js';
import { acquireLease, heartbeatLease, releaseLease } from './leases.js';
import { scheduleReconnect } from './reconnect.js';

export class SessionSupervisor {
  private readonly sessions = new Map<string, BaileysSession>();
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private pollRunning = false;
  private heartbeatRunning = false;

  start() {
    logger.info({ workerId: config.workerId, capacity: config.WORKER_CAPACITY }, 'Starting Baileys worker');
    this.runPoll();
    this.pollTimer = setInterval(() => this.runPoll(), 2_000);
    this.heartbeatTimer = setInterval(() => this.runHeartbeat(), config.LEASE_HEARTBEAT_SECONDS * 1000);
  }

  async stop() {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await Promise.all([...this.sessions.values()].map((session) => session.stop()));
    await Promise.all([...this.sessions.keys()].map((accountId) => releaseLease(accountId)));
    this.sessions.clear();
  }

  private runPoll() {
    void this.poll().catch((error) => logger.error({ error }, 'Baileys worker poll failed'));
  }

  private runHeartbeat() {
    void this.heartbeat().catch((error) => logger.error({ error }, 'Baileys lease heartbeat failed'));
  }

  private async poll() {
    if (this.stopped || this.pollRunning || this.sessions.size >= config.WORKER_CAPACITY) return;
    this.pollRunning = true;
    try {
      const now = new Date();
      const accounts = await prisma.whatsAppAccount.findMany({
        where: {
          AND: [
            { OR: [{ nextConnectAt: null }, { nextConnectAt: { lte: now } }] },
            { OR: [
              { pairingMode: { not: null } },
              { authCredentials: { isNot: null } },
              { status: { in: ['connecting', 'pairing', 'reconnecting'] } },
            ] },
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
          const message = error instanceof Error ? error.message : String(error);
          logger.error({ error, accountId: account.id }, 'Failed to start Baileys session');
          this.sessions.delete(account.id);
          await releaseLease(account.id);
          const retry = await scheduleReconnect(account.id, message);
          logger.warn({ accountId: account.id, ...retry }, 'Scheduled WhatsApp reconnect');
        }
      }
    } finally {
      this.pollRunning = false;
    }
  }

  private async heartbeat() {
    if (this.stopped || this.heartbeatRunning) return;
    this.heartbeatRunning = true;
    try {
      await Promise.all([...this.sessions].map(async ([accountId, session]) => {
        if (!await heartbeatLease(accountId)) {
          logger.warn({ accountId }, 'Lease lost; stopping WhatsApp session');
          await session.stop();
        }
      }));
    } finally {
      this.heartbeatRunning = false;
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
