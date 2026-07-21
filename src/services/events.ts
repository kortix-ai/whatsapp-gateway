import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { id } from '../ids.js';

export type GatewayEvent = {
  id: string;
  tenant_id: string;
  account_id: string;
  sequence: number;
  type: string;
  occurred_at: string;
  data: unknown;
};

/**
 * Event types an endpoint may have subscribed to in order to receive `type`.
 * `message.received` / `message.sent` replaced the undirected `message.created`,
 * so endpoints still subscribed to the old name keep matching both.
 */
function subscribedTypes(type: string): string[] {
  return type === 'message.received' || type === 'message.sent'
    ? [type, 'message.created']
    : [type];
}

export async function emitEvent(accountId: string, type: string, data: unknown): Promise<GatewayEvent> {
  return prisma.$transaction(async (tx) => {
    const account = await tx.whatsAppAccount.findUnique({ where: { id: accountId }, select: { tenantId: true } });
    if (!account) throw new Error(`WhatsApp account ${accountId} does not exist`);
    const counter = await tx.accountEventSequence.upsert({
      where: { accountId },
      create: { accountId, sequence: 1n },
      update: { sequence: { increment: 1 } },
    });
    const eventId = id('evt');
    const occurredAt = new Date();
    await tx.inboundEvent.create({
      data: {
        id: eventId,
        tenantId: account.tenantId,
        accountId,
        sequence: counter.sequence,
        type,
        data: data as Prisma.InputJsonValue,
        occurredAt,
      },
    });
    const endpoints = await tx.webhookEndpoint.findMany({
      where: {
        tenantId: account.tenantId,
        enabled: true,
        AND: [
          { OR: [{ eventTypes: { isEmpty: true } }, { eventTypes: { hasSome: subscribedTypes(type) } }] },
          { OR: [{ accountIds: { isEmpty: true } }, { accountIds: { has: accountId } }] },
        ],
      },
      select: { id: true },
    });
    if (endpoints.length) {
      await tx.webhookDelivery.createMany({
        data: endpoints.map((endpoint) => ({ id: id('whd'), endpointId: endpoint.id, eventId })),
        skipDuplicates: true,
      });
    }
    return {
      id: eventId,
      tenant_id: account.tenantId,
      account_id: accountId,
      sequence: Number(counter.sequence),
      type,
      occurred_at: occurredAt.toISOString(),
      data,
    };
  });
}
