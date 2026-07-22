/**
 * What actually arrived, in terms a consumer can act on.
 *
 * WhatsApp has ~22 message shapes in live traffic and only two of them
 * (`conversation`, `extendedTextMessage`) carry plain text. Everything else —
 * a voice note, a sticker, a contact card, a poll, a video note — used to reach
 * a webhook consumer as `text: null`, indistinguishable from someone sending
 * nothing. An agent woken that way has no idea what to respond to.
 *
 * So every message gets a `summary`: a short, always-non-empty description of
 * what came in ("voice message (0:12)", "PDF · invoice.pdf"), plus structured
 * facts for the cases where a consumer needs specifics.
 *
 * Kept out of session.ts deliberately: this is pure, it is the part most likely
 * to need extending as WhatsApp adds shapes, and it is worth unit-testing on its
 * own.
 */
import { getContentType, type WAMessage, type WAMessageContent } from 'baileys';

export interface MessageMediaFacts {
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'video_note';
  mimetype: string | null;
  file_name: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  /** A push-to-talk recording — a voice message, not an attached audio file. */
  voice_note: boolean;
  page_count: number | null;
}

export interface MessageFacts {
  /** Always non-empty. Safe to put straight into a prompt. */
  summary: string;
  /** Media worth downloading via GET /v1/accounts/{id}/messages/{id}/media. */
  media: MessageMediaFacts | null;
  location: { latitude: number; longitude: number; name: string | null; live: boolean } | null;
  contacts: { display_name: string | null }[] | null;
  poll: { question: string | null; options: string[] } | null;
  /** The message this one replies to, when it is a reply. */
  quoted: { message_id: string | null; from_me: boolean | null } | null;
  /**
   * False for protocol/system frames and for content we could not decrypt —
   * revocations, ephemeral-setting changes, placeholders. They are real events
   * but they are not somebody saying something, and waking an agent for them
   * produces a turn with nothing to answer.
   */
  user_content: boolean;
}

const EMPTY: MessageFacts = {
  summary: '',
  media: null,
  location: null,
  contacts: null,
  poll: null,
  quoted: null,
  user_content: false,
};

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  // Baileys hands back Long for 64-bit fields.
  if (value && typeof value === 'object' && 'toString' in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** `0:07`, `1:23`, `12:05` — how a duration reads in a chat app. */
function clock(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return ` (${mins}:${String(secs).padStart(2, '0')})`;
}

function bytes(size: number | null): string {
  if (size == null || size <= 0) return '';
  const mb = size / 1_000_000;
  return mb >= 1 ? ` · ${mb.toFixed(1)} MB` : ` · ${Math.max(1, Math.round(size / 1000))} KB`;
}

/** Human label for a document, preferring its filename over its mimetype. */
function documentLabel(fileName: string | null, mimetype: string | null): string {
  if (fileName) return fileName;
  if (!mimetype) return 'file';
  if (mimetype.includes('pdf')) return 'PDF';
  return mimetype.split('/')[1]?.toUpperCase() ?? 'file';
}

/** Unwrap the envelopes WhatsApp nests real content inside. */
export function unwrapContent(content: WAMessageContent | null | undefined): WAMessageContent | null {
  let current = content ?? null;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const inner =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message ??
      current.editedMessage?.message ??
      null;
    if (!inner) return current;
    current = inner;
  }
  return current;
}

