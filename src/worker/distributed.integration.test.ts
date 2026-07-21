import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { id } from '../ids.js';
import { claimWebhookDelivery } from '../webhooks/dispatcher.js';
import { acquireLease } from './leases.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === '1';
const suite = describe.skipIf(!runDatabaseTests);
const suffix = randomUUID();
const userId = `test_user_${suffix}`;
const tenantId = `test_tenant_${suffix}`;
const accountId = id('wa');

suite('distributed claims', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, name: 'Scale Test', email: `${suffix}@example.test`, emailVerified: true } });
    await prisma.tenant.create({ data: { id: tenantId, ownerUserId: userId, name: 'Scale Test' } });
    await prisma.whatsAppAccount.create({ data: { id: accountId, tenantId, displayName: 'Scale Test' } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('gives an account lease to exactly one racing worker', async () => {
    const results = await Promise.all([
      acquireLease(accountId, 'worker-a'),
      acquireLease(accountId, 'worker-b'),
      acquireLease(accountId, 'worker-c'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('claims each webhook delivery once across racing dispatchers', async () => {
    const endpoint = await prisma.webhookEndpoint.create({
      data: { id: id('whe'), tenantId, url: 'https://example.com/hook', secret: 'unused' },
    });
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const event = await prisma.inboundEvent.create({
        data: { id: id('evt'), tenantId, accountId, sequence, type: 'message.created', data: {} },
      });
      await prisma.webhookDelivery.create({ data: { id: id('whd'), endpointId: endpoint.id, eventId: event.id } });
    }
    const raced = await Promise.all([
      claimWebhookDelivery(), claimWebhookDelivery(), claimWebhookDelivery(), claimWebhookDelivery(),
    ]);
    const claims = raced.filter((claim) => claim !== null);
    while (claims.length < 3) {
      const next = await claimWebhookDelivery();
      if (!next) break;
      claims.push(next);
    }
    const ids = claims.map((claim) => claim.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids)).toHaveLength(3);
  });
});
