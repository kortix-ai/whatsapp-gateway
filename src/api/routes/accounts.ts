import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireAuth, type GatewayVariables } from '../../auth/middleware.js';
import { config } from '../../config.js';
import { redactProxy } from '../../baileys/proxy.js';
import { prisma } from '../../db/prisma.js';
import { id } from '../../ids.js';
import { accountFor, body, dispatchCommand, hasPermission } from '../helpers.js';

const app = new Hono<{ Variables: GatewayVariables }>();

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
    ...(mayPair ? { qr_data_url: account.pairingQr, qr: account.pairingQrRaw, pairing_code: account.pairingCode } : {}),
    last_connected_at: account.lastConnectedAt,
    last_connect_attempt_at: account.lastConnectAttemptAt,
    next_connect_at: account.nextConnectAt,
    reconnect_attempt: account.reconnectAttempt,
    last_error: account.lastError,
    proxy: config.WA_PROXY_URL ? redactProxy(config.WA_PROXY_URL) : null,
  });
});

app.post('/v1/accounts/:accountId/pair/qr', requireAuth({ resource: 'accounts', action: 'pair' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  const activePairing = account.pairingMode === 'qr'
    && account.pairingExpiresAt !== null
    && account.pairingExpiresAt.getTime() > Date.now();
  if (activePairing && account.pairingQr) {
    return context.json({ account_id: account.id, status: account.status, qr_data_url: account.pairingQr, qr: account.pairingQrRaw });
  }
  if (!activePairing) {
    await prisma.whatsAppAccount.update({
      where: { id: account.id },
      data: {
        status: 'connecting', pairingMode: 'qr', pairingQr: null, pairingQrRaw: null, pairingCode: null, lastError: null,
        reconnectAttempt: 0, nextConnectAt: null,
        pairingExpiresAt: new Date(Date.now() + config.PAIRING_TTL_SECONDS * 1000),
      },
    });
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const updated = await prisma.whatsAppAccount.findUnique({ where: { id: account.id } });
    if (updated?.pairingQr) return context.json({ account_id: account.id, status: updated.status, qr_data_url: updated.pairingQr, qr: updated.pairingQrRaw });
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
      status: 'connecting', pairingMode: 'code', phoneNumber, pairingCode: null, pairingQr: null, pairingQrRaw: null, lastError: null,
      reconnectAttempt: 0, nextConnectAt: null,
      pairingExpiresAt: new Date(Date.now() + config.PAIRING_TTL_SECONDS * 1000),
    },
  });
  return dispatchCommand(context, account, 'pair.code', { phone_number: phoneNumber }, 20_000);
});

app.delete('/v1/accounts/:accountId/session', requireAuth({ resource: 'accounts', action: 'disconnect' }), async (context) => {
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  return dispatchCommand(context, account, 'account.logout', {}, 20_000);
});

export { app as accountRoutes };
