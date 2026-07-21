import { randomBytes } from 'node:crypto';
import { BufferJSON, downloadMediaMessage, getContentType, type WAMessage, type WAMessageContent } from 'baileys';
import { Scalar } from '@scalar/hono-api-reference';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { auth, gatewayPermissions } from '../auth/auth.js';
import { requireAuth, type GatewayVariables } from '../auth/middleware.js';
import { config } from '../config.js';
import { encryptJson } from '../crypto.js';
import { prisma } from '../db/prisma.js';
import { id } from '../ids.js';
import { logger } from '../logger.js';
import { buildAgentCapabilities, buildAgentSkill } from '../skill.js';
import { commandEnvelope, enqueueCommand, IdempotencyConflictError, waitForCommand } from '../services/commands.js';
import { gatewayEventTypes } from '../services/event-types.js';
import { validateWebhookUrl } from '../webhooks/url-security.js';
import { openApiDocument } from './openapi.js';
import { baileysActions, isBaileysAction } from '../baileys/actions.js';

const app = new Hono<{ Variables: GatewayVariables }>();

app.use('*', cors({
  origin: config.WEB_ORIGIN,
  credentials: true,
  allowHeaders: ['content-type', 'authorization', 'x-api-key', 'idempotency-key'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.get('/health', (context) => context.json({ status: 'ok', service: 'whatsapp-gateway', release: config.GATEWAY_RELEASE }));
app.get('/health/ready', async (context) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return context.json({ status: 'ready', service: 'whatsapp-gateway', release: config.GATEWAY_RELEASE });
  } catch (error) {
    logger.error({ error }, 'Readiness check failed');
    return context.json({ status: 'not_ready', service: 'whatsapp-gateway', release: config.GATEWAY_RELEASE }, 503);
  }
});
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
app.get('/v1/capabilities.md', (context) => context.text(buildAgentCapabilities(), 200, { 'content-type': 'text/markdown; charset=utf-8' }));
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

function idempotencyKey(context: { req: { header: (name: string) => string | undefined } }): string | undefined {
  const value = context.req.header('Idempotency-Key')?.trim();
  if (value && value.length > 200) throw new HTTPException(400, { message: 'Idempotency-Key must be 200 characters or fewer' });
  return value || undefined;
}

function dateQuery(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new HTTPException(400, { message: `${name} must be an ISO-8601 timestamp` });
  return parsed;
}

function commandStatus(result: { status: string }): 200 | 202 {
  return result.status === 'pending' || result.status === 'processing' ? 202 : 200;
}

app.get('/v1/baileys-actions', requireAuth({ resource: 'accounts', action: 'read' }), (context) => {
  return context.json({
    data: Object.entries(baileysActions).map(([name, definition]) => ({ name, ...definition })),
  });
});

app.get('/v1/webhook-event-types', requireAuth({ resource: 'webhooks', action: 'read' }), (context) => {
  return context.json({ data: gatewayEventTypes });
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
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'socket.action', { action, args: input.args }, idempotencyKey(context));
  const result = await waitForCommand(commandId, 30_000);
  return context.json(result, commandStatus(result));
});

app.get('/v1/commands/:commandId', requireAuth(), async (context) => {
  const actor = context.get('actor');
  const waitSeconds = Math.min(Math.max(Number(context.req.query('wait_seconds') ?? 0), 0), 30);
  const deadline = Date.now() + waitSeconds * 1000;
  while (true) {
    const command = await prisma.outboundCommand.findFirst({
      where: {
        id: context.req.param('commandId'),
        tenantId: actor.tenantId,
        ...(actor.accountIds ? { accountId: { in: actor.accountIds } } : {}),
      },
      select: {
        id: true, accountId: true, type: true, status: true, result: true, error: true,
        attemptCount: true, idempotencyKey: true, createdAt: true, updatedAt: true, completedAt: true,
      },
    });
    if (!command) throw new HTTPException(404, { message: 'Command not found' });
    if (command.status === 'completed' || command.status === 'failed' || Date.now() >= deadline) return context.json(commandEnvelope(command));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

app.get('/v1/events', requireAuth(), async (context) => {
  const actor = context.get('actor');
  const accountId = context.req.query('account_id');
  if (accountId) await accountFor(actor, accountId);
  const afterSequenceRaw = context.req.query('after_sequence');
  let afterSequence: bigint | undefined;
  if (afterSequenceRaw) {
    try { afterSequence = BigInt(afterSequenceRaw); } catch { throw new HTTPException(400, { message: 'after_sequence must be an integer' }); }
  }
  const limit = Math.min(Math.max(Number(context.req.query('limit') ?? 100), 1), 500);
  const eventType = context.req.query('type');
  const since = dateQuery(context.req.query('since'), 'since');
  const events = await prisma.inboundEvent.findMany({
    where: {
      tenantId: actor.tenantId,
      ...(accountId ? { accountId } : actor.accountIds ? { accountId: { in: actor.accountIds } } : {}),
      ...(eventType ? { type: eventType } : {}),
      ...(afterSequence !== undefined ? { sequence: { gt: afterSequence } } : {}),
      ...(since ? { occurredAt: { gte: since } } : {}),
    },
    orderBy: [{ occurredAt: 'asc' }, { sequence: 'asc' }],
    take: limit,
  });
  return context.json({
    data: events.map((event) => ({ ...event, sequence: Number(event.sequence) })),
    next_after_sequence: events.at(-1)?.sequence.toString() ?? afterSequenceRaw ?? null,
  });
});

app.get('/v1/api-keys', requireAuth(), async (context) => {
  const actor = context.get('actor');
  if (actor.type !== 'user') throw new HTTPException(403, { message: 'Only a signed-in owner can manage API keys' });
  const keys = await prisma.apikey.findMany({
    where: { referenceId: actor.userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, start: true, prefix: true, enabled: true, expiresAt: true,
      createdAt: true, updatedAt: true, lastRequest: true, rateLimitEnabled: true,
      rateLimitMax: true, rateLimitTimeWindow: true, permissions: true, metadata: true,
    },
  });
  return context.json({ data: keys.map((key) => {
    const metadata = key.metadata ? JSON.parse(key.metadata) as { account_ids?: string[] | null } : null;
    const accountIds = Array.isArray(metadata?.account_ids) ? metadata.account_ids : null;
    return {
      ...key,
      permissions: key.permissions ? JSON.parse(key.permissions) : null,
      metadata,
      scope: accountIds?.length === 1 ? 'connection' : 'account',
      account_id: accountIds?.length === 1 ? accountIds[0] : null,
    };
  }) });
});

app.post('/v1/api-keys', requireAuth(), async (context) => {
  const actor = context.get('actor');
  if (actor.type !== 'user') throw new HTTPException(403, { message: 'Only a signed-in owner can create API keys' });
  const input = await body(context, z.object({
    name: z.string().min(1).max(32),
    scope: z.enum(['account', 'connection']).default('connection'),
    account_id: z.string().optional(),
    expires_in_seconds: z.number().int().min(86_400).max(31_536_000).nullable().optional(),
    permissions: z.record(z.string(), z.array(z.string())).optional(),
  }).refine((value) => value.scope !== 'connection' || Boolean(value.account_id), 'account_id is required for a connection key'));
  if (input.scope === 'connection') await accountFor(actor, input.account_id!);
  const key = await auth.api.createApiKey({ body: {
    name: input.name,
    userId: actor.userId,
    expiresIn: input.expires_in_seconds ?? null,
    permissions: input.permissions ?? Object.fromEntries(Object.entries(gatewayPermissions).map(([resource, actions]) => [resource, [...actions]])),
    metadata: { tenant_id: actor.tenantId, account_ids: input.scope === 'connection' ? [input.account_id!] : null },
  } });
  await prisma.auditLog.create({ data: {
    id: id('aud'), tenantId: actor.tenantId, actorType: actor.type, actorId: actor.id,
    action: 'api_key.create', resourceType: 'api_key', resourceId: key.id,
    data: { scope: input.scope, account_id: input.account_id ?? null },
  } });
  return context.json({
    id: key.id, key: key.key, name: key.name, scope: input.scope,
    account_id: input.scope === 'connection' ? input.account_id : null,
    expires_at: key.expiresAt, permissions: key.permissions,
  }, 201, { 'cache-control': 'no-store' });
});

app.delete('/v1/api-keys/:keyId', requireAuth(), async (context) => {
  const actor = context.get('actor');
  if (actor.type !== 'user') throw new HTTPException(403, { message: 'Only a signed-in owner can revoke API keys' });
  const deleted = await prisma.apikey.deleteMany({ where: { id: context.req.param('keyId'), referenceId: actor.userId } });
  if (!deleted.count) throw new HTTPException(404, { message: 'API key not found' });
  await prisma.auditLog.create({ data: {
    id: id('aud'), tenantId: actor.tenantId, actorType: actor.type, actorId: actor.id,
    action: 'api_key.revoke', resourceType: 'api_key', resourceId: context.req.param('keyId'),
  } });
  return context.body(null, 204);
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
  if (actor.accountIds) throw new HTTPException(403, { message: 'A connection-scoped key cannot create another connection' });
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
  // Pairing credentials are intentionally available only to the signed-in owner
  // on this general-purpose status route. API keys can still start an explicitly
  // authorized pairing operation, whose response returns the requested QR/code.
  const mayPair = actor.type === 'user' && hasPermission(actor, 'accounts', 'pair');
  return context.json({
    id: account.id,
    status: account.status,
    phone_number: account.phoneNumber,
    whatsapp_jid: account.whatsappJid,
    pairing_mode: account.pairingMode,
    pairing_expires_at: account.pairingExpiresAt,
    ...(mayPair ? { qr_data_url: account.pairingQr, pairing_code: account.pairingCode } : {}),
    last_connected_at: account.lastConnectedAt,
    last_connect_attempt_at: account.lastConnectAttemptAt,
    next_connect_at: account.nextConnectAt,
    reconnect_attempt: account.reconnectAttempt,
    last_error: account.lastError,
  });
});

app.post('/v1/accounts/:accountId/pair/qr', requireAuth({ resource: 'accounts', action: 'pair' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  const activePairing = account.pairingMode === 'qr'
    && account.pairingExpiresAt !== null
    && account.pairingExpiresAt.getTime() > Date.now();
  if (activePairing && account.pairingQr) {
    return context.json({ account_id: account.id, status: account.status, qr_data_url: account.pairingQr });
  }
  if (!activePairing) {
    await prisma.whatsAppAccount.update({
      where: { id: account.id },
      data: {
        status: 'connecting', pairingMode: 'qr', pairingQr: null, pairingCode: null, lastError: null,
        reconnectAttempt: 0, nextConnectAt: null,
        pairingExpiresAt: new Date(Date.now() + config.PAIRING_TTL_SECONDS * 1000),
      },
    });
  }
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
      reconnectAttempt: 0, nextConnectAt: null,
      pairingExpiresAt: new Date(Date.now() + config.PAIRING_TTL_SECONDS * 1000),
    },
  });
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'pair.code', { phone_number: phoneNumber }, idempotencyKey(context));
  const result = await waitForCommand(commandId, 20_000);
  return context.json(result, commandStatus(result));
});

app.delete('/v1/accounts/:accountId/session', requireAuth({ resource: 'accounts', action: 'disconnect' }), async (context) => {
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'account.logout', {}, idempotencyKey(context));
  const result = await waitForCommand(commandId, 20_000);
  return context.json(result, commandStatus(result));
});

