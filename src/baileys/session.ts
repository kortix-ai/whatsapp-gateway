import {
  Browsers,
  BufferJSON,
  DisconnectReason,
  getContentType,
  makeWASocket,
  type BaileysEventMap,
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
import { passthroughEvents } from '../services/event-types.js';
import { createPostgresAuthState } from './auth-state.js';
import { createProxyAgent, installGlobalProxyDispatcher, redactProxy } from './proxy.js';
import { resolveWaVersion } from './wa-version.js';
import { baileysActions, isBaileysAction } from './actions.js';
import { resetReconnectBackoff, scheduleReconnect } from '../worker/reconnect.js';

const COMMAND_TIMEOUT_MS = 110_000;
// Stale-claim recovery must exceed the execution timeout so a live executor can never have its claim stolen.
const COMMAND_STALE_MS = 120_000;
const MAX_COMMAND_ATTEMPTS = 5;

type PostgresAuthState = Awaited<ReturnType<typeof createPostgresAuthState>>;
type PairingAccount = { pairingMode: string | null; pairingExpiresAt: Date | null };

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer)) as Prisma.InputJsonValue;
}

function normalizeJid(value: string): string {
  if (value.includes('@')) return value;
  const digits = value.replace(/\D/g, '');
  if (!digits) throw new Error('A WhatsApp JID or E.164 phone number is required');
  return `${digits}@s.whatsapp.net`;
}

/** WhatsApp group JIDs end in `@g.us`; everything else is a 1:1 chat. */
export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/** Drop Baileys' device suffix: `1234:5@s.whatsapp.net` → `1234@s.whatsapp.net`. */
export function bareJid(jid: string): string {
  const [user = '', domain = ''] = jid.split('@');
  return `${user.split(':')[0]}@${domain}`;
}

/**
 * JIDs @-mentioned in a message. Baileys hangs `contextInfo` off whichever
 * content variant the message happens to be, so scan them rather than
 * enumerating every type.
 */
export function mentionedJids(message: WAMessage): string[] {
  for (const content of Object.values(message.message ?? {})) {
    const mentioned = (content as { contextInfo?: { mentionedJid?: string[] | null } } | null)
      ?.contextInfo?.mentionedJid;
    if (mentioned?.length) return mentioned;
  }
  return [];
}

function unixDate(value: WAMessage['messageTimestamp']): Date {
  if (!value) return new Date();
  const seconds = typeof value === 'number' ? value : Number(value.toString());
  return new Date(seconds * 1000);
}

function chatPatch(chat: { name?: string | null; unreadCount?: number | null; archived?: boolean | null }) {
  return {
    ...(chat.name !== undefined ? { name: chat.name } : {}),
    ...(chat.unreadCount != null ? { unreadCount: chat.unreadCount } : {}),
    ...(chat.archived != null ? { archived: chat.archived } : {}),
    metadata: json(chat),
  };
}

