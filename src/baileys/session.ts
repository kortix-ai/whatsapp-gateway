import {
  Browsers,
  BufferJSON,
  DisconnectReason,
  getContentType,
  makeWASocket,
  type Chat,
  type Contact,
  type GroupMetadata,
  type WASocket,
  type WAMessage,
} from 'baileys';
import type { Prisma } from '@prisma/client';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { id } from '../ids.js';
import { logger } from '../logger.js';
import { emitEvent } from '../services/events.js';
import { createPostgresAuthState } from './auth-state.js';
import { baileysActions, isBaileysAction } from './actions.js';
import { resetReconnectBackoff, scheduleReconnect } from '../worker/reconnect.js';

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer)) as Prisma.InputJsonValue;
}

function normalizeJid(value: string): string {
  if (value.includes('@')) return value;
  const digits = value.replace(/\D/g, '');
  if (!digits) throw new Error('A WhatsApp JID or E.164 phone number is required');
  return `${digits}@s.whatsapp.net`;
}

function unixDate(value: WAMessage['messageTimestamp']): Date {
  if (!value) return new Date();
  const seconds = typeof value === 'number' ? value : Number(value.toString());
  return new Date(seconds * 1000);
}

function messageText(message: WAMessage): string | null {
  const body = message.message;
  if (!body) return null;
  return body.conversation
    ?? body.extendedTextMessage?.text
    ?? body.imageMessage?.caption
    ?? body.videoMessage?.caption
    ?? body.documentMessage?.caption
    ?? null;
}

