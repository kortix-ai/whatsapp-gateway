import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { auth, gatewayPermissions } from '../../auth/auth.js';
import { requireAuth, type GatewayVariables } from '../../auth/middleware.js';
import { prisma } from '../../db/prisma.js';
import { id } from '../../ids.js';
import { accountFor, body } from '../helpers.js';

const app = new Hono<{ Variables: GatewayVariables }>();

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

export { app as apiKeyRoutes };