app.get('/v1/accounts/:accountId/chats', requireAuth({ resource: 'messages', action: 'read' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  const query = context.req.query('q');
  const unread = context.req.query('unread');
  const archived = context.req.query('archived');
  return context.json({ data: await prisma.whatsAppChat.findMany({
    where: {
      accountId: account.id,
      ...(query ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { jid: { contains: query, mode: 'insensitive' } }] } : {}),
      ...(unread === 'true' ? { unreadCount: { gt: 0 } } : {}),
      ...(archived === 'true' ? { archived: true } : archived === 'false' ? { archived: false } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  }) });
});

app.get('/v1/accounts/:accountId/contacts', requireAuth({ resource: 'contacts', action: 'read' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  const query = context.req.query('q');
  return context.json({ data: await prisma.whatsAppContact.findMany({
    where: { accountId: account.id, ...(query ? { OR: [
      { name: { contains: query, mode: 'insensitive' } }, { notify: { contains: query, mode: 'insensitive' } },
      { phoneNumber: { contains: query } }, { jid: { contains: query, mode: 'insensitive' } },
    ] } : {}) },
    orderBy: { name: 'asc' },
  }) });
});

app.get('/v1/accounts/:accountId/groups', requireAuth({ resource: 'groups', action: 'read' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  const query = context.req.query('q');
  return context.json({ data: await prisma.whatsAppGroup.findMany({
    where: { accountId: account.id, ...(query ? { OR: [{ subject: { contains: query, mode: 'insensitive' } }, { jid: { contains: query, mode: 'insensitive' } }] } : {}) },
    orderBy: { subject: 'asc' },
  }) });
});

app.get('/v1/accounts/:accountId/messages', requireAuth({ resource: 'messages', action: 'read' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  const limit = Math.min(Math.max(Number(context.req.query('limit') ?? 50), 1), 200);
  const before = context.req.query('before');
  const chatJid = context.req.query('chat_jid');
  const since = dateQuery(context.req.query('since'), 'since');
  const beforeDate = dateQuery(before, 'before');
  const unreadOnly = context.req.query('unread') === 'true';
  const direction = context.req.query('direction');
  const messageStatus = context.req.query('status');
  const messageType = context.req.query('type');
  const senderJid = context.req.query('sender_jid');
  const unreadChatIds = unreadOnly
    ? (await prisma.whatsAppChat.findMany({ where: { accountId: account.id, unreadCount: { gt: 0 } }, select: { jid: true } })).map((chat) => chat.jid)
    : undefined;
  const messages = await prisma.whatsAppMessage.findMany({
    where: {
      accountId: account.id,
      ...(chatJid ? { chatJid } : {}),
      ...(unreadChatIds ? { chatJid: { in: unreadChatIds }, direction: 'inbound' } : {}),
      ...(direction ? { direction } : {}),
      ...(messageStatus ? { status: messageStatus } : {}),
      ...(messageType ? { messageType } : {}),
      ...(senderJid ? { senderJid } : {}),
      ...((beforeDate || since) ? { messageTimestamp: { ...(beforeDate ? { lt: beforeDate } : {}), ...(since ? { gte: since } : {}) } } : {}),
    },
    orderBy: { messageTimestamp: 'desc' },
    take: limit,
  });
  return context.json({ data: messages, next_before: messages.at(-1)?.messageTimestamp.toISOString() ?? null });
});

// Message content nodes that carry downloadable media.
const MEDIA_CONTENT_TYPES = new Set([
  'imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage', 'documentWithCaptionMessage',
]);

/** Peel ephemeral / view-once / edited / device-sent envelopes to the real content. */
function unwrapContent(content: WAMessageContent | null | undefined): WAMessageContent | null | undefined {
  let current = content;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const nested = current.ephemeralMessage?.message
      ?? current.viewOnceMessage?.message
      ?? current.viewOnceMessageV2?.message
      ?? current.viewOnceMessageV2Extension?.message
      ?? current.documentWithCaptionMessage?.message
      ?? current.editedMessage?.message
      ?? current.deviceSentMessage?.message;
    if (!nested) break;
    current = nested;
  }
  return current;
}

// Download and decrypt the media attached to a stored message. Decryption uses
// the media keys already saved in the message payload, so the API can serve the
// bytes directly (no worker round-trip) as long as WhatsApp still hosts them.
app.get('/v1/accounts/:accountId/messages/:messageId/media', requireAuth({ resource: 'messages', action: 'read' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  const record = await prisma.whatsAppMessage.findFirst({
    where: { id: context.req.param('messageId'), accountId: account.id },
    select: { payload: true, messageType: true },
  });
  if (!record) throw new HTTPException(404, { message: 'Message not found' });

  const message = JSON.parse(JSON.stringify(record.payload), BufferJSON.reviver) as WAMessage;
  const content = unwrapContent(message.message);
  const contentType = getContentType(content ?? undefined);
  if (!contentType || !MEDIA_CONTENT_TYPES.has(contentType)) {
    throw new HTTPException(404, { message: 'This message has no downloadable media' });
  }
  const node = (content as Record<string, { mimetype?: string; fileName?: string } | undefined>)[contentType];

  let buffer: Buffer;
  try {
    buffer = await downloadMediaMessage(
      { ...message, message: content ?? null },
      'buffer',
      {},
      { logger, reuploadRequest: () => { throw new Error('media reupload requires an active session'); } },
    );
  } catch (error) {
    logger.warn({ err: error, accountId: account.id, messageId: context.req.param('messageId') }, 'Media download failed');
    throw new HTTPException(502, { message: 'Media could not be downloaded. It may have expired — refresh it with the messages.media.refresh action, then retry.' });
  }

  const mimetype = node?.mimetype?.split(';')[0]?.trim() || 'application/octet-stream';
  const extension = mimetype.split('/')[1] || 'bin';
  const safeName = (node?.fileName || `${contentType.replace('Message', '')}-${context.req.param('messageId')}.${extension}`).replace(/[\r\n"]/g, '');
  const disposition = context.req.query('download') === '1' || contentType.startsWith('document') ? 'attachment' : 'inline';
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': mimetype,
      'content-length': String(buffer.length),
      'content-disposition': `${disposition}; filename="${safeName}"`,
      'cache-control': 'private, max-age=3600',
    },
  });
});

app.post('/v1/accounts/:accountId/messages', requireAuth({ resource: 'messages', action: 'send' }), async (context) => {
  const input = await body(context, z.object({
    to: z.string().min(3),
    text: z.string().optional(),
    content: z.record(z.string(), z.unknown()).optional(),
  }).refine((value) => value.text !== undefined || value.content !== undefined, 'text or content is required'));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'message.send', input, idempotencyKey(context));
  const result = await waitForCommand(commandId, 30_000);
  return context.json(result, commandStatus(result));
});

app.post('/v1/accounts/:accountId/groups', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const input = await body(context, z.object({ subject: z.string().min(1).max(100), participants: z.array(z.string()).min(1) }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'group.create', input, idempotencyKey(context));
  const result = await waitForCommand(commandId, 30_000);
  return context.json(result, commandStatus(result));
});

app.patch('/v1/accounts/:accountId/groups/:groupId', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const input = await body(context, z.object({ subject: z.string().min(1).max(100).optional(), description: z.string().max(2048).optional() }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'group.update', { group_id: context.req.param('groupId'), ...input }, idempotencyKey(context));
  const result = await waitForCommand(commandId, 30_000);
  return context.json(result, commandStatus(result));
});

app.post('/v1/accounts/:accountId/groups/:groupId/participants', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const input = await body(context, z.object({ participants: z.array(z.string()).min(1), action: z.enum(['add', 'remove', 'promote', 'demote']).default('add') }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'group.participants', { group_id: context.req.param('groupId'), ...input }, idempotencyKey(context));
  const result = await waitForCommand(commandId, 30_000);
  return context.json(result, commandStatus(result));
});

app.delete('/v1/accounts/:accountId/groups/:groupId/participants/:participantId', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const commandId = await enqueueCommand(actor.tenantId, account.id, 'group.participants', {
    group_id: context.req.param('groupId'), participants: [context.req.param('participantId')], action: 'remove',
  }, idempotencyKey(context));
  const result = await waitForCommand(commandId, 30_000);
  return context.json(result, commandStatus(result));
});

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

app.get('/v1/webhook-deliveries', requireAuth({ resource: 'webhooks', action: 'read' }), async (context) => {
  const actor = context.get('actor');
  const limit = Math.min(Math.max(Number(context.req.query('limit') ?? 100), 1), 500);
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

app.onError((error, context) => {
  if (error instanceof IdempotencyConflictError) return context.json({ error: 'idempotency_conflict', message: error.message }, 409);
  if (error instanceof HTTPException) return context.json({ error: 'request_error', message: error.message }, error.status);
  console.error(error);
  return context.json({ error: 'internal_error', message: config.NODE_ENV === 'development' ? error.message : 'Internal server error' }, 500);
});

export { app };