export function describeMessage(message: WAMessage): MessageFacts {
  const content = unwrapContent(message.message);
  if (!content) return { ...EMPTY, summary: 'empty message' };
  const type = getContentType(content);
  if (!type) return { ...EMPTY, summary: 'unsupported message' };

  const node = (content as Record<string, any>)[type] ?? {};
  const quotedKey = node?.contextInfo?.stanzaId
    ? { message_id: str(node.contextInfo.stanzaId), from_me: null }
    : null;
  const base = { ...EMPTY, quoted: quotedKey, user_content: true };

  const caption = str(node.caption);
  const withCaption = (label: string) => (caption ? `${label} · "${caption}"` : label);

  switch (type) {
    case 'conversation':
      return { ...base, summary: str(content.conversation) ?? 'empty message' };
    case 'extendedTextMessage':
      return { ...base, summary: str(node.text) ?? 'empty message' };

    case 'imageMessage':
    case 'videoMessage':
    case 'audioMessage':
    case 'documentMessage':
    case 'stickerMessage':
    case 'lottieStickerMessage':
    case 'ptvMessage': {
      const duration = num(node.seconds);
      const voiceNote = type === 'audioMessage' && node.ptt === true;
      const kind: MessageMediaFacts['kind'] =
        type === 'imageMessage' ? 'image'
        : type === 'videoMessage' ? 'video'
        : type === 'ptvMessage' ? 'video_note'
        : type === 'audioMessage' ? 'audio'
        : type === 'documentMessage' ? 'document'
        : 'sticker';
      const fileName = str(node.fileName);
      const size = num(node.fileLength);
      const media: MessageMediaFacts = {
        kind,
        mimetype: str(node.mimetype),
        file_name: fileName,
        size_bytes: size,
        duration_seconds: duration,
        voice_note: voiceNote,
        page_count: num(node.pageCount),
      };
      const summary =
        voiceNote ? `voice message${clock(duration)}`
        : kind === 'video_note' ? `video note${clock(duration)}`
        : kind === 'audio' ? withCaption(`audio${clock(duration)}`)
        : kind === 'image' ? withCaption('photo')
        : kind === 'video' ? withCaption(`video${clock(duration)}`)
        : kind === 'sticker' ? 'sticker'
        : withCaption(`${documentLabel(fileName, str(node.mimetype))}${bytes(size)}`);
      return { ...base, summary, media };
    }

    case 'locationMessage':
    case 'liveLocationMessage': {
      const live = type === 'liveLocationMessage';
      const name = str(node.name) ?? str(node.address);
      return {
        ...base,
        summary: `${live ? 'live location' : 'location'}${name ? ` · ${name}` : ''}`,
        location: {
          latitude: num(node.degreesLatitude) ?? 0,
          longitude: num(node.degreesLongitude) ?? 0,
          name,
          live,
        },
      };
    }

    case 'contactMessage':
      return {
        ...base,
        summary: `contact card${str(node.displayName) ? ` · ${str(node.displayName)}` : ''}`,
        contacts: [{ display_name: str(node.displayName) }],
      };
    case 'contactsArrayMessage': {
      const list = Array.isArray(node.contacts) ? node.contacts : [];
      return {
        ...base,
        summary: `${list.length || 'several'} contact cards`,
        contacts: list.map((c: any) => ({ display_name: str(c?.displayName) })),
      };
    }

    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3': {
      const options = (Array.isArray(node.options) ? node.options : [])
        .map((o: any) => str(o?.optionName))
        .filter((o: string | null): o is string => !!o);
      const question = str(node.name);
      return {
        ...base,
        summary: `poll${question ? ` · "${question}"` : ''}`,
        poll: { question, options },
      };
    }
    case 'pollUpdateMessage':
      return { ...base, summary: 'poll vote' };

    case 'albumMessage':
      return { ...base, summary: `album (${num(node.expectedImageCount) ?? '?'} photos)` };
    case 'groupInviteMessage':
      return { ...base, summary: `group invite${str(node.groupName) ? ` · ${str(node.groupName)}` : ''}` };
    case 'templateMessage':
    case 'interactiveMessage':
    case 'buttonsMessage':
    case 'listMessage':
      return { ...base, summary: 'interactive message' };
    case 'templateButtonReplyMessage':
      return { ...base, summary: str(node.selectedDisplayText) ?? 'button reply' };
    case 'listResponseMessage':
      return { ...base, summary: str(node.title) ?? 'list reply' };
    case 'buttonsResponseMessage':
      return { ...base, summary: str(node.selectedDisplayText) ?? 'button reply' };
    case 'reactionMessage':
      // Routed as its own event upstream; described here for completeness.
      return { ...base, summary: `reacted ${str(node.text) ?? ''}`.trim() };

    // Not somebody saying something. Revocations, ephemeral-timer changes,
    // key distribution, and content that has not decrypted yet. Real events,
    // but nothing an agent can reply to.
    case 'protocolMessage':
      return { ...EMPTY, summary: 'system message' };
    case 'senderKeyDistributionMessage':
      return { ...EMPTY, summary: 'key exchange' };
    case 'placeholderMessage':
      return { ...EMPTY, summary: 'message pending decryption' };

    default:
      return { ...base, summary: type.replace(/Message$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() };
  }
}
