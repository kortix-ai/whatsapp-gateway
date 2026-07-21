import {
  BarChart3,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Images,
  LayoutList,
  MapPin,
  Mic,
  Phone,
  Radio,
  ShoppingBag,
  Smile,
  Sticker,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { humanizeEventType } from '@/lib/format';
import type { Message } from '@/lib/types';
import { cn } from '@/lib/utils';

const INLINE_TYPES = new Set(['imageMessage', 'stickerMessage', 'videoMessage', 'audioMessage']);
const DOWNLOADABLE = new Set([
  'imageMessage', 'stickerMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'documentWithCaptionMessage',
]);

type Rec = Record<string, unknown>;

const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'editedMessage',
  'deviceSentMessage',
  'documentWithCaptionMessage',
];

/** Peel WhatsApp envelope wrappers to reach the real content node. */
function contentNode(message: Message): Rec | null {
  const payload = message.payload as Rec | undefined;
  let body = (payload?.message as Rec | undefined) ?? undefined;
  let guard = 0;
  while (body && typeof body === 'object' && guard++ < 6) {
    const wrapper = WRAPPERS.find((key) => {
      const value = body?.[key] as Rec | undefined;
      return value && typeof value === 'object' && value.message;
    });
    if (!wrapper) break;
    body = (body[wrapper] as Rec).message as Rec;
  }
  return body ?? null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function formatDuration(seconds: unknown): string | null {
  const total = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return null;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type MessageDescriptor = {
  kind: 'text' | 'media' | 'reaction' | 'system';
  label: string;
  Icon: LucideIcon;
  caption: string | null;
  detail: string | null;
  emoji?: string | null;
};

/** Map a stored message to a friendly, typed descriptor for rendering. */
export function describeMessage(message: Message): MessageDescriptor {
  const type = message.messageType;
  const content = contentNode(message);
  const node = (content?.[type] as Rec | undefined) ?? undefined;
  const caption = asString(message.text);

  switch (type) {
    case 'conversation':
    case 'extendedTextMessage':
      return { kind: 'text', label: 'Message', Icon: ImageIcon, caption, detail: null };
    case 'imageMessage':
      return { kind: 'media', label: 'Photo', Icon: ImageIcon, caption, detail: null };
    case 'videoMessage':
      return {
        kind: 'media',
        label: node?.gifPlayback ? 'GIF' : 'Video',
        Icon: Film,
        caption,
        detail: formatDuration(node?.seconds),
      };
    case 'audioMessage':
      return {
        kind: 'media',
        label: node?.ptt ? 'Voice message' : 'Audio',
        Icon: Mic,
        caption: null,
        detail: formatDuration(node?.seconds),
      };
    case 'stickerMessage':
      return { kind: 'media', label: 'Sticker', Icon: Sticker, caption: null, detail: null };
    case 'documentMessage':
    case 'documentWithCaptionMessage':
      return {
        kind: 'media',
        label: 'Document',
        Icon: FileText,
        caption,
        detail: asString(node?.fileName) ?? asString(node?.title),
      };
    case 'locationMessage':
    case 'liveLocationMessage':
      return {
        kind: 'media',
        label: type === 'liveLocationMessage' ? 'Live location' : 'Location',
        Icon: MapPin,
        caption: null,
        detail:
          asString(node?.name) ??
          (node?.degreesLatitude != null && node?.degreesLongitude != null
            ? `${Number(node.degreesLatitude).toFixed(4)}, ${Number(node.degreesLongitude).toFixed(4)}`
            : null),
      };
    case 'contactMessage':
      return { kind: 'media', label: 'Contact', Icon: User, caption: null, detail: asString(node?.displayName) };
    case 'contactsArrayMessage': {
      const list = Array.isArray(node?.contacts) ? (node!.contacts as unknown[]).length : null;
      return { kind: 'media', label: 'Contacts', Icon: Users, caption: null, detail: list ? `${list} contacts` : null };
    }
    case 'reactionMessage':
      return { kind: 'reaction', label: 'Reaction', Icon: Smile, caption: null, detail: null, emoji: asString(node?.text) };
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3':
      return { kind: 'media', label: 'Poll', Icon: BarChart3, caption: null, detail: asString(node?.name) };
    case 'pollUpdateMessage':
      return { kind: 'system', label: 'Poll vote', Icon: BarChart3, caption: null, detail: null };
    case 'productMessage':
      return {
        kind: 'media',
        label: 'Product',
        Icon: ShoppingBag,
        caption: null,
        detail: asString((node?.product as Rec | undefined)?.title),
      };
    case 'listMessage':
    case 'buttonsMessage':
    case 'templateMessage':
    case 'interactiveMessage':
    case 'listResponseMessage':
    case 'buttonsResponseMessage':
    case 'templateButtonReplyMessage':
    case 'interactiveResponseMessage':
      return { kind: 'media', label: 'Interactive message', Icon: LayoutList, caption, detail: null };
    case 'associatedChildMessage':
      return { kind: 'media', label: 'Album item', Icon: Images, caption, detail: null };
    case 'call':
    case 'callLogMesssage':
      return { kind: 'system', label: 'Call', Icon: Phone, caption: null, detail: null };
    case 'protocolMessage':
      return { kind: 'system', label: 'System message', Icon: Radio, caption: null, detail: null };
    default:
      return {
        kind: caption ? 'text' : 'media',
        label: humanizeEventType(type.replace(/Message$/, '')) || 'Message',
        Icon: ImageIcon,
        caption,
        detail: null,
      };
  }
}

export function MessagePreview({ message, accountId }: { message: Message; accountId: string }) {
  const d = describeMessage(message);
  const [failed, setFailed] = useState(false);
  const type = message.messageType;
  const mediaUrl = `/v1/accounts/${accountId}/messages/${message.id}/media`;

  if (d.kind === 'text') {
    return d.caption ? (
      <p className="text-sm break-words">{d.caption}</p>
    ) : (
      <p className="text-sm text-muted-foreground italic">Empty message</p>
    );
  }

  if (d.kind === 'reaction') {
    return (
      <p className="flex items-center gap-1.5 text-sm">
        {d.emoji ? <span className="text-base leading-none">{d.emoji}</span> : <Smile className="size-4 text-muted-foreground" />}
        <span className="text-muted-foreground">Reacted to a message</span>
      </p>
    );
  }

  const Icon = d.Icon;
  const chip = (
    <p className={cn('flex items-center gap-1.5 text-sm', d.kind === 'system' && 'text-muted-foreground')}>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="font-medium">{d.label}</span>
      {d.detail && <span className="truncate text-muted-foreground">· {d.detail}</span>}
    </p>
  );

  // Render the actual attachment inline when it can be decoded in the browser.
  if (INLINE_TYPES.has(type) && !failed) {
    if (type === 'imageMessage' || type === 'stickerMessage') {
      return (
        <div className="space-y-1.5">
          <a href={mediaUrl} target="_blank" rel="noreferrer" className="inline-block">
            <img
              src={mediaUrl}
              alt={d.caption ?? d.label}
              loading="lazy"
              onError={() => setFailed(true)}
              className={cn('rounded-lg border object-cover', type === 'stickerMessage' ? 'max-h-28' : 'max-h-72 max-w-full')}
            />
          </a>
          {d.caption && <p className="text-sm break-words">{d.caption}</p>}
        </div>
      );
    }
    if (type === 'videoMessage') {
      return (
        <div className="space-y-1.5">
          {chip}
          <video
            src={mediaUrl}
            controls
            preload="none"
            onError={() => setFailed(true)}
            className="max-h-72 max-w-full rounded-lg border"
          />
          {d.caption && <p className="text-sm break-words text-muted-foreground">{d.caption}</p>}
        </div>
      );
    }
    // audioMessage
    return (
      <div className="space-y-1.5">
        {chip}
        <audio src={mediaUrl} controls preload="none" onError={() => setFailed(true)} className="h-9 w-full max-w-xs" />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-1">
      {chip}
      {d.caption && <p className="text-sm break-words text-muted-foreground">{d.caption}</p>}
      {DOWNLOADABLE.has(type) && (
        <a
          href={`${mediaUrl}?download=1`}
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline"
        >
          <Download className="size-3" /> Download
        </a>
      )}
    </div>
  );
}
