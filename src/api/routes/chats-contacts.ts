import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, type GatewayVariables } from '../../auth/middleware.js';
import { prisma } from '../../db/prisma.js';
import { accountFor, body, dispatchCommand } from '../helpers.js';

const app = new Hono<{ Variables: GatewayVariables }>();

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

// Chat state: archive, pin, mute, and read/unread in one resource update.
app.patch('/v1/accounts/:accountId/chats/:chatJid', requireAuth({ resource: 'chats', action: 'write' }), async (context) => {
  const input = await body(context, z.object({
    archived: z.boolean().optional(),
    pinned: z.boolean().optional(),
    muted: z.boolean().optional(),
    mute_seconds: z.number().int().positive().optional(),
    read: z.boolean().optional(),
  }).refine((value) => Object.keys(value).length > 0, 'At least one chat state field is required'));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const chatJid = decodeURIComponent(context.req.param('chatJid'));

  const modification: Record<string, unknown> = {};
  if (input.archived !== undefined) modification.archive = input.archived;
  if (input.pinned !== undefined) modification.pin = input.pinned;
  if (input.muted !== undefined) modification.mute = input.muted ? (input.mute_seconds ?? 8 * 60 * 60) * 1000 : null;
  if (input.read !== undefined) modification.markRead = input.read;

  return dispatchCommand(context, account, 'socket.action', { action: 'chats.modify', args: [modification, chatJid] });
});

// Broadcast presence (available, unavailable, composing, recording, paused).
app.post('/v1/accounts/:accountId/presence', requireAuth({ resource: 'presence', action: 'write' }), async (context) => {
  const input = await body(context, z.object({
    state: z.enum(['available', 'unavailable', 'composing', 'recording', 'paused']),
    to: z.string().optional(),
  }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  return dispatchCommand(context, account, 'socket.action', { action: 'presence.update', args: input.to ? [input.state, input.to] : [input.state] });
});

export { app as chatContactRoutes };
