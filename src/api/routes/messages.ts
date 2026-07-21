import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireAuth, type GatewayVariables } from '../../auth/middleware.js';
import { prisma } from '../../db/prisma.js';
import { accountFor, body, dateQuery, dispatchCommand, limitQuery } from '../helpers.js';

const app = new Hono<{ Variables: GatewayVariables }>();

app.get('/v1/accounts/:accountId/messages', requireAuth({ resource: 'messages', action: 'read' }), async (context) => {
  const account = await accountFor(context.get('actor'), context.req.param('accountId'));
  const limit = limitQuery(context.req.query('limit'), 50, 200);
  const before = context.req.query('before');
  const chatJid = context.req.query('chat_jid');
  const since = dateQuery(context.req.query('since'), 'since');
  const beforeDate = dateQuery(before, 'before');
  const unreadOnly = context.req.query('unread') === 'true';
  const direction = context.req.query('direction');
  const messageStatus = context.req.query('status');
  const messageType = context.req.query('type');
  const senderJid = context.req.query('sender_jid');
  const search = context.req.query('q');
  const messageId = context.req.query('message_id');
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
      ...(search ? { text: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(messageId ? { OR: [{ id: messageId }, { whatsappMessageId: messageId }] } : {}),
      ...((beforeDate || since) ? { messageTimestamp: { ...(beforeDate ? { lt: beforeDate } : {}), ...(since ? { gte: since } : {}) } } : {}),
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
  return dispatchCommand(context, account, 'message.send', input);
});

// React to a stored message with an emoji (empty string removes the reaction).
app.post('/v1/accounts/:accountId/messages/:messageId/reaction', requireAuth({ resource: 'messages', action: 'send' }), async (context) => {
  const input = await body(context, z.object({ emoji: z.string().max(16) }));
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const message = await prisma.whatsAppMessage.findFirst({
    where: { id: context.req.param('messageId'), accountId: account.id },
    select: { chatJid: true, payload: true },
  });
  if (!message) throw new HTTPException(404, { message: 'Message not found' });
  const key = (message.payload as { key?: unknown } | null)?.key;
  if (!key) throw new HTTPException(422, { message: 'This message cannot be reacted to' });
  return dispatchCommand(context, account, 'message.send', { to: message.chatJid, content: { react: { text: input.emoji, key } } });
});

// Mark a stored message as read.
app.post('/v1/accounts/:accountId/messages/:messageId/read', requireAuth({ resource: 'messages', action: 'write' }), async (context) => {
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const message = await prisma.whatsAppMessage.findFirst({
    where: { id: context.req.param('messageId'), accountId: account.id },
    select: { payload: true },
  });
  if (!message) throw new HTTPException(404, { message: 'Message not found' });
  const key = (message.payload as { key?: unknown } | null)?.key;
  if (!key) throw new HTTPException(422, { message: 'This message cannot be marked as read' });
  return dispatchCommand(context, account, 'socket.action', { action: 'messages.read', args: [[key]] });
});

export { app as messageRoutes };
