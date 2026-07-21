import { Prisma } from '@prisma/client';
import { fetch, type Agent, type RequestInit } from 'undici';
import { config } from '../config.js';
import { decryptJson, signWebhook } from '../crypto.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { createWebhookAgent, validateWebhookUrl } from './url-security.js';

const DELIVERY_LEASE_MS = 120_000;

export function webhookBackoffMs(attempt: number, random = Math.random): number {
  const exponential = Math.min(3_600_000, 1_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 12));
  return exponential + Math.floor(random() * Math.max(250, exponential * 0.2));
}

export async function claimWebhookDelivery() {
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH candidate AS (
      SELECT id
      FROM "webhook_deliveries"
      WHERE status IN ('pending', 'retrying')
        AND "nextAttemptAt" <= NOW()
      ORDER BY "nextAttemptAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "webhook_deliveries" AS delivery
    SET status = 'processing',
        "attemptCount" = delivery."attemptCount" + 1,
        "updatedAt" = NOW()
    FROM candidate
    WHERE delivery.id = candidate.id
    RETURNING delivery.id
  `);
  if (!claimed[0]) return null;
  return prisma.webhookDelivery.findUnique({
    where: { id: claimed[0].id },
    include: { endpoint: true, event: true },
  });
}

export class WebhookDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private tickRunning = false;
  private agent: Agent | null = null;
  private readonly deliveries = new Set<Promise<void>>();

  start() {
    logger.info({ concurrency: config.WEBHOOK_CONCURRENCY }, 'Starting webhook delivery worker');
    this.agent = createWebhookAgent();
    this.runTick();
    this.timer = setInterval(() => this.runTick(), config.WEBHOOK_POLL_INTERVAL_MS);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled(this.deliveries);
    await this.agent?.close();
    this.agent = null;
  }

  private runTick() {
    void this.tick().catch((error) => logger.error({ error }, 'Webhook dispatcher tick failed'));
  }

  private async tick() {
    if (this.stopped || this.tickRunning) return;
    this.tickRunning = true;
    try {
      await prisma.webhookDelivery.updateMany({
        where: { status: 'processing', updatedAt: { lt: new Date(Date.now() - DELIVERY_LEASE_MS) } },
        data: { status: 'retrying', nextAttemptAt: new Date(), lastError: 'Delivery worker lease expired' },
      });
      while (!this.stopped && this.deliveries.size < config.WEBHOOK_CONCURRENCY) {
        const delivery = await claimWebhookDelivery();
        if (!delivery) break;
        const task = this.deliver(delivery).finally(() => {
          this.deliveries.delete(task);
          if (!this.stopped) queueMicrotask(() => this.runTick());
        });
        this.deliveries.add(task);
      }
    } finally {
      this.tickRunning = false;
    }
  }

  private async deliver(delivery: NonNullable<Awaited<ReturnType<typeof claimWebhookDelivery>>>) {
    const eventBody = {
      id: delivery.event.id,
      tenant_id: delivery.event.tenantId,
      account_id: delivery.event.accountId,
      sequence: Number(delivery.event.sequence),
      type: delivery.event.type,
      occurred_at: delivery.event.occurredAt.toISOString(),
      data: delivery.event.data,
    };
    const body = JSON.stringify(eventBody);
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const url = await validateWebhookUrl(delivery.endpoint.url);
      const secret = decryptJson<string>(delivery.endpoint.secret);
      const request: RequestInit = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Kortix-WhatsApp-Gateway/1.0',
          'x-whatsapp-event-id': delivery.event.id,
          'x-whatsapp-delivery-id': delivery.id,
          'x-whatsapp-timestamp': timestamp,
          'x-whatsapp-signature': `v1=${signWebhook(secret, timestamp, body)}`,
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        ...(this.agent ? { dispatcher: this.agent } : {}),
      };
      const response = await fetch(url, request);
      const responseBody = (await response.text()).slice(0, 4_096);
      if (response.ok) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'delivered', deliveredAt: new Date(), lastStatusCode: response.status,
            lastResponse: responseBody, lastError: null,
          },
        });
        return;
      }
      throw new Error(`Webhook returned HTTP ${response.status}: ${responseBody}`);
    } catch (error) {
      const attempts = delivery.attemptCount;
      const dead = attempts >= config.WEBHOOK_MAX_ATTEMPTS;
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: dead ? 'dead_letter' : 'retrying',
          nextAttemptAt: new Date(Date.now() + webhookBackoffMs(attempts)),
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      logger.warn({ deliveryId: delivery.id, attempts, dead, error }, 'Webhook delivery failed');
    }
  }
}

export function startWebhookDispatcher() {
  const dispatcher = new WebhookDispatcher();
  dispatcher.start();
  return dispatcher;
}
