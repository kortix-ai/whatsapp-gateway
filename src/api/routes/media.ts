import { BufferJSON, downloadMediaMessage, getContentType, type WAMessage, type WAMessageContent } from 'baileys';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth, type GatewayVariables } from '../../auth/middleware.js';
import { prisma } from '../../db/prisma.js';
import { id } from '../../ids.js';
import { logger } from '../../logger.js';
import { needsTranscode, toMp3, TranscodeError } from '../transcode.js';
import { accountFor, dispatchCommand } from '../helpers.js';

const app = new Hono<{ Variables: GatewayVariables }>();

// Media downloads hit WhatsApp's CDN directly from this process; route them through
// the same residential proxy as the socket so no WhatsApp traffic reveals the datacenter IP.

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
      // No dispatcher here on purpose. Baileys downloads via Node's native
      // fetch, and handing it a dispatcher from the userland undici package
      // fails with "invalid onRequestStart method" — the two undici copies
      // disagree on the request-handler contract. The proxy is applied
      // process-wide via setGlobalDispatcher in main.ts instead, which native
      // fetch honours (verified in production, streamed bodies included).
      {},
      { logger, reuploadRequest: () => { throw new Error('media reupload requires an active session'); } },
    );
  } catch (error) {
    logger.warn({ err: error, accountId: account.id, messageId: context.req.param('messageId') }, 'Media download failed');
    throw new HTTPException(502, { message: 'Media could not be downloaded. It may have expired — refresh it with the messages.media.refresh action, then retry.' });
  }

  let mimetype = node?.mimetype?.split(';')[0]?.trim() || 'application/octet-stream';
  // Voice notes arrive as ogg/opus, which almost nothing downstream can decode —
  // the practical result being a recipient who downloads a voice message and
  // asks the sender to type it out. Hand back mp3 unless the caller explicitly
  // wants the original bytes.
  if (context.req.query('format') !== 'original' && needsTranscode(node?.mimetype)) {
    try {
      buffer = await toMp3(buffer);
      mimetype = 'audio/mpeg';
    } catch (error) {
      // Better to serve the original than nothing: a caller that CAN read opus
      // still gets its audio, and the failure is visible in the logs.
      logger.warn({ err: error, messageId: context.req.param('messageId') },
        error instanceof TranscodeError ? 'Voice note transcode failed, serving original' : 'Transcode error');
    }
  }
  const extension = (mimetype === 'audio/mpeg' ? 'mp3' : mimetype.split('/')[1]) || 'bin';
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

// Largest local file accepted for an outbound media send. WhatsApp itself caps
// documents around 100 MiB (and images/videos far lower), so this is the
// practical ceiling. Bytes are staged in whatsapp_media_uploads rather than in
// the command payload, so a large attachment never bloats jsonb.
const MEDIA_SEND_MAX_BYTES = Number(process.env.MEDIA_SEND_MAX_BYTES ?? 100 * 1024 * 1024);

function mediaKindFor(mimetype: string): 'image' | 'video' | 'audio' | 'sticker' | 'document' {
  if (mimetype === 'image/webp') return 'sticker';
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'document';
}

// Send a local file as an image, video, audio note, sticker, or document.
// Accepts multipart/form-data so any HTTP client or CLI can stream a real file.
app.post('/v1/accounts/:accountId/messages/media', requireAuth({ resource: 'messages', action: 'send' }), async (context) => {
  const actor = context.get('actor');
  const account = await accountFor(actor, context.req.param('accountId'));
  const form = await context.req.parseBody();
  const to = typeof form.to === 'string' ? form.to.trim() : '';
  if (!to) throw new HTTPException(400, { message: 'to is required' });
  const file = form.file;
  if (!(file instanceof File)) throw new HTTPException(400, { message: 'file is required as multipart/form-data' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) throw new HTTPException(400, { message: 'file is empty' });
  if (bytes.byteLength > MEDIA_SEND_MAX_BYTES) {
    throw new HTTPException(413, { message: `file exceeds the ${Math.floor(MEDIA_SEND_MAX_BYTES / (1024 * 1024))} MiB send limit` });
  }
  const mimetype = file.type || 'application/octet-stream';
  const kind = typeof form.kind === 'string' && form.kind ? form.kind : mediaKindFor(mimetype);
  const caption = typeof form.caption === 'string' && form.caption ? form.caption : null;

  // Stage the bytes, then reference them from the durable command by id.
  const upload = await prisma.whatsAppMediaUpload.create({
    data: {
      id: id('mup'),
      accountId: account.id,
      mimetype,
      filename: file.name || 'file',
      kind,
      caption,
      voice: form.voice === 'true',
      bytes: Buffer.from(bytes),
    },
    select: { id: true },
  });

  try {
    return await dispatchCommand(context, account, 'message.send.media', { to, upload_id: upload.id }, 120_000);
  } catch (error) {
    await prisma.whatsAppMediaUpload.deleteMany({ where: { id: upload.id } });
    throw error;
  }
});

export { app as mediaRoutes };
