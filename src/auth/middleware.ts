import type { MiddlewareHandler } from 'hono';
import { auth } from './auth.js';
import { ensureTenant } from '../services/tenants.js';

export type AuthActor = {
  type: 'user' | 'api_key';
  id: string;
  userId: string;
  tenantId: string;
  permissions: Record<string, string[]> | null;
  accountIds: string[] | null;
};

export type GatewayVariables = {
  actor: AuthActor;
};

type Permission = { resource: string; action: string };

function apiKeyFromHeaders(headers: Headers): string | null {
  const direct = headers.get('x-api-key');
  if (direct) return direct;
  const authorization = headers.get('authorization');
  if (authorization?.startsWith('Bearer wag_')) return authorization.slice(7);
  return null;
}

export function requireAuth(permission?: Permission): MiddlewareHandler<{ Variables: GatewayVariables }> {
  return async (context, next) => {
    const rawKey = apiKeyFromHeaders(context.req.raw.headers);
    if (rawKey) {
      const permissions = permission ? { [permission.resource]: [permission.action] } : undefined;
      const verification = await auth.api.verifyApiKey({ body: { key: rawKey, ...(permissions ? { permissions } : {}) } });
      if (!verification.valid || !verification.key) {
        return context.json({ error: 'invalid_api_key', message: verification.error?.message ?? 'Invalid API key' }, 401);
      }
      const tenant = await ensureTenant(verification.key.referenceId);
      context.set('actor', {
        type: 'api_key',
        id: verification.key.id,
        userId: verification.key.referenceId,
        tenantId: tenant.id,
        permissions: verification.key.permissions ?? null,
        accountIds: Array.isArray(verification.key.metadata?.account_ids)
          ? verification.key.metadata.account_ids.filter((value): value is string => typeof value === 'string')
          : null,
      });
      return next();
    }

    const session = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!session) return context.json({ error: 'unauthorized', message: 'Sign in or provide an API key' }, 401);
    const tenant = await ensureTenant(session.user.id, session.user.name || 'My workspace');
    context.set('actor', {
      type: 'user',
      id: session.user.id,
      userId: session.user.id,
      tenantId: tenant.id,
      permissions: null,
      accountIds: null,
    });
    return next();
  };
}
