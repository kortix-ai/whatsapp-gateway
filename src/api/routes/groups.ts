import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, type GatewayVariables } from '../../auth/middleware.js';
import { prisma } from '../../db/prisma.js';
import { accountFor, body, dispatchCommand } from '../helpers.js';

const app = new Hono<{ Variables: GatewayVariables }>();

app.get('/v1/accounts/:accountId/groups', requireAuth({ resource: 'groups', action: 'read' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  const query = context.req.query('q');
  return context.json({ data: await prisma.whatsAppGroup.findMany({
    where: { accountId: account.id, ...(query ? { OR: [{ subject: { contains: query, mode: 'insensitive' } }, { jid: { contains: query, mode: 'insensitive' } }] } : {}) },
    orderBy: { subject: 'asc' },
  }) });
});

app.post('/v1/accounts/:accountId/groups', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const input = await body(context, z.object({ subject: z.string().min(1).max(100), participants: z.array(z.string()).min(1) }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  return dispatchCommand(context, account, 'group.create', input);
});

app.patch('/v1/accounts/:accountId/groups/:groupId', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const input = await body(context, z.object({ subject: z.string().min(1).max(100).optional(), description: z.string().max(2048).optional() }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  return dispatchCommand(context, account, 'group.update', { group_id: context.req.param('groupId'), ...input });
});

app.post('/v1/accounts/:accountId/groups/:groupId/participants', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const input = await body(context, z.object({ participants: z.array(z.string()).min(1), action: z.enum(['add', 'remove', 'promote', 'demote']).default('add') }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  return dispatchCommand(context, account, 'group.participants', { group_id: context.req.param('groupId'), ...input });
});

app.delete('/v1/accounts/:accountId/groups/:groupId/participants/:participantId', requireAuth({ resource: 'groups', action: 'write' }), async (context) => {
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  return dispatchCommand(context, account, 'group.participants', {
    group_id: context.req.param('groupId'), participants: [context.req.param('participantId')], action: 'remove',
  });
});

export { app as groupRoutes };