function contactPatch(contact: { name?: string | null; notify?: string | null }) {
  return {
    ...(contact.name !== undefined ? { name: contact.name } : {}),
    ...(contact.notify !== undefined ? { notify: contact.notify } : {}),
    metadata: json(contact),
  };
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

/**
 * Baileys attaches the stream:error reason node as Boom data, e.g.
 * { tag: 'conflict', attrs: { type: 'device_removed' } }.
 */
function disconnectReason(error: unknown): string | null {
  const data = (error as { data?: { tag?: string; attrs?: Record<string, string> } } | undefined)?.data;
  if (!data?.tag) return null;
  return data.attrs?.type ? `${data.tag}:${data.attrs.type}` : data.tag;
}

function disconnectMessage(error: Error | undefined, code: number | undefined, reason: string | null): string {
  if (reason === 'conflict:device_removed') {
    return 'WhatsApp removed this linked device (conflict: device_removed); pair the number again';
  }
  if (reason === 'conflict:replaced' || code === DisconnectReason.connectionReplaced) {
    return 'Another client connected with this WhatsApp session (conflict: replaced); make sure only one gateway worker uses these credentials';
  }
  return error?.message ?? `Connection closed (${code ?? 'unknown'})`;
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
  private connectionOpen = false;
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
    // Baileys reaches the network three different ways, and each wants its own
    // kind of proxy object. Handing the wrong one over does not fail loudly —
    // it fails as "Media upload failed on all hosts" after every upload host is
    // tried, which reads like a WhatsApp outage rather than a config bug.
    //
    //   websocket      → `agent`, a node http.Agent
    //   media UPLOAD   → `fetchAgent`, ALSO a node http.Agent: on Node, Baileys
    //                    uploads via the https module (it sidesteps an undici
    //                    body-buffering bug), so an undici dispatcher here is
    //                    silently unusable.
    //   media DOWNLOAD → global `fetch`, which can only be proxied by
    //                    setGlobalDispatcher. Baileys does accept an
    //                    `options.dispatcher`, but Node's global fetch rejects
    //                    any dispatcher from the userland undici package
    //                    (UND_ERR_INVALID_ARG → a bare "fetch failed"), so that
    //                    route is a dead end. See installGlobalProxyDispatcher.
    const proxyAgent = config.WA_PROXY_URL ? createProxyAgent(config.WA_PROXY_URL) : undefined;
    // Global, not per-socket — see installGlobalProxyDispatcher for why Baileys'
    // fetch-based transfers cannot be proxied any other way.
    const proxyDispatcher = config.WA_PROXY_URL
      ? installGlobalProxyDispatcher(config.WA_PROXY_URL)
      : false;
    if (config.WA_PROXY_URL && !proxyDispatcher) {
      // SOCKS has no undici dispatcher, so fetch-based transfers would exit from
      // the datacenter IP while the socket exits residential. Say so out loud.
      this.log.warn('WA_PROXY_URL is SOCKS: media downloads bypass the proxy; use an http(s) proxy to route them');
    }
    if (config.WA_PROXY_URL) this.log.info({ proxy: redactProxy(config.WA_PROXY_URL) }, 'Routing WhatsApp socket through proxy');
    const browser = config.WA_BROWSER === 'windows' ? Browsers.windows('Chrome')
      : config.WA_BROWSER === 'ubuntu' ? Browsers.ubuntu('Chrome')
      : Browsers.macOS('Chrome');
    const version = await resolveWaVersion();
    this.socket = makeWASocket({
      auth: authState.state,
      logger: this.log as never,
      version,
      browser,
      markOnlineOnConnect: false,
      syncFullHistory: config.SYNC_FULL_HISTORY,
      generateHighQualityLinkPreview: false,
      ...(config.WA_COUNTRY_CODE ? { countryCode: config.WA_COUNTRY_CODE } : {}),
      ...(proxyAgent ? { agent: proxyAgent, fetchAgent: proxyAgent } : {}),
      // Serve retry receipts from the persisted message store: when a recipient
      // cannot decrypt one of our sends, Baileys re-encrypts from here — without
      // it the recipient is stuck on "waiting for this message".
      getMessage: async (key) => {
        if (!key.id) return undefined;
        const stored = await prisma.whatsAppMessage.findUnique({
          where: { accountId_whatsappMessageId: { accountId: this.accountId, whatsappMessageId: key.id } },
          select: { payload: true },
        });
        if (!stored) return undefined;
        const revived = JSON.parse(JSON.stringify(stored.payload), BufferJSON.reviver) as WAMessage;
        return revived.message ?? undefined;
      },
    });

    await prisma.whatsAppAccount.update({
      where: { id: this.accountId },
      data: { status: 'connecting', nextConnectAt: null, lastConnectAttemptAt: new Date() },
    });

    this.wireConnectionEvents(this.socket, authState, account);
    this.wireSyncEvents(this.socket);

    this.commandTimer = setInterval(() => void this.processNextCommand(), 250);
    this.commandTimer.unref();
  }

  /** Registers a handler whose rejections are logged instead of crashing the process. */
  private on<E extends keyof BaileysEventMap>(
    socket: WASocket,
    event: E,
    handler: (payload: BaileysEventMap[E]) => unknown,
    onError?: () => void,
  ) {
    socket.ev.on(event, (payload) => {
      void Promise.resolve()
        .then(() => handler(payload))
        .catch((error) => {
          this.log.error({ error, event }, 'Socket event handler failed');
          onError?.();
        });
    });
  }

  private wireConnectionEvents(socket: WASocket, authState: PostgresAuthState, account: PairingAccount) {
    this.on(socket, 'creds.update', async () => {
      if (this.pairingTimer && authState.state.creds.registered) {
        // Registered mid-window: the pairing TTL no longer applies and must not wipe fresh credentials.
        clearTimeout(this.pairingTimer);
        this.pairingTimer = null;
      }
      await authState.saveCreds();
    });

    // A failure while reacting to a connection change tears the session down so the
    // supervisor restarts it, instead of leaving a zombie socket it believes is healthy.
    this.on(socket, 'connection.update', async (update) => {
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
        this.connectionOpen = true;
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
        this.connectionOpen = false;
        const code = disconnectCode(update.lastDisconnect?.error);
        const reason = disconnectReason(update.lastDisconnect?.error);
        const loggedOut = code === DisconnectReason.loggedOut;
        if (loggedOut) await authState.clear();
        const message = disconnectMessage(update.lastDisconnect?.error, code, reason);
        if (loggedOut) {
          await prisma.whatsAppAccount.update({
            where: { id: this.accountId },
            data: {
              status: 'disconnected', reconnectAttempt: 0, nextConnectAt: null, lastError: message,
              pairingMode: null, pairingQr: null, pairingQrRaw: null, pairingCode: null, pairingExpiresAt: null,
            },
          });
        } else {
          const retry = await scheduleReconnect(this.accountId, message, {
            immediate: code === DisconnectReason.restartRequired,
          });
          this.log.warn({ ...retry }, 'Scheduled WhatsApp reconnect');
        }
        await emitEvent(this.accountId, 'connection.closed', { code, logged_out: loggedOut, reason, message });
        await this.stop(false);
      }
    }, () => void this.stop(false));
  }

  private wireSyncEvents(socket: WASocket) {
    this.on(socket, 'messaging-history.set', async ({ chats, contacts, messages }) => {
      await this.upsertChats(chats);
      await this.upsertContacts(contacts);
      for (const message of messages) await this.persistMessage(message, false);
      await emitEvent(this.accountId, 'history.synced', {
        chats: chats.length,
        contacts: contacts.length,
        messages: messages.length,
      });
    });
    this.on(socket, 'chats.upsert', (chats) => this.upsertChats(chats));
    this.on(socket, 'chats.update', async (chats) => {
      for (const chat of chats) {
        if (!chat.id) continue;
        await prisma.whatsAppChat.updateMany({
          where: { accountId: this.accountId, jid: chat.id },
          data: chatPatch(chat),
        });
      }
      await emitEvent(this.accountId, 'chat.updated', json(chats));
    });
    this.on(socket, 'chats.delete', async (jids) => {
      await prisma.whatsAppChat.deleteMany({ where: { accountId: this.accountId, jid: { in: jids } } });
      await emitEvent(this.accountId, 'chat.deleted', { jids });
    });
    this.on(socket, 'contacts.upsert', (contacts) => this.upsertContacts(contacts));
    this.on(socket, 'contacts.update', async (contacts) => {
      for (const contact of contacts) {
        if (!contact.id) continue;
        await prisma.whatsAppContact.updateMany({
          where: { accountId: this.accountId, jid: contact.id },
          data: contactPatch(contact),
        });
      }
      await emitEvent(this.accountId, 'contact.updated', json(contacts));
    });
    this.on(socket, 'messages.upsert', async ({ messages, type }) => {
      for (const message of messages) await this.persistMessage(message, type === 'notify');
    });
    this.on(socket, 'messages.update', async (updates) => {
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
    this.on(socket, 'messages.delete', async (deletion) => {
      if ('all' in deletion) {
        await prisma.whatsAppMessage.updateMany({ where: { accountId: this.accountId, chatJid: deletion.jid }, data: { status: 'deleted' } });
      } else {
        const ids = deletion.keys.map((key) => key.id).filter((value): value is string => Boolean(value));
        await prisma.whatsAppMessage.updateMany({ where: { accountId: this.accountId, whatsappMessageId: { in: ids } }, data: { status: 'deleted' } });
      }
      await emitEvent(this.accountId, 'message.deleted', json(deletion));
    });
    this.on(socket, 'groups.upsert', async (groups) => {
      for (const group of groups) await this.upsertGroup(group);
    });
    this.on(socket, 'groups.update', async (groups) => {
      for (const group of groups) {
        if (!group.id) continue;
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
            ...(group.subject != null ? { subject: group.subject } : {}),
            ...(group.owner != null ? { ownerJid: group.owner } : {}),
            ...(group.participants ? { participants: json(group.participants) } : {}),
            metadata: json(group),
          },
        });
        await emitEvent(this.accountId, 'group.updated', json(group));
      }
    });
    this.on(socket, 'group-participants.update', async (change) => {
      const metadata = await socket.groupMetadata(change.id);
      await this.upsertGroup(metadata);
      await emitEvent(this.accountId, 'group.participants.updated', json(change));
    });

    for (const event of Object.keys(passthroughEvents) as (keyof typeof passthroughEvents)[]) {
      this.on(socket, event, (payload) => emitEvent(this.accountId, passthroughEvents[event], json(payload)));
    }
  }

  async stop(notify = true) {
    if (this.stopped) return;
    this.stopped = true;
    this.connectionOpen = false;
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
        update: chatPatch(chat),
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
        update: contactPatch(contact),
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
      const surface = isGroupJid(stored.chatJid) ? 'group.' : '';
      const action = stored.direction === 'inbound' ? 'received' : 'sent';
      // Whether this message addresses US. A group can be busy, and "only wake
      // the agent when spoken to" is the difference between a useful bot and an
      // expensive one — so it has to be answerable from the payload, without a
      // turn spent deciding to stay silent.
      const me = this.socket?.user?.id ? bareJid(this.socket.user.id) : null;
      const mentionedMe = !!me && mentionedJids(message).some((jid) => bareJid(jid) === me);
      await emitEvent(this.accountId, `${surface}message.${action}`, {
        id: stored.id,
        whatsapp_message_id: stored.whatsappMessageId,
        chat_jid: stored.chatJid,
        sender_jid: stored.senderJid,
        direction: stored.direction,
        type: stored.messageType,
        text: stored.text,
        mentioned_me: mentionedMe,
        timestamp: stored.messageTimestamp.toISOString(),
      });
    }
  }

  private async processNextCommand() {
    if (!this.socket || this.stopped || this.commandInFlight) return;
    this.commandInFlight = true;
    try {
      // Reclaim only provably-dead claims: COMMAND_STALE_MS exceeds the execution
      // timeout, so a live executor can never have its claim stolen mid-flight.
      await prisma.outboundCommand.updateMany({
        where: {
          accountId: this.accountId,
          status: 'processing',
          OR: [{ claimedBy: { not: config.workerId } }, { claimedBy: null }],
          claimedAt: { lt: new Date(Date.now() - COMMAND_STALE_MS) },
        },
        data: { status: 'pending', claimedAt: null, claimedBy: null, availableAt: new Date() },
      });
      const exhausted = await prisma.outboundCommand.findMany({
        where: { accountId: this.accountId, status: 'pending', attemptCount: { gte: MAX_COMMAND_ATTEMPTS } },
        select: { id: true, type: true, payload: true },
      });
      for (const poison of exhausted) {
        const message = `Command failed after ${MAX_COMMAND_ATTEMPTS} attempts`;
        const failed = await prisma.outboundCommand.updateMany({
          where: { id: poison.id, status: 'pending' },
          data: { status: 'failed', error: message, completedAt: new Date() },
        });
        if (failed.count === 1) {
          if (poison.type === 'message.send.media') await this.dropStagedUpload(poison.payload);
          await emitEvent(this.accountId, 'command.failed', { command_id: poison.id, type: poison.type, error: message });
        }
      }
      const command = await prisma.outboundCommand.findFirst({
        where: { accountId: this.accountId, status: 'pending', availableAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
      });
      if (!command) return;
      if (command.type === 'pair.code' ? !this.pairingTransportReady : !this.connectionOpen) return;
      const claimed = await prisma.outboundCommand.updateMany({
        where: { id: command.id, status: 'pending' },
        data: { status: 'processing', claimedBy: config.workerId, claimedAt: new Date(), attemptCount: { increment: 1 } },
      });
      if (!claimed.count) return;
      // Terminal writes are fenced on our own live claim so a worker that lost its
      // claim can neither clobber a re-claimer's state nor emit duplicate events.
      const claim = { id: command.id, status: 'processing', claimedBy: config.workerId };
      try {
        const result = await withTimeout(
          this.executeCommand(command.type, command.payload as Record<string, unknown>),
          COMMAND_TIMEOUT_MS,
        );
        const completed = await prisma.outboundCommand.updateMany({
          where: claim,
          data: { status: 'completed', result: json(result), completedAt: new Date(), error: null },
        });
        if (completed.count === 1) {
          await emitEvent(this.accountId, 'command.completed', { command_id: command.id, type: command.type });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Mirror the execution gate: pair.code runs before the connection opens,
        // so its transport is the pairing socket, not an open connection.
        const transportLost = command.type === 'pair.code' ? !this.pairingTransportReady : !this.connectionOpen;
        if (this.stopped || transportLost) {
          // The socket died mid-command; requeue so the next connection retries it.
          await prisma.outboundCommand.updateMany({
            where: claim,
            data: { status: 'pending', claimedBy: null, claimedAt: null, availableAt: new Date() },
          });
          return;
        }
        const failed = await prisma.outboundCommand.updateMany({
          where: claim,
          data: { status: 'failed', error: message, completedAt: new Date() },
        });
        if (failed.count === 1) {
          if (command.type === 'message.send.media') await this.dropStagedUpload(command.payload);
          await emitEvent(this.accountId, 'command.failed', { command_id: command.id, type: command.type, error: message });
        }
      }
    } finally {
      this.commandInFlight = false;
    }
  }

  private async dropStagedUpload(payload: unknown) {
    const uploadId = String((payload as { upload_id?: unknown } | null)?.upload_id ?? '');
    if (uploadId) await prisma.whatsAppMediaUpload.deleteMany({ where: { id: uploadId, accountId: this.accountId } });
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
        const sent = await socket.sendMessage(jid, content as Parameters<WASocket['sendMessage']>[1]);
        if (sent) await this.persistMessage(sent, false);
        // Staged bytes are dropped only on success or terminal failure, so a
        // requeued send (socket died mid-command) still has its payload.
        await prisma.whatsAppMediaUpload.deleteMany({ where: { id: upload.id } });
        return { jid, message_id: sent?.key.id ?? null, kind, bytes: buffer.length };
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