function disconnectCode(error: unknown): number | undefined {
  return (error as { output?: { statusCode?: number }; data?: { statusCode?: number } } | undefined)?.output?.statusCode
    ?? (error as { data?: { statusCode?: number } } | undefined)?.data?.statusCode;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Baileys command timed out after ${timeoutMs / 1_000} seconds`)), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class BaileysSession {
  private socket: WASocket | null = null;
  private stopped = false;
  private commandTimer: NodeJS.Timeout | null = null;
  private commandInFlight = false;
  private pairingTimer: NodeJS.Timeout | null = null;
  private pairingTransportReady = false;
  private stableConnectionTimer: NodeJS.Timeout | null = null;
  private readonly log;

  constructor(
    readonly accountId: string,
    private readonly onClosed: (accountId: string) => void,
  ) {
    this.log = logger.child({ accountId });
  }

  async start() {
    const authState = await createPostgresAuthState(this.accountId);
    const account = await prisma.whatsAppAccount.findUniqueOrThrow({
      where: { id: this.accountId },
      select: { pairingMode: true, pairingExpiresAt: true },
    });
    if (!authState.state.creds.registered && account.pairingExpiresAt) {
      const remainingMs = account.pairingExpiresAt.getTime() - Date.now();
      if (remainingMs <= 0) {
        await this.expirePairing(authState.clear);
        return;
      }
      this.pairingTimer = setTimeout(() => void this.expirePairing(authState.clear), remainingMs);
      this.pairingTimer.unref();
    }
    this.socket = makeWASocket({
      auth: authState.state,
      logger: this.log as never,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: true,
      generateHighQualityLinkPreview: false,
    });

    await prisma.whatsAppAccount.update({
      where: { id: this.accountId },
      data: { status: 'connecting', nextConnectAt: null, lastConnectAttemptAt: new Date() },
    });

    this.socket.ev.on('creds.update', async () => {
      await authState.saveCreds();
    });

    this.socket.ev.on('connection.update', async (update) => {
      if (update.connection === 'connecting' || update.qr) this.pairingTransportReady = true;
      if (update.qr) {
        if (account.pairingMode === 'qr') {
          const dataUrl = await QRCode.toDataURL(update.qr, { margin: 4, width: 384, errorCorrectionLevel: 'M' });
          await prisma.whatsAppAccount.update({
            where: { id: this.accountId },
            data: { status: 'pairing', pairingQr: dataUrl, pairingQrRaw: update.qr, pairingCode: null },
          });
          await emitEvent(this.accountId, 'pairing.qr.updated', { expires_at: account.pairingExpiresAt?.toISOString() ?? null });
        }
      }
      if (update.connection === 'open') {
        if (this.pairingTimer) clearTimeout(this.pairingTimer);
        this.pairingTimer = null;
        const me = authState.state.creds.me;
        await prisma.whatsAppAccount.update({
          where: { id: this.accountId },
          data: {
            status: 'connected',
            whatsappJid: me?.id ?? null,
            phoneNumber: me?.id?.split(':')[0]?.split('@')[0] ?? null,
            pairingMode: null,
            pairingQr: null,
            pairingQrRaw: null,
            pairingCode: null,
            pairingExpiresAt: null,
            lastConnectedAt: new Date(),
            nextConnectAt: null,
            lastError: null,
          },
        });
        this.stableConnectionTimer = setTimeout(
          () => void resetReconnectBackoff(this.accountId).catch((error) => this.log.error({ error }, 'Failed to reset reconnect backoff')),
          config.RECONNECT_STABLE_SECONDS * 1_000,
        );
        this.stableConnectionTimer.unref();
        await emitEvent(this.accountId, 'connection.opened', { jid: me?.id, name: me?.name });
        void this.syncAllGroups();
      }
      if (update.connection === 'close' && !this.stopped) {
        const code = disconnectCode(update.lastDisconnect?.error);
        const loggedOut = code === DisconnectReason.loggedOut;
        if (loggedOut) await authState.clear();
        const message = update.lastDisconnect?.error?.message ?? `Connection closed (${code ?? 'unknown'})`;
        if (loggedOut) {
          await prisma.whatsAppAccount.update({
            where: { id: this.accountId },
            data: {
              status: 'disconnected', reconnectAttempt: 0, nextConnectAt: null, lastError: message,
              pairingMode: null, pairingQr: null, pairingQrRaw: null, pairingCode: null, pairingExpiresAt: null,
            },
          });
        } else {
          const retry = await scheduleReconnect(this.accountId, message);
          this.log.warn({ ...retry }, 'Scheduled WhatsApp reconnect');
        }
        await emitEvent(this.accountId, 'connection.closed', { code, logged_out: loggedOut });
        await this.stop(false);
      }
    });

    this.socket.ev.on('messaging-history.set', async ({ chats, contacts, messages }) => {
      await this.upsertChats(chats);
      await this.upsertContacts(contacts);
      for (const message of messages) await this.persistMessage(message, false);
      await emitEvent(this.accountId, 'history.synced', {
        chats: chats.length,
        contacts: contacts.length,
        messages: messages.length,
      });
    });
    this.socket.ev.on('chats.upsert', (chats) => void this.upsertChats(chats));
    this.socket.ev.on('chats.update', async (chats) => {
      for (const chat of chats) {
        if (!chat.id) continue;
        await prisma.whatsAppChat.updateMany({
          where: { accountId: this.accountId, jid: chat.id },
          data: {
            ...(chat.name !== undefined ? { name: chat.name } : {}),
            ...(chat.unreadCount != null ? { unreadCount: chat.unreadCount } : {}),
            ...(chat.archived != null ? { archived: chat.archived } : {}),
            metadata: json(chat),
          },
        });
      }
      await emitEvent(this.accountId, 'chat.updated', json(chats));
    });
    this.socket.ev.on('chats.delete', async (jids) => {
      await prisma.whatsAppChat.deleteMany({ where: { accountId: this.accountId, jid: { in: jids } } });
      await emitEvent(this.accountId, 'chat.deleted', { jids });
    });
    this.socket.ev.on('chats.lock', (change) => void emitEvent(this.accountId, 'chat.locked', json(change)));
    this.socket.ev.on('contacts.upsert', (contacts) => void this.upsertContacts(contacts));
    this.socket.ev.on('contacts.update', async (contacts) => {
      for (const contact of contacts) {
        if (!contact.id) continue;
        await prisma.whatsAppContact.updateMany({
          where: { accountId: this.accountId, jid: contact.id },
          data: {
            ...(contact.name !== undefined ? { name: contact.name } : {}),
            ...(contact.notify !== undefined ? { notify: contact.notify } : {}),
            metadata: json(contact),
          },
        });
      }
      await emitEvent(this.accountId, 'contact.updated', json(contacts));
    });
    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const message of messages) await this.persistMessage(message, type === 'notify');
    });
    this.socket.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        if (!update.key.id) continue;
        await prisma.whatsAppMessage.updateMany({
          where: { accountId: this.accountId, whatsappMessageId: update.key.id },
          data: {
            ...(update.update.status === undefined || update.update.status === null ? {} : { status: String(update.update.status) }),
          },
        });
      }
      await emitEvent(this.accountId, 'message.updated', json(updates));
    });
    this.socket.ev.on('messages.delete', async (deletion) => {
      if ('all' in deletion) {
        await prisma.whatsAppMessage.updateMany({ where: { accountId: this.accountId, chatJid: deletion.jid }, data: { status: 'deleted' } });
      } else {
        const ids = deletion.keys.map((key) => key.id).filter((value): value is string => Boolean(value));
        await prisma.whatsAppMessage.updateMany({ where: { accountId: this.accountId, whatsappMessageId: { in: ids } }, data: { status: 'deleted' } });
      }
      await emitEvent(this.accountId, 'message.deleted', json(deletion));
    });
    this.socket.ev.on('messages.media-update', (updates) => void emitEvent(this.accountId, 'message.media.updated', json(updates)));
    this.socket.ev.on('messages.reaction', (updates) => void emitEvent(this.accountId, 'message.reaction.updated', json(updates)));
    this.socket.ev.on('message-receipt.update', (updates) => void emitEvent(this.accountId, 'message.receipt.updated', json(updates)));
    this.socket.ev.on('groups.upsert', async (groups) => {
      for (const group of groups) await this.upsertGroup(group);
    });
    this.socket.ev.on('groups.update', async (groups) => {
      for (const group of groups) {
        if (!group.id) continue;
        const existing = await prisma.whatsAppGroup.findUnique({
          where: { accountId_jid: { accountId: this.accountId, jid: group.id } },
        });
        await prisma.whatsAppGroup.upsert({
          where: { accountId_jid: { accountId: this.accountId, jid: group.id } },
          create: {
            accountId: this.accountId,
            jid: group.id,
            subject: group.subject ?? group.id,
            ownerJid: group.owner ?? null,
            participants: json(group.participants ?? []),
            metadata: json(group),
          },
          update: {
            subject: group.subject ?? existing?.subject ?? group.id,
            ownerJid: group.owner ?? existing?.ownerJid ?? null,
            ...(group.participants ? { participants: json(group.participants) } : {}),
            metadata: json(group),
          },
        });
        await emitEvent(this.accountId, 'group.updated', json(group));
      }
    });
    this.socket.ev.on('group-participants.update', async (change) => {
      if (this.socket) {
        const metadata = await this.socket.groupMetadata(change.id);
        await this.upsertGroup(metadata);
      }
      await emitEvent(this.accountId, 'group.participants.updated', json(change));
    });
    this.socket.ev.on('group.join-request', (change) => void emitEvent(this.accountId, 'group.join_request.updated', json(change)));
    this.socket.ev.on('group.member-tag.update', (change) => void emitEvent(this.accountId, 'group.member_tag.updated', json(change)));
    this.socket.ev.on('call', async (calls) => {
      await emitEvent(this.accountId, 'call.updated', json(calls));
    });
    this.socket.ev.on('messaging-history.status', (status) => void emitEvent(this.accountId, 'history.status.updated', json(status)));
    this.socket.ev.on('lid-mapping.update', (mapping) => void emitEvent(this.accountId, 'lid_mapping.updated', json(mapping)));
    this.socket.ev.on('presence.update', (presence) => void emitEvent(this.accountId, 'presence.updated', json(presence)));
    this.socket.ev.on('blocklist.set', (blocklist) => void emitEvent(this.accountId, 'blocklist.set', json(blocklist)));
    this.socket.ev.on('blocklist.update', (blocklist) => void emitEvent(this.accountId, 'blocklist.updated', json(blocklist)));
    this.socket.ev.on('labels.edit', (label) => void emitEvent(this.accountId, 'label.updated', json(label)));
    this.socket.ev.on('labels.association', (association) => void emitEvent(this.accountId, 'label.association.updated', json(association)));
    this.socket.ev.on('newsletter.reaction', (reaction) => void emitEvent(this.accountId, 'newsletter.reaction.updated', json(reaction)));
    this.socket.ev.on('newsletter.view', (view) => void emitEvent(this.accountId, 'newsletter.view.updated', json(view)));
    this.socket.ev.on('newsletter-participants.update', (update) => void emitEvent(this.accountId, 'newsletter.participants.updated', json(update)));
    this.socket.ev.on('newsletter-settings.update', (update) => void emitEvent(this.accountId, 'newsletter.settings.updated', json(update)));
    this.socket.ev.on('message-capping.update', (update) => void emitEvent(this.accountId, 'message.capping.updated', json(update)));
    this.socket.ev.on('settings.update', (update) => void emitEvent(this.accountId, 'settings.updated', json(update)));

    this.commandTimer = setInterval(() => void this.processNextCommand(), 250);
    this.commandTimer.unref();
  }

  async stop(notify = true) {
    if (this.stopped) return;
    this.stopped = true;
    if (this.commandTimer) clearInterval(this.commandTimer);
    if (this.pairingTimer) clearTimeout(this.pairingTimer);
    if (this.stableConnectionTimer) clearTimeout(this.stableConnectionTimer);
    this.socket?.ws.close();
    this.socket = null;
    if (notify) this.onClosed(this.accountId);
    else queueMicrotask(() => this.onClosed(this.accountId));
  }

  private async expirePairing(clearAuth: () => Promise<void>) {
    if (this.stopped) return;
    await clearAuth();
    await prisma.whatsAppAccount.updateMany({
      where: { id: this.accountId, status: { not: 'connected' } },
      data: {
        status: 'disconnected', pairingMode: null, pairingQr: null, pairingQrRaw: null, pairingCode: null,
        pairingExpiresAt: null, reconnectAttempt: 0, nextConnectAt: null,
        lastError: 'Pairing expired; start pairing again',
      },
    });
    await emitEvent(this.accountId, 'pairing.expired', {});
    await this.stop();
  }

  private async upsertChats(chats: Chat[]) {
    for (const chat of chats) {
      if (!chat.id) continue;
      await prisma.whatsAppChat.upsert({
        where: { accountId_jid: { accountId: this.accountId, jid: chat.id } },
        create: {
          accountId: this.accountId,
          jid: chat.id,
          name: chat.name ?? null,
          unreadCount: chat.unreadCount ?? 0,
          archived: chat.archived ?? false,
          metadata: json(chat),
        },
        update: {
          ...(chat.name !== undefined ? { name: chat.name } : {}),
          ...(chat.unreadCount != null ? { unreadCount: chat.unreadCount } : {}),
          ...(chat.archived != null ? { archived: chat.archived } : {}),
          metadata: json(chat),
        },
      });
    }
    if (chats.length) await emitEvent(this.accountId, 'chat.updated', { count: chats.length });
  }

  private async upsertContacts(contacts: Contact[]) {
    for (const contact of contacts) {
      await prisma.whatsAppContact.upsert({
        where: { accountId_jid: { accountId: this.accountId, jid: contact.id } },
        create: {
          accountId: this.accountId,
          jid: contact.id,
          name: contact.name ?? null,
          notify: contact.notify ?? null,
          phoneNumber: contact.id.split('@')[0] ?? null,
          metadata: json(contact),
        },
        update: {
          ...(contact.name !== undefined ? { name: contact.name } : {}),
          ...(contact.notify !== undefined ? { notify: contact.notify } : {}),
          metadata: json(contact),
        },
      });
    }
    if (contacts.length) await emitEvent(this.accountId, 'contact.updated', { count: contacts.length });
  }

  /**
   * WhatsApp only emits groups.upsert for groups with recent activity, so on a
   * fresh connection most groups never arrive. Fetch every participating group
   * once so the persisted group list is complete.
   */
  private async syncAllGroups() {
    const socket = this.socket;
    if (!socket) return;
    try {
      const groups = await socket.groupFetchAllParticipating();
      const list = Object.values(groups);
      for (const group of list) await this.upsertGroup(group);
      logger.info({ accountId: this.accountId, count: list.length }, 'Synced participating groups');
    } catch (error) {
      logger.warn({ err: error, accountId: this.accountId }, 'Failed to sync participating groups');
    }
  }

  private async upsertGroup(group: GroupMetadata) {
    await prisma.whatsAppGroup.upsert({
      where: { accountId_jid: { accountId: this.accountId, jid: group.id } },
      create: {
        accountId: this.accountId,
        jid: group.id,
        subject: group.subject,
        ownerJid: group.owner ?? null,
        participants: json(group.participants),
        metadata: json(group),
      },
      update: {
        subject: group.subject,
        ownerJid: group.owner ?? null,
        participants: json(group.participants),
        metadata: json(group),
      },
    });
    await emitEvent(this.accountId, 'group.updated', { jid: group.id, subject: group.subject });
  }

  private async persistMessage(message: WAMessage, emit: boolean) {
    const chatJid = message.key.remoteJid;
    if (!chatJid || !message.key.id) return;
    const stored = await prisma.whatsAppMessage.upsert({
      where: { accountId_whatsappMessageId: { accountId: this.accountId, whatsappMessageId: message.key.id } },
      create: {
        id: id('msg'),
        accountId: this.accountId,
        whatsappMessageId: message.key.id,
        chatJid,
        senderJid: message.key.participant ?? (message.key.fromMe ? null : chatJid),
        direction: message.key.fromMe ? 'outbound' : 'inbound',
        messageType: getContentType(message.message ?? undefined) ?? 'unknown',
        text: messageText(message),
        payload: json(message),
        status: 'received',
        messageTimestamp: unixDate(message.messageTimestamp),
      },
      update: { payload: json(message), text: messageText(message) },
    });
    if (emit) {
      await emitEvent(this.accountId, 'message.created', {
        id: stored.id,
        whatsapp_message_id: stored.whatsappMessageId,
        chat_jid: stored.chatJid,
        sender_jid: stored.senderJid,
        direction: stored.direction,
        type: stored.messageType,
        text: stored.text,
        timestamp: stored.messageTimestamp.toISOString(),
      });
    }
  }

  private async processNextCommand() {
    if (!this.socket || this.stopped || this.commandInFlight) return;
    this.commandInFlight = true;
    try {
      await prisma.outboundCommand.updateMany({
        where: {
          accountId: this.accountId,
          status: 'processing',
          OR: [{ claimedBy: { not: config.workerId } }, { claimedBy: null }],
        },
        data: { status: 'pending', claimedAt: null, claimedBy: null, availableAt: new Date() },
      });
      const command = await prisma.outboundCommand.findFirst({
        where: { accountId: this.accountId, status: 'pending', availableAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
      });
      if (!command) return;
      if (command.type === 'pair.code' && !this.pairingTransportReady) return;
      const claimed = await prisma.outboundCommand.updateMany({
        where: { id: command.id, status: 'pending' },
        data: { status: 'processing', claimedBy: config.workerId, claimedAt: new Date(), attemptCount: { increment: 1 } },
      });
      if (!claimed.count) return;
      try {
        const result = await withTimeout(
          this.executeCommand(command.type, command.payload as Record<string, unknown>),
          110_000,
        );
        await prisma.outboundCommand.update({
          where: { id: command.id },
          data: { status: 'completed', result: json(result), completedAt: new Date(), error: null },
        });
        await emitEvent(this.accountId, 'command.completed', { command_id: command.id, type: command.type });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.outboundCommand.update({
          where: { id: command.id },
          data: { status: 'failed', error: message, completedAt: new Date() },
        });
        await emitEvent(this.accountId, 'command.failed', { command_id: command.id, type: command.type, error: message });
      }
    } finally {
      this.commandInFlight = false;
    }
  }

  private async executeCommand(type: string, payload: Record<string, unknown>): Promise<unknown> {
    const socket = this.socket;
    if (!socket) throw new Error('WhatsApp session is unavailable');
    switch (type) {
      case 'pair.code': {
        const phoneNumber = String(payload.phone_number ?? '').replace(/\D/g, '');
        if (!phoneNumber) throw new Error('phone_number is required');
        const code = await socket.requestPairingCode(phoneNumber);
        await prisma.whatsAppAccount.update({
          where: { id: this.accountId },
          data: { phoneNumber, status: 'pairing', pairingMode: 'code', pairingCode: code, pairingQr: null, pairingQrRaw: null },
        });
        const pairing = await prisma.whatsAppAccount.findUnique({ where: { id: this.accountId }, select: { pairingExpiresAt: true } });
        await emitEvent(this.accountId, 'pairing.code.created', { expires_at: pairing?.pairingExpiresAt?.toISOString() ?? null });
        return { code };
      }
      case 'message.send': {
        const jid = normalizeJid(String(payload.to ?? ''));
        const content = payload.content
          ? payload.content as Parameters<WASocket['sendMessage']>[1]
          : { text: String(payload.text ?? '') };
        const sent = await socket.sendMessage(jid, content);
        if (sent) await this.persistMessage(sent, false);
        return { jid, message_id: sent?.key.id ?? null };
      }
      case 'message.send.media': {
        const jid = normalizeJid(String(payload.to ?? ''));
        const uploadId = String(payload.upload_id ?? '');
        if (!uploadId) throw new Error('upload_id is required');
        const upload = await prisma.whatsAppMediaUpload.findFirst({
          where: { id: uploadId, accountId: this.accountId },
        });
        if (!upload) throw new Error('Staged media upload was not found (it may already have been sent)');
        const buffer = Buffer.from(upload.bytes);
        const mimetype = upload.mimetype;
        const caption = upload.caption ?? undefined;
        const fileName = upload.filename || 'file';
        const kind = upload.kind;
        const content =
          kind === 'image' ? { image: buffer, mimetype, ...(caption ? { caption } : {}) }
          : kind === 'video' ? { video: buffer, mimetype, ...(caption ? { caption } : {}) }
          : kind === 'audio' ? { audio: buffer, mimetype, ptt: upload.voice }
          : kind === 'sticker' ? { sticker: buffer }
          : { document: buffer, mimetype, fileName, ...(caption ? { caption } : {}) };
        try {
          const sent = await socket.sendMessage(jid, content as Parameters<WASocket['sendMessage']>[1]);
          if (sent) await this.persistMessage(sent, false);
          return { jid, message_id: sent?.key.id ?? null, kind, bytes: buffer.length };
        } finally {
          // The staged bytes are single-use; drop them either way.
          await prisma.whatsAppMediaUpload.deleteMany({ where: { id: upload.id } });
        }
      }
      case 'group.create': {
        const subject = String(payload.subject ?? '');
        const participants = Array.isArray(payload.participants)
          ? payload.participants.map((participant) => normalizeJid(String(participant)))
          : [];
        if (!subject || participants.length === 0) throw new Error('subject and participants are required');
        const group = await socket.groupCreate(subject, participants);
        await this.upsertGroup(group);
        return { jid: group.id, subject: group.subject, participants: group.participants };
      }
      case 'group.update': {
        const groupJid = normalizeJid(String(payload.group_id ?? ''));
        if (payload.subject) await socket.groupUpdateSubject(groupJid, String(payload.subject));
        if (payload.description !== undefined) await socket.groupUpdateDescription(groupJid, String(payload.description));
        const group = await socket.groupMetadata(groupJid);
        await this.upsertGroup(group);
        return { jid: group.id, subject: group.subject };
      }
      case 'group.participants': {
        const groupJid = normalizeJid(String(payload.group_id ?? ''));
        const participants = Array.isArray(payload.participants)
          ? payload.participants.map((participant) => normalizeJid(String(participant)))
          : [];
        const action = String(payload.action ?? 'add') as 'add' | 'remove' | 'promote' | 'demote';
        return json(await socket.groupParticipantsUpdate(groupJid, participants, action));
      }
      case 'account.logout':
        await socket.logout();
        return { disconnected: true };
      case 'socket.action': {
        const action = String(payload.action ?? '');
        if (!isBaileysAction(action)) throw new Error(`Unsupported Baileys action: ${action}`);
        const args = Array.isArray(payload.args) ? payload.args : [];
        const methodName = baileysActions[action].method;
        const method = Reflect.get(socket, methodName) as ((...input: unknown[]) => unknown) | undefined;
        if (typeof method !== 'function') throw new Error(`Baileys socket method is unavailable: ${methodName}`);
        const output = await method.apply(socket, args);
        return output === undefined ? { ok: true } : json(output);
      }
      default:
        throw new Error(`Unsupported command type: ${type}`);
    }
  }
}
