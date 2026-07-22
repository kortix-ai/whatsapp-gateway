import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireAuth, type GatewayVariables } from '../../auth/middleware.js';
import { encryptJson } from '../../crypto.js';
import { prisma } from '../../db/prisma.js';
import { id } from '../../ids.js';
import { gatewayEventTypes } from '../../services/event-types.js';
import { validateWebhookUrl } from '../../webhooks/url-security.js';
import { accountFor, body, dateQuery, limitQuery } from '../helpers.js';

const app = new Hono<{ Variables: GatewayVariables }>();

app.get('/v1/webhook-endpoints', requireAuth({ resource: 'webhooks', action: 'read' }), async (context) => {
  const actor = context.get('actor');
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { tenantId: actor.tenantId, ...(actor.accountIds ? { accountIds: { hasSome: actor.accountIds } } : {}) },
    select: { id: true, url: true, description: true, enabled: true, eventTypes: true, accountIds: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return context.json({ data: endpoints });
});

app.post('/v1/webhook-endpoints', requireAuth({ resource: 'webhooks', action: 'write' }), async (context) => {
  const input = await body(context, z.object({
    url: z.string().url(), description: z.string().max(200).optional(),
    event_types: z.array(z.enum(gatewayEventTypes)).default([]), account_ids: z.array(z.string()).default([]),
  }));
  const actor = context.get('actor');
  const accountIds = actor.accountIds ?? input.account_ids;
  await Promise.all(accountIds.map((accountId) => accountFor(actor, accountId)));
  await validateWebhookUrl(input.url);
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      id: id('whe'), tenantId: actor.tenantId, url: input.url,
      description: input.description ?? null, eventTypes: input.event_types, accountIds, secret: encryptJson(secret),
    },
    select: { id: true, url: true, description: true, enabled: true, eventTypes: true, accountIds: true, createdAt: true },
  });
  return context.json({ ...endpoint, secret }, 201, { 'cache-control': 'no-store' });
});

app.get('/v1/webhook-endpoints/:endpointId', requireAuth({ resource: 'webhooks', action: 'read' }), async (context) => {
  const actor = context.get('actor');
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: context.req.param('endpointId'), tenantId: actor.tenantId, ...(actor.accountIds ? { accountIds: { hasSome: actor.accountIds } } : {}) },
    select: { id: true, url: true, description: true, enabled: true, eventTypes: true, accountIds: true, createdAt: true, updatedAt: true },
  });
  if (!endpoint) throw new HTTPException(404, { message: 'Webhook endpoint not found' });
  return context.json(endpoint);
});

app.patch('/v1/webhook-endpoints/:endpointId', requireAuth({ resource: 'webhooks', action: 'write' }), async (context) => {
  const input = await body(context, z.object({
    url: z.string().url().optional(), description: z.string().max(200).nullable().optional(),
    enabled: z.boolean().optional(), event_types: z.array(z.enum(gatewayEventTypes)).optional(), account_ids: z.array(z.string()).optional(),
  }).refine((value) => Object.keys(value).length > 0, 'At least one field is required'));
  const actor = context.get('actor');
  if (actor.accountIds && input.account_ids && (input.account_ids.length !== actor.accountIds.length || input.account_ids.some((id) => !actor.accountIds!.includes(id)))) {
    throw new HTTPException(403, { message: 'A connection-scoped key cannot change webhook connection scope' });
  }
  if (input.account_ids) await Promise.all(input.account_ids.map((accountId) => accountFor(actor, accountId)));
  if (input.url) await validateWebhookUrl(input.url);
  const updated = await prisma.webhookEndpoint.updateMany({
    where: { id: context.req.param('endpointId'), tenantId: actor.tenantId, ...(actor.accountIds ? { accountIds: { hasSome: actor.accountIds } } : {}) },
    data: {
      ...(input.url ? { url: input.url } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.event_types !== undefined ? { eventTypes: input.event_types } : {}),
      ...(input.account_ids !== undefined ? { accountIds: input.account_ids } : {}),
    },
  });
  if (!updated.count) throw new HTTPException(404, { message: 'Webhook endpoint not found' });
  return context.json(await prisma.webhookEndpoint.findUniqueOrThrow({
    where: { id: context.req.param('endpointId') },
    select: { id: true, url: true, description: true, enabled: true, eventTypes: true, accountIds: true, createdAt: true, updatedAt: true },
  }));
});

app.delete('/v1/webhook-endpoints/:endpointId', requireAuth({ resource: 'webhooks', action: 'write' }), async (context) => {
  const actor = context.get('actor');
  const result = await prisma.webhookEndpoint.deleteMany({
    where: { id: context.req.param('endpointId'), tenantId: actor.tenantId, ...(actor.accountIds ? { accountIds: { hasSome: actor.accountIds } } : {}) },
  });
  if (!result.count) throw new HTTPException(404, { message: 'Webhook endpoint not found' });
  return context.body(null, 204);
});

