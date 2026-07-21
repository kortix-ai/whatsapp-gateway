import type { BaileysEventMap } from 'baileys';

/**
 * Baileys events forwarded verbatim as gateway events. BaileysSession registers
 * every entry in one loop, and gatewayEventTypes derives from the values, so a
 * new passthrough is automatically registered, emitted, and webhook-subscribable.
 */
export const passthroughEvents = {
  'chats.lock': 'chat.locked',
  'messages.media-update': 'message.media.updated',
  'messages.reaction': 'message.reaction.updated',
  'message-receipt.update': 'message.receipt.updated',
  'group.join-request': 'group.join_request.updated',
  'group.member-tag.update': 'group.member_tag.updated',
  'call': 'call.updated',
  'messaging-history.status': 'history.status.updated',
  'lid-mapping.update': 'lid_mapping.updated',
  'presence.update': 'presence.updated',
  'blocklist.set': 'blocklist.set',
  'blocklist.update': 'blocklist.updated',
  'labels.edit': 'label.updated',
  'labels.association': 'label.association.updated',
  'newsletter.reaction': 'newsletter.reaction.updated',
  'newsletter.view': 'newsletter.view.updated',
  'newsletter-participants.update': 'newsletter.participants.updated',
  'newsletter-settings.update': 'newsletter.settings.updated',
  'message-capping.update': 'message.capping.updated',
  'settings.update': 'settings.updated',
} as const satisfies Partial<Record<keyof BaileysEventMap, string>>;

/** Gateway events the session emits itself (persistence, pairing, connection, commands). */
const syntheticEvents = [
  'pairing.qr.updated', 'pairing.code.created', 'pairing.expired',
  'connection.opened', 'connection.closed',
  // `message.received` / `message.sent` split `message.created` by direction so
  // a subscriber can take inbound only — without that, an agent replying over
  // the API would be re-triggered by its own outbound message. `message.created`
  // stays subscribable and matches both (see services/events.ts).
  'message.created', 'message.received', 'message.sent',
  'message.updated', 'message.deleted',
  'history.synced',
  'chat.updated', 'chat.deleted', 'contact.updated',
  'group.updated', 'group.participants.updated',
  'command.completed', 'command.failed',
] as const;

export type GatewayEventType =
  | typeof syntheticEvents[number]
  | (typeof passthroughEvents)[keyof typeof passthroughEvents];

export const gatewayEventTypes: readonly [GatewayEventType, ...GatewayEventType[]] = [
  ...syntheticEvents,
  ...Object.values(passthroughEvents),
];
