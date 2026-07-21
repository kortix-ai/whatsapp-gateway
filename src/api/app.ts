import { randomBytes } from 'node:crypto';
import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { auth } from '../auth/auth.js';
import { requireAuth, type GatewayVariables } from '../auth/middleware.js';
import { config } from '../config.js';
import { encryptJson } from '../crypto.js';
import { prisma } from '../db/prisma.js';
import { id } from '../ids.js';
import { buildAgentSkill } from '../skill.js';
import { enqueueCommand, waitForCommand } from '../services/commands.js';
import { validateWebhookUrl } from '../webhooks/url-security.js';
import { openApiDocument } from './openapi.js';
import { baileysActions, isBaileysAction } from '../baileys/actions.js';

const app = new Hono<{ Variables: GatewayVariables }>();

app.use('*', cors({
  origin: config.WEB_ORIGIN,
  credentials: true,
  allowHeaders: ['content-type', 'authorization', 'x-api-key'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.get('/health', (context) => context.json({ status: 'ok', service: 'whatsapp-gateway' }));
app.get('/openapi.json', (context) => context.json(openApiDocument));
app.get('/docs', Scalar({
  url: '/openapi.json',
  pageTitle: 'WhatsApp Gateway API',
  theme: 'kepler',
  layout: 'modern',
  hideClientButton: false,
  persistAuth: true,
}));
app.get('/v1/skill.md', (context) => context.text(buildAgentSkill(), 200, { 'content-type': 'text/markdown; charset=utf-8' }));
app.on(['GET', 'POST'], '/api/auth/*', (context) => auth.handler(context.req.raw));

async function body<T extends z.ZodType>(context: { req: { json: () => Promise<unknown> } }, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await context.req.json());
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.issues.map((issue) => issue.message).join(', ') });
  return parsed.data;
}

async function accountFor(actor: GatewayVariables['actor'], accountId: string) {
  if (actor.accountIds && !actor.accountIds.includes(accountId)) throw new HTTPException(404, { message: 'Account not found' });
  const account = await prisma.whatsAppAccount.findFirst({ where: { id: accountId, tenantId: actor.tenantId } });
  if (!account) throw new HTTPException(404, { message: 'Account not found' });
  return account;
}

function hasPermission(actor: GatewayVariables['actor'], resource: string, action: string): boolean {
  if (actor.type === 'user' || actor.permissions === null) return true;
  const granted = actor.permissions[resource] ?? [];
  return granted.includes(action) || granted.includes('*');
}

app.get('/v1/baileys-actions', requireAuth({ resource: 'accounts', action: 'read' }), (context) => {
  return context.json({
    data: Object.entries(baileysActions).map(([name, definition]) => ({ name, ...definition })),
  });
});

app.post('/v1/accounts/:accountId/actions/:action', requireAuth(), async (context) => {
  const action = context.req.param('action');
  if (!isBaileysAction(action)) throw new HTTPException(404, { message: 'Baileys action not found' });
  const actor = context.get('actor');
  const definition = baileysActions[action];
  if (!hasPermission(actor, definition.permission.resource, definition.permission.action)) {
    throw new HTTPException(403, { message: `Missing ${definition.permission.resource}:${definition.permission.action} permission` });
  }
  const input = await body(context, z.object({ args: z.array(z.unknown()).default([]) }));
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'socket.action', { action, args: input.args });
  const result = await waitForCommand(commandId, 30_000);
  return context.json(result, 'status' in (result as object) ? 202 : 200);
});

const accountCreate = z.object({ display_name: z.string().min(1).max(80), phone_number: z.string().max(32).optional() });

app.get('/v1/accounts', requireAuth({ resource: 'accounts', action: 'read' }), async (context) => {
  const actor = context.get('actor');
  const accounts = await prisma.whatsAppAccount.findMany({
    where: { tenantId: actor.tenantId, ...(actor.accountIds ? { id: { in: actor.accountIds } } : {}) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, displayName: true, phoneNumber: true, whatsappJid: true, status: true,
      lastConnectedAt: true, lastError: true, createdAt: true, updatedAt: true,
    },
  });
  return context.json({ data: accounts });
});

app.post('/v1/accounts', requireAuth({ resource: 'accounts', action: 'write' }), async (context) => {
  const input = await body(context, accountCreate);
  const actor = context.get('actor');
  const account = await prisma.whatsAppAccount.create({
    data: {
      id: id('wa'), tenantId: actor.tenantId, displayName: input.display_name,
      phoneNumber: input.phone_number?.replace(/\D/g, '') || null,
    },
  });
  await prisma.auditLog.create({
    data: {
      id: id('aud'), tenantId: actor.tenantId, actorType: actor.type, actorId: actor.id,
      action: 'account.create', resourceType: 'whatsapp_account', resourceId: account.id,
    },
  });
  return context.json(account, 201);
});

app.get('/v1/accounts/:accountId', requireAuth({ resource: 'accounts', action: 'read' }), async (context) => {
  return context.json(await accountFor(context.get('actor'), context.req.param('accountId')));
});