/**
 * Mint a new signing secret for an existing endpoint, returned once.
 *
 * Without this, "refresh the webhook" means delete-and-recreate, which silently
 * re-pairs the endpoint to a secret the receiver does not have. Every delivery
 * then fails 401 while looking, from the receiver's side, like the gateway has
 * simply gone quiet. Rotating in place keeps the endpoint id, its subscriptions
 * and its delivery history, and makes the one thing that actually changed
 * explicit.
 *
 * Deliveries already queued are signed with the NEW secret when they are next
 * attempted, so update the receiver promptly.
 */
app.post('/v1/webhook-endpoints/:endpointId/rotate-secret', requireAuth({ resource: 'webhooks', action: 'write' }), async (context) => {
  const actor = context.get('actor');
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const result = await prisma.webhookEndpoint.updateMany({
    where: { id: context.req.param('endpointId'), tenantId: actor.tenantId, ...(actor.accountIds ? { accountIds: { hasSome: actor.accountIds } } : {}) },
    data: { secret: encryptJson(secret) },
  });
  if (!result.count) throw new HTTPException(404, { message: 'Webhook endpoint not found' });
  return context.json({ id: context.req.param('endpointId'), secret }, 200, { 'cache-control': 'no-store' });
});

app.get('/v1/webhook-deliveries', requireAuth({ resource: 'webhooks', action: 'read' }), async (context) => {
  const actor = context.get('actor');
  const limit = limitQuery(context.req.query('limit'), 100, 500);
  const before = dateQuery(context.req.query('before'), 'before');
  const endpointId = context.req.query('endpoint_id');
  const deliveryStatus = context.req.query('status');
  const deliveryAccountId = context.req.query('account_id');
  const deliveryType = context.req.query('type');
  if (deliveryAccountId) await accountFor(actor, deliveryAccountId);
  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      endpoint: { tenantId: actor.tenantId, ...(actor.accountIds ? { accountIds: { hasSome: actor.accountIds } } : {}) },
      ...(endpointId ? { endpointId } : {}),
      ...(deliveryStatus ? { status: deliveryStatus } : {}),
      ...(before ? { createdAt: { lt: before } } : {}),
      ...(deliveryAccountId || deliveryType || actor.accountIds ? { event: {
        ...(deliveryAccountId ? { accountId: deliveryAccountId } : actor.accountIds ? { accountId: { in: actor.accountIds } } : {}),
        ...(deliveryType ? { type: deliveryType } : {}),
      } } : {}),
    },
    include: {
      endpoint: { select: { id: true, url: true, description: true } },
      event: { select: { id: true, type: true, accountId: true, occurredAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return context.json({ data: deliveries, next_before: deliveries.at(-1)?.createdAt.toISOString() ?? null });
});

app.get('/v1/webhook-deliveries/:deliveryId', requireAuth({ resource: 'webhooks', action: 'read' }), async (context) => {
  const actor = context.get('actor');
  const delivery = await prisma.webhookDelivery.findFirst({
    where: {
      id: context.req.param('deliveryId'), endpoint: { tenantId: actor.tenantId, ...(actor.accountIds ? { accountIds: { hasSome: actor.accountIds } } : {}) },
      ...(actor.accountIds ? { event: { accountId: { in: actor.accountIds } } } : {}),
    },
    include: {
      endpoint: { select: { id: true, url: true, description: true } },
      event: true,
    },
  });
  if (!delivery) throw new HTTPException(404, { message: 'Webhook delivery not found' });
  return context.json({ ...delivery, event: { ...delivery.event, sequence: Number(delivery.event.sequence) } });
});

app.post('/v1/webhook-deliveries/:deliveryId/replay', requireAuth({ resource: 'webhooks', action: 'replay' }), async (context) => {
  const actor = context.get('actor');
  const delivery = await prisma.webhookDelivery.findFirst({
    where: {
      id: context.req.param('deliveryId'), endpoint: { tenantId: actor.tenantId, ...(actor.accountIds ? { accountIds: { hasSome: actor.accountIds } } : {}) },
      ...(actor.accountIds ? { event: { accountId: { in: actor.accountIds } } } : {}),
    },
  });
  if (!delivery) throw new HTTPException(404, { message: 'Webhook delivery not found' });
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { status: 'pending', attemptCount: 0, nextAttemptAt: new Date(), lastError: null, deliveredAt: null },
  });
  return context.json({ id: delivery.id, status: 'pending' });
});

export { app as webhookRoutes };
