export const gatewayEventTypes = [
  'pairing.qr.updated', 'pairing.code.created', 'pairing.expired',
  'connection.opened', 'connection.closed',
  'message.created', 'message.updated', 'message.deleted', 'message.media.updated',
  'message.reaction.updated', 'message.receipt.updated', 'message.capping.updated',
  'history.synced', 'history.status.updated',
  'chat.updated', 'chat.deleted', 'chat.locked', 'contact.updated', 'presence.updated', 'lid_mapping.updated',
  'group.updated', 'group.participants.updated', 'group.join_request.updated', 'group.member_tag.updated',
  'command.completed', 'command.failed', 'call.updated', 'settings.updated',
  'blocklist.set', 'blocklist.updated', 'label.updated', 'label.association.updated',
  'newsletter.reaction.updated', 'newsletter.view.updated', 'newsletter.participants.updated', 'newsletter.settings.updated',
] as const;

export type GatewayEventType = typeof gatewayEventTypes[number];
