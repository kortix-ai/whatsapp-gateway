import { fetch, type RequestInit } from 'undici';
import { config } from '../config.js';
import { decryptJson, signWebhook } from '../crypto.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { createWebhookAgent, validateWebhookUrl } from './url-security.js';

export class WebhookDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  start() {
    logger.info('Starting webhook delivery worker');
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.WEBHOOK_POLL_INTERVAL_MS);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.stopped) return;
    await prisma.webhookDelivery.updateMany({
      where: { status: 'processing', updatedAt: { lt: new Date(Date.now() - 120_000) } },
      data: { status: 'retrying', nextAttemptAt: new Date(), lastError: 'Delivery worker lease expired' },
    });
    const delivery = await prisma.webhookDelivery.findFirst({
      where: { status: { in: ['pending', 'retrying'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      include: { endpoint: true, event: true },
    });
    if (!delivery) return;
    const claimed = await prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: { in: ['pending', 'retrying'] } },
      data: { status: 'processing', attemptCount: { increment: 1 } },
    });
    if (!claimed.count) return;

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
    const agent = createWebhookAgent();
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
        ...(agent ? { dispatcher: agent } : {}),
      };
      const response = await fetch(url, request);
      const responseBody = (await response.text()).slice(0, 4_096);
      if (response.ok) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'delivered',
            deliveredAt: new Date(),
            lastStatusCode: response.status,
            lastResponse: responseBody,
            lastError: null,
          },
        });
        return;
      }
      throw new Error(`Webhook returned HTTP ${response.status}: ${responseBody}`);
    } catch (error) {
      const attempts = delivery.attemptCount + 1;
      const dead = attempts >= config.WEBHOOK_MAX_ATTEMPTS;
      const backoffMs = Math.min(3_600_000, 1_000 * 2 ** Math.min(attempts - 1, 12));
      const jitter = Math.floor(Math.random() * Math.max(250, backoffMs * 0.2));
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: dead ? 'dead_letter' : 'retrying',
          nextAttemptAt: new Date(Date.now() + backoffMs + jitter),
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      logger.warn({ deliveryId: delivery.id, attempts, dead, error }, 'Webhook delivery failed');
    } finally {
      await agent?.close();
    }
  }
}

export function startWebhookDispatcher() {
  const dispatcher = new WebhookDispatcher();
  dispatcher.start();
  return dispatcher;
}
