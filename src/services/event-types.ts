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
  // Message events are split along the two axes a consumer actually routes on:
  //
  //   direction — `received` vs `sent`. Subscribing to inbound only is what
  //     makes a reply loop structurally impossible: an agent's own send is
  //     never delivered back to it. This is a correctness property, so it
  //     belongs in the subscription, not in a filter a user can forget.
  //   surface   — a `group.` prefix for @g.us chats. A group is a different
  //     CONVERSATION, not a flag on a message: it wants its own prompt, its own
  //     reply etiquette, usually its own agent. Splitting the event type lets a
  //     consumer bind separate handlers without any conditional, and without
  //     this gateway having to denormalize a boolean for every routing question
  //     a downstream filter cannot express.
  //
  // `message.created` stays subscribable and matches all four (services/events.ts).
  'message.created',
  'message.received', 'message.sent',
  'group.message.received', 'group.message.sent',
  // A reaction arrives as a message whose content is `reactionMessage`. It gets
  // its own type rather than `message.received`, because a consumer that woke on
  // it would see empty text and could not tell a thumbs-up from silence. The
  // payload carries the emoji and the message it points at.
  'message.reaction.received', 'message.reaction.sent',
  'group.message.reaction.received', 'group.message.reaction.sent',
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
