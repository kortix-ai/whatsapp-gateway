import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireAuth, type GatewayVariables } from '../../auth/middleware.js';
import { prisma } from '../../db/prisma.js';
import { CommandNotFoundError, waitForCommand } from '../../services/commands.js';
import { gatewayEventTypes } from '../../services/event-types.js';
import { baileysActions, isBaileysAction } from '../../baileys/actions.js';
import { accountFor, body, dateQuery, dispatchCommand, hasPermission, limitQuery } from '../helpers.js';

const app = new Hono<{ Variables: GatewayVariables }>();

// Every action is annotated with whether the calling credential may actually
// run it, so clients can present exactly the surface a key is authorized for.
// `?allowed=true` returns only the permitted actions.
app.get('/v1/baileys-actions', requireAuth({ resource: 'accounts', action: 'read' }), (context) => {
  const actor = context.get('actor');
  const onlyAllowed = context.req.query('allowed') === 'true';
  const entries = Object.entries(baileysActions).map(([name, definition]) => ({
    name,
    ...definition,
    allowed: hasPermission(actor, definition.permission.resource, definition.permission.action),
  }));
  return context.json({ data: onlyAllowed ? entries.filter((entry) => entry.allowed) : entries });
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
  return dispatchCommand(context, account, 'socket.action', { action, args: input.args });
});

app.get('/v1/commands/:commandId', requireAuth(), async (context) => {
  const actor = context.get('actor');
  const waitSeconds = Math.min(Math.max(Number(context.req.query('wait_seconds') ?? 0), 0), 30);
  try {
    const result = await waitForCommand(context.req.param('commandId'), waitSeconds * 1000, {
      tenantId: actor.tenantId,
      ...(actor.accountIds ? { accountId: { in: actor.accountIds } } : {}),
    });
    return context.json(result);
  } catch (error) {
    if (error instanceof CommandNotFoundError) throw new HTTPException(404, { message: 'Command not found' });
    throw error;
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
  const limit = limitQuery(context.req.query('limit'), 100, 500);
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

export { app as commandRoutes };