app.get('/v1/accounts/:accountId/status', requireAuth({ resource: 'accounts', action: 'read' }), async (context) => {
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const mayPair = hasPermission(actor, 'accounts', 'pair');
  return context.json({
    id: account.id,
    status: account.status,
    phone_number: account.phoneNumber,
    whatsapp_jid: account.whatsappJid,
    pairing_mode: account.pairingMode,
    pairing_expires_at: account.pairingExpiresAt,
    ...(mayPair ? { qr_data_url: account.pairingQr, pairing_code: account.pairingCode } : {}),
    last_connected_at: account.lastConnectedAt,
    last_error: account.lastError,
  });
});

app.post('/v1/accounts/:accountId/pair/qr', requireAuth({ resource: 'accounts', action: 'pair' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  await prisma.whatsAppAccount.update({
    where: { id: account.id },
    data: {
      status: 'connecting', pairingMode: 'qr', pairingQr: null, pairingCode: null, lastError: null,
      pairingExpiresAt: new Date(Date.now() + config.PAIRING_TTL_SECONDS * 1000),
    },
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const updated = await prisma.whatsAppAccount.findUnique({ where: { id: account.id } });
    if (updated?.pairingQr) return context.json({ account_id: account.id, status: updated.status, qr_data_url: updated.pairingQr });
    if (updated?.status === 'connected') return context.json({ account_id: account.id, status: 'connected' });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return context.json({ account_id: account.id, status: 'connecting', status_url: `/v1/accounts/${account.id}/status` }, 202);
});

app.post('/v1/accounts/:accountId/pair/code', requireAuth({ resource: 'accounts', action: 'pair' }), async (context) => {
  const input = await body(context, z.object({ phone_number: z.string().min(7).max(32) }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const phoneNumber = input.phone_number.replace(/\D/g, '');
  await prisma.whatsAppAccount.update({
    where: { id: account.id },
    data: {
      status: 'connecting', pairingMode: 'code', phoneNumber, pairingCode: null, pairingQr: null, lastError: null,
      pairingExpiresAt: new Date(Date.now() + config.PAIRING_TTL_SECONDS * 1000),
    },
  });
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'pair.code', { phone_number: phoneNumber });
  return context.json(await waitForCommand(commandId, 20_000));
});

app.delete('/v1/accounts/:accountId/session', requireAuth({ resource: 'accounts', action: 'disconnect' }), async (context) => {
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'account.logout', {});
  return context.json(await waitForCommand(commandId, 20_000));
});

app.get('/v1/accounts/:accountId/chats', requireAuth({ resource: 'messages', action: 'read' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  return context.json({ data: await prisma.whatsAppChat.findMany({ where: { accountId: account.id }, orderBy: { updatedAt: 'desc' } }) });
});

app.get('/v1/accounts/:accountId/contacts', requireAuth({ resource: 'contacts', action: 'read' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  return context.json({ data: await prisma.whatsAppContact.findMany({ where: { accountId: account.id }, orderBy: { name: 'asc' } }) });
});

app.get('/v1/accounts/:accountId/groups', requireAuth({ resource: 'groups', action: 'read' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  return context.json({ data: await prisma.whatsAppGroup.findMany({ where: { accountId: account.id }, orderBy: { subject: 'asc' } }) });
});

app.get('/v1/accounts/:accountId/messages', requireAuth({ resource: 'messages', action: 'read' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  const limit = Math.min(Math.max(Number(context.req.query('limit') ?? 50), 1), 200);
  const before = context.req.query('before');
  const chatJid = context.req.query('chat_jid');
  const messages = await prisma.whatsAppMessage.findMany({
    where: {
      accountId: account.id,
      ...(chatJid ? { chatJid } : {}),
      ...(before ? { messageTimestamp: { lt: new Date(before) } } : {}),
    },
    orderBy: { messageTimestamp: 'desc' },
    take: limit,
  });
  return context.json({ data: messages, next_before: messages.at(-1)?.messageTimestamp.toISOString() ?? null });
});

app.post('/v1/accounts/:accountId/messages', requireAuth({ resource: 'messages', action: 'send' }), async (context) => {
  const input = await body(context, z.object({
    to: z.string().min(3),
    text: z.string().optional(),
    content: z.record(z.string(), z.unknown()).optional(),
  }).refine((value) => value.text !== undefined || value.content !== undefined, 'text or content is required'));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'message.send', input);
  const result = await waitForCommand(commandId, 30_000);
  return context.json(result, 'status' in (result as object) ? 202 : 200);
});

app.post('/v1/accounts/:accountId/groups', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const input = await body(context, z.object({ subject: z.string().min(1).max(100), participants: z.array(z.string()).min(1) }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'group.create', input);
  const result = await waitForCommand(commandId, 30_000);
  return context.json(result, 'status' in (result as object) ? 202 : 200);
});

app.patch('/v1/accounts/:accountId/groups/:groupId', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const input = await body(context, z.object({ subject: z.string().min(1).max(100).optional(), description: z.string().max(2048).optional() }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'group.update', { group_id: context.req.param('groupId'), ...input });
  return context.json(await waitForCommand(commandId, 30_000));
});

app.post('/v1/accounts/:accountId/groups/:groupId/participants', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const input = await body(context, z.object({ participants: z.array(z.string()).min(1), action: z.enum(['add', 'remove', 'promote', 'demote']).default('add') }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'group.participants', { group_id: context.req.param('groupId'), ...input });
  return context.json(await waitForCommand(commandId, 30_000));
});

app.delete('/v1/accounts/:accountId/groups/:groupId/participants/:participantId', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'group.participants', {
    group_id: context.req.param('groupId'), participants: [context.req.param('participantId')], action: 'remove',
  });
  return context.json(await waitForCommand(commandId, 30_000));
});

app.get('/v1/webhook-endpoints', requireAuth({ resource: 'webhooks', action: 'read' }), async (context) => {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { tenantId: context.get('actor').tenantId },
    select: { id: true, url: true, description: true, enabled: true, eventTypes: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return context.json({ data: endpoints });
});

app.post('/v1/webhook-endpoints', requireAuth({ resource: 'webhooks', action: 'write' }), async (context) => {
  const input = await body(context, z.object({ url: z.string().url(), description: z.string().max(200).optional(), event_types: z.array(z.string()).default([]) }));
  await validateWebhookUrl(input.url);
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      id: id('whe'), tenantId: context.get('actor').tenantId, url: input.url,
      description: input.description ?? null, eventTypes: input.event_types, secret: encryptJson(secret),
    },
    select: { id: true, url: true, description: true, enabled: true, eventTypes: true, createdAt: true },
  });
  return context.json({ ...endpoint, secret }, 201, { 'cache-control': 'no-store' });
});

app.delete('/v1/webhook-endpoints/:endpointId', requireAuth({ resource: 'webhooks', action: 'write' }), async (context) => {
  const result = await prisma.webhookEndpoint.deleteMany({
    where: { id: context.req.param('endpointId'), tenantId: context.get('actor').tenantId },
  });
  if (!result.count) throw new HTTPException(404, { message: 'Webhook endpoint not found' });
  return context.body(null, 204);
});

app.get('/v1/webhook-deliveries', requireAuth({ resource: 'webhooks', action: 'read' }), async (context) => {
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { endpoint: { tenantId: context.get('actor').tenantId } },
    include: { event: { select: { type: true, accountId: true, occurredAt: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return context.json({ data: deliveries });
});

app.post('/v1/webhook-deliveries/:deliveryId/replay', requireAuth({ resource: 'webhooks', action: 'replay' }), async (context) => {
  const delivery = await prisma.webhookDelivery.findFirst({
    where: { id: context.req.param('deliveryId'), endpoint: { tenantId: context.get('actor').tenantId } },
  });
  if (!delivery) throw new HTTPException(404, { message: 'Webhook delivery not found' });
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { status: 'pending', attemptCount: 0, nextAttemptAt: new Date(), lastError: null, deliveredAt: null },
  });
  return context.json({ id: delivery.id, status: 'pending' });
});

app.post('/v1/agent-access', requireAuth(), async (context) => {
  const actor = context.get('actor');
  if (actor.type !== 'user') throw new HTTPException(403, { message: 'Only an authenticated user can mint agent access' });
  const input = await body(context, z.object({
    name: z.string().min(1).max(32).default('Agent access'),
    account_ids: z.array(z.string()).optional(),
    expires_in_seconds: z.number().int().positive().max(31_536_000).nullable().optional(),
    permissions: z.record(z.string(), z.array(z.string())).optional(),
  }));
  if (input.account_ids?.length) {
    const count = await prisma.whatsAppAccount.count({ where: { tenantId: actor.tenantId, id: { in: input.account_ids } } });
    if (count !== input.account_ids.length) throw new HTTPException(400, { message: 'One or more account IDs are invalid' });
  }
  const permissions = input.permissions ?? {
    accounts: ['read'], messages: ['read', 'send'], groups: ['read', 'write'], contacts: ['read'], agent: ['skill'],
  };
  const key = await auth.api.createApiKey({
    body: {
      name: input.name,
      userId: actor.userId,
      permissions,
      metadata: { tenant_id: actor.tenantId, account_ids: input.account_ids ?? null },
      expiresIn: input.expires_in_seconds ?? null,
    },
  });
  return context.json({ api_key: key.key, key_id: key.id, skill_md: buildAgentSkill(key.key) }, 201, { 'cache-control': 'no-store' });
});

app.onError((error, context) => {
  if (error instanceof HTTPException) return context.json({ error: 'request_error', message: error.message }, error.status);
  console.error(error);
  return context.json({ error: 'internal_error', message: config.NODE_ENV === 'development' ? error.message : 'Internal server error' }, 500);
});

export { app };
