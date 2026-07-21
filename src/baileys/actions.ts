export type ActionPermission = {
  resource: 'messages' | 'groups' | 'contacts' | 'chats' | 'presence' | 'profile' | 'privacy' | 'business' | 'communities' | 'newsletters' | 'calls' | 'accounts';
  action: 'read' | 'write' | 'send';
};

type ActionDefinition = {
  method: string;
  permission: ActionPermission;
  args: string;
  description: string;
};

const define = (method: string, permission: ActionPermission, args: string, description: string): ActionDefinition => ({
  method, permission, args, description,
});

export const baileysActions = {
  'messages.send': define('sendMessage', { resource: 'messages', action: 'send' }, '[jid, content, options?]', 'Send text, media, location, contacts, reactions, polls, events, buttons, lists, stickers, or other supported content.'),
  'messages.read': define('readMessages', { resource: 'messages', action: 'write' }, '[messageKeys]', 'Mark one or more messages as read.'),
  'messages.receipt.send': define('sendReceipt', { resource: 'messages', action: 'write' }, '[jid, participant, messageIds, type]', 'Send a read, played, or delivery receipt.'),
  'messages.receipts.send': define('sendReceipts', { resource: 'messages', action: 'write' }, '[messageKeys, type]', 'Send receipts for multiple message keys.'),
  'messages.media.refresh': define('updateMediaMessage', { resource: 'messages', action: 'read' }, '[message]', 'Request and update an expired media URL.'),
  'messages.history.fetch': define('fetchMessageHistory', { resource: 'messages', action: 'read' }, '[count, oldestMessageKey, oldestTimestamp]', 'Request older history from the primary phone.'),
  'messages.placeholder.resend': define('requestPlaceholderResend', { resource: 'messages', action: 'read' }, '[messageKey, messageData?]', 'Request a resend for a placeholder message.'),

  'presence.update': define('sendPresenceUpdate', { resource: 'presence', action: 'write' }, '[type, jid?]', 'Set available, unavailable, composing, recording, or paused presence.'),
  'presence.subscribe': define('presenceSubscribe', { resource: 'presence', action: 'read' }, '[jid]', 'Subscribe to presence changes for a contact.'),

  'contacts.exists': define('onWhatsApp', { resource: 'contacts', action: 'read' }, '[...phoneNumbers]', 'Check whether phone numbers are registered on WhatsApp.'),
  'contacts.status': define('fetchStatus', { resource: 'contacts', action: 'read' }, '[...jids]', 'Fetch profile status text for contacts.'),
  'contacts.disappearing-duration': define('fetchDisappearingDuration', { resource: 'contacts', action: 'read' }, '[...jids]', 'Fetch disappearing-message duration for contacts.'),
  'contacts.upsert': define('addOrEditContact', { resource: 'contacts', action: 'write' }, '[jid, contactAction]', 'Add or edit a contact in app state.'),
  'contacts.remove': define('removeContact', { resource: 'contacts', action: 'write' }, '[jid]', 'Remove a contact.'),

  'chats.modify': define('chatModify', { resource: 'chats', action: 'write' }, '[modification, jid]', 'Archive, unarchive, mute, unmute, pin, unpin, mark read/unread, clear, or delete a chat.'),
  'chats.label.upsert': define('addLabel', { resource: 'chats', action: 'write' }, '[jid, labelAction]', 'Create, edit, or delete a label.'),
  'chats.label.add': define('addChatLabel', { resource: 'chats', action: 'write' }, '[jid, labelId]', 'Apply a label to a chat.'),
  'chats.label.remove': define('removeChatLabel', { resource: 'chats', action: 'write' }, '[jid, labelId]', 'Remove a label from a chat.'),
  'messages.label.add': define('addMessageLabel', { resource: 'chats', action: 'write' }, '[jid, messageId, labelId]', 'Apply a label to a message.'),
  'messages.label.remove': define('removeMessageLabel', { resource: 'chats', action: 'write' }, '[jid, messageId, labelId]', 'Remove a label from a message.'),
  'messages.star': define('star', { resource: 'chats', action: 'write' }, '[jid, messages, star]', 'Star or unstar messages.'),

  'profile.picture.url': define('profilePictureUrl', { resource: 'profile', action: 'read' }, '[jid, type?, timeoutMs?]', 'Fetch a profile picture URL.'),
  'profile.picture.update': define('updateProfilePicture', { resource: 'profile', action: 'write' }, '[jid, media, dimensions?]', 'Update a profile picture from a URL, buffer-compatible object, or stream-compatible input.'),
  'profile.picture.remove': define('removeProfilePicture', { resource: 'profile', action: 'write' }, '[jid]', 'Remove a profile picture.'),
  'profile.status.update': define('updateProfileStatus', { resource: 'profile', action: 'write' }, '[status]', 'Update the account About text.'),
  'profile.name.update': define('updateProfileName', { resource: 'profile', action: 'write' }, '[name]', 'Update the account display name.'),
  'blocklist.fetch': define('fetchBlocklist', { resource: 'privacy', action: 'read' }, '[]', 'Fetch blocked contacts.'),
  'blocklist.update': define('updateBlockStatus', { resource: 'privacy', action: 'write' }, '[jid, "block"|"unblock"]', 'Block or unblock a contact.'),
  'privacy.fetch': define('fetchPrivacySettings', { resource: 'privacy', action: 'read' }, '[force?]', 'Fetch all account privacy settings.'),
  'privacy.link-previews.update': define('updateDisableLinkPreviewsPrivacy', { resource: 'privacy', action: 'write' }, '[disabled]', 'Enable or disable link previews.'),
  'privacy.calls.update': define('updateCallPrivacy', { resource: 'privacy', action: 'write' }, '[value]', 'Update call privacy.'),
  'privacy.messages.update': define('updateMessagesPrivacy', { resource: 'privacy', action: 'write' }, '[value]', 'Update message privacy.'),
  'privacy.last-seen.update': define('updateLastSeenPrivacy', { resource: 'privacy', action: 'write' }, '[value]', 'Update last-seen privacy.'),
  'privacy.online.update': define('updateOnlinePrivacy', { resource: 'privacy', action: 'write' }, '[value]', 'Update online-presence privacy.'),
  'privacy.profile-picture.update': define('updateProfilePicturePrivacy', { resource: 'privacy', action: 'write' }, '[value]', 'Update profile-picture privacy.'),
  'privacy.status.update': define('updateStatusPrivacy', { resource: 'privacy', action: 'write' }, '[value]', 'Update status privacy.'),
  'privacy.read-receipts.update': define('updateReadReceiptsPrivacy', { resource: 'privacy', action: 'write' }, '[value]', 'Update read-receipt privacy.'),
  'privacy.group-add.update': define('updateGroupsAddPrivacy', { resource: 'privacy', action: 'write' }, '[value]', 'Update who may add the account to groups.'),
  'privacy.disappearing-default.update': define('updateDefaultDisappearingMode', { resource: 'privacy', action: 'write' }, '[durationSeconds]', 'Set the default disappearing-message duration.'),

  'groups.metadata': define('groupMetadata', { resource: 'groups', action: 'read' }, '[groupJid]', 'Fetch group metadata.'),
  'groups.create': define('groupCreate', { resource: 'groups', action: 'write' }, '[subject, participantJids]', 'Create a group.'),
  'groups.leave': define('groupLeave', { resource: 'groups', action: 'write' }, '[groupJid]', 'Leave a group.'),
  'groups.subject.update': define('groupUpdateSubject', { resource: 'groups', action: 'write' }, '[groupJid, subject]', 'Update a group subject.'),
  'groups.description.update': define('groupUpdateDescription', { resource: 'groups', action: 'write' }, '[groupJid, description?]', 'Update or remove a group description.'),
  'groups.participants.update': define('groupParticipantsUpdate', { resource: 'groups', action: 'write' }, '[groupJid, participantJids, action]', 'Add, remove, promote, or demote participants.'),
  'groups.join-requests.list': define('groupRequestParticipantsList', { resource: 'groups', action: 'read' }, '[groupJid]', 'List pending join requests.'),
  'groups.join-requests.update': define('groupRequestParticipantsUpdate', { resource: 'groups', action: 'write' }, '[groupJid, participantJids, "approve"|"reject"]', 'Approve or reject join requests.'),
  'groups.invite.code': define('groupInviteCode', { resource: 'groups', action: 'read' }, '[groupJid]', 'Get a group invite code.'),
  'groups.invite.revoke': define('groupRevokeInvite', { resource: 'groups', action: 'write' }, '[groupJid]', 'Revoke and rotate a group invite code.'),
  'groups.invite.accept': define('groupAcceptInvite', { resource: 'groups', action: 'write' }, '[code]', 'Accept a group invite.'),
  'groups.invite.info': define('groupGetInviteInfo', { resource: 'groups', action: 'read' }, '[code]', 'Inspect group invite metadata.'),
  'groups.invite-v4.revoke': define('groupRevokeInviteV4', { resource: 'groups', action: 'write' }, '[groupJid, invitedJid]', 'Revoke a v4 group invite.'),
  'groups.invite-v4.accept': define('groupAcceptInviteV4', { resource: 'groups', action: 'write' }, '[messageKeyOrString, inviteMessage]', 'Accept a v4 group invite message.'),
  'groups.ephemeral.update': define('groupToggleEphemeral', { resource: 'groups', action: 'write' }, '[groupJid, expirationSeconds]', 'Set group disappearing messages.'),
  'groups.settings.update': define('groupSettingUpdate', { resource: 'groups', action: 'write' }, '[groupJid, setting]', 'Set announcement or edit-info restrictions.'),
  'groups.member-add-mode.update': define('groupMemberAddMode', { resource: 'groups', action: 'write' }, '[groupJid, mode]', 'Set who may add members.'),
  'groups.join-approval-mode.update': define('groupJoinApprovalMode', { resource: 'groups', action: 'write' }, '[groupJid, "on"|"off"]', 'Toggle join approval.'),
  'groups.member-label.update': define('updateMemberLabel', { resource: 'groups', action: 'write' }, '[groupJid, memberLabel]', 'Update the connected account member label in a group.'),
  'groups.participating.list': define('groupFetchAllParticipating', { resource: 'groups', action: 'read' }, '[]', 'Fetch every participating group.'),

  'communities.metadata': define('communityMetadata', { resource: 'communities', action: 'read' }, '[communityJid]', 'Fetch community metadata.'),
  'communities.create': define('communityCreate', { resource: 'communities', action: 'write' }, '[subject, body]', 'Create a community.'),
  'communities.group.create': define('communityCreateGroup', { resource: 'communities', action: 'write' }, '[subject, participantJids, communityJid]', 'Create a group inside a community.'),
  'communities.leave': define('communityLeave', { resource: 'communities', action: 'write' }, '[communityJid]', 'Leave a community.'),
  'communities.subject.update': define('communityUpdateSubject', { resource: 'communities', action: 'write' }, '[communityJid, subject]', 'Update a community subject.'),
  'communities.description.update': define('communityUpdateDescription', { resource: 'communities', action: 'write' }, '[communityJid, description?]', 'Update a community description.'),
  'communities.group.link': define('communityLinkGroup', { resource: 'communities', action: 'write' }, '[groupJid, communityJid]', 'Link a group to a community.'),
  'communities.group.unlink': define('communityUnlinkGroup', { resource: 'communities', action: 'write' }, '[groupJid, communityJid]', 'Unlink a group from a community.'),
  'communities.groups.list': define('communityFetchLinkedGroups', { resource: 'communities', action: 'read' }, '[communityJid]', 'List linked groups.'),
  'communities.participants.update': define('communityParticipantsUpdate', { resource: 'communities', action: 'write' }, '[communityJid, participantJids, action]', 'Update community participants.'),
  'communities.join-requests.list': define('communityRequestParticipantsList', { resource: 'communities', action: 'read' }, '[communityJid]', 'List community join requests.'),
  'communities.join-requests.update': define('communityRequestParticipantsUpdate', { resource: 'communities', action: 'write' }, '[communityJid, participantJids, action]', 'Approve or reject community join requests.'),
  'communities.invite.code': define('communityInviteCode', { resource: 'communities', action: 'read' }, '[communityJid]', 'Get a community invite code.'),
  'communities.invite.revoke': define('communityRevokeInvite', { resource: 'communities', action: 'write' }, '[communityJid]', 'Rotate a community invite code.'),
  'communities.invite.accept': define('communityAcceptInvite', { resource: 'communities', action: 'write' }, '[code]', 'Accept a community invite.'),
  'communities.invite.info': define('communityGetInviteInfo', { resource: 'communities', action: 'read' }, '[code]', 'Inspect community invite metadata.'),
  'communities.invite-v4.revoke': define('communityRevokeInviteV4', { resource: 'communities', action: 'write' }, '[communityJid, invitedJid]', 'Revoke a v4 community invite.'),
  'communities.invite-v4.accept': define('communityAcceptInviteV4', { resource: 'communities', action: 'write' }, '[messageKeyOrString, inviteMessage]', 'Accept a v4 community invite message.'),
  'communities.ephemeral.update': define('communityToggleEphemeral', { resource: 'communities', action: 'write' }, '[communityJid, expirationSeconds]', 'Set community disappearing messages.'),
  'communities.settings.update': define('communitySettingUpdate', { resource: 'communities', action: 'write' }, '[communityJid, setting]', 'Update community announcement or edit restrictions.'),
  'communities.member-add-mode.update': define('communityMemberAddMode', { resource: 'communities', action: 'write' }, '[communityJid, mode]', 'Set who may add community members.'),
  'communities.join-approval-mode.update': define('communityJoinApprovalMode', { resource: 'communities', action: 'write' }, '[communityJid, mode]', 'Toggle community join approval.'),
  'communities.participating.list': define('communityFetchAllParticipating', { resource: 'communities', action: 'read' }, '[]', 'Fetch every participating community.'),

  'newsletters.create': define('newsletterCreate', { resource: 'newsletters', action: 'write' }, '[name, description?]', 'Create a channel/newsletter.'),
  'newsletters.metadata': define('newsletterMetadata', { resource: 'newsletters', action: 'read' }, '["invite"|"jid", key]', 'Fetch channel metadata.'),
  'newsletters.update': define('newsletterUpdate', { resource: 'newsletters', action: 'write' }, '[newsletterJid, updates]', 'Update channel settings.'),
  'newsletters.follow': define('newsletterFollow', { resource: 'newsletters', action: 'write' }, '[newsletterJid]', 'Follow a channel.'),
  'newsletters.unfollow': define('newsletterUnfollow', { resource: 'newsletters', action: 'write' }, '[newsletterJid]', 'Unfollow a channel.'),
  'newsletters.mute': define('newsletterMute', { resource: 'newsletters', action: 'write' }, '[newsletterJid]', 'Mute a channel.'),
  'newsletters.unmute': define('newsletterUnmute', { resource: 'newsletters', action: 'write' }, '[newsletterJid]', 'Unmute a channel.'),
  'newsletters.name.update': define('newsletterUpdateName', { resource: 'newsletters', action: 'write' }, '[newsletterJid, name]', 'Update a channel name.'),
  'newsletters.description.update': define('newsletterUpdateDescription', { resource: 'newsletters', action: 'write' }, '[newsletterJid, description]', 'Update a channel description.'),
  'newsletters.picture.update': define('newsletterUpdatePicture', { resource: 'newsletters', action: 'write' }, '[newsletterJid, media]', 'Update a channel picture.'),
  'newsletters.picture.remove': define('newsletterRemovePicture', { resource: 'newsletters', action: 'write' }, '[newsletterJid]', 'Remove a channel picture.'),
  'newsletters.message.react': define('newsletterReactMessage', { resource: 'newsletters', action: 'write' }, '[newsletterJid, serverId, reaction?]', 'React to a channel message.'),
  'newsletters.messages.list': define('newsletterFetchMessages', { resource: 'newsletters', action: 'read' }, '[newsletterJid, count, since, after]', 'Fetch channel messages.'),
  'newsletters.updates.subscribe': define('subscribeNewsletterUpdates', { resource: 'newsletters', action: 'read' }, '[newsletterJid]', 'Subscribe to channel updates.'),
  'newsletters.subscribers.count': define('newsletterSubscribers', { resource: 'newsletters', action: 'read' }, '[newsletterJid]', 'Fetch subscriber count.'),
  'newsletters.admins.count': define('newsletterAdminCount', { resource: 'newsletters', action: 'read' }, '[newsletterJid]', 'Fetch admin count.'),
  'newsletters.owner.change': define('newsletterChangeOwner', { resource: 'newsletters', action: 'write' }, '[newsletterJid, newOwnerJid]', 'Transfer channel ownership.'),
  'newsletters.admin.demote': define('newsletterDemote', { resource: 'newsletters', action: 'write' }, '[newsletterJid, userJid]', 'Demote a channel admin.'),
  'newsletters.delete': define('newsletterDelete', { resource: 'newsletters', action: 'write' }, '[newsletterJid]', 'Delete a channel.'),

  'business.profile.get': define('getBusinessProfile', { resource: 'business', action: 'read' }, '[jid]', 'Fetch a WhatsApp Business profile.'),
  'business.profile.update': define('updateBussinesProfile', { resource: 'business', action: 'write' }, '[profile]', 'Update the connected WhatsApp Business profile.'),
  'business.cover.update': define('updateCoverPhoto', { resource: 'business', action: 'write' }, '[media]', 'Update the business cover photo.'),
  'business.cover.remove': define('removeCoverPhoto', { resource: 'business', action: 'write' }, '[id]', 'Remove the business cover photo.'),
  'business.catalog.get': define('getCatalog', { resource: 'business', action: 'read' }, '[options]', 'Fetch catalog products.'),
  'business.collections.get': define('getCollections', { resource: 'business', action: 'read' }, '[jid?, limit?]', 'Fetch catalog collections.'),
  'business.product.create': define('productCreate', { resource: 'business', action: 'write' }, '[product]', 'Create a catalog product.'),
  'business.product.update': define('productUpdate', { resource: 'business', action: 'write' }, '[productId, update]', 'Update a catalog product.'),
  'business.product.delete': define('productDelete', { resource: 'business', action: 'write' }, '[productIds]', 'Delete catalog products.'),
  'business.order.get': define('getOrderDetails', { resource: 'business', action: 'read' }, '[orderId, tokenBase64]', 'Fetch order details.'),
  'business.quick-reply.upsert': define('addOrEditQuickReply', { resource: 'business', action: 'write' }, '[quickReply]', 'Create or edit a quick reply.'),
  'business.quick-reply.remove': define('removeQuickReply', { resource: 'business', action: 'write' }, '[timestamp]', 'Remove a quick reply.'),

  'calls.link.create': define('createCallLink', { resource: 'calls', action: 'write' }, '["audio"|"video", event?]', 'Create a WhatsApp call link.'),
  'calls.reject': define('rejectCall', { resource: 'calls', action: 'write' }, '[callId, callerJid]', 'Reject an incoming call.'),

  'bots.list': define('getBotListV2', { resource: 'accounts', action: 'read' }, '[]', 'List WhatsApp bots advertised to the connected account.'),
  'account.app-state.resync': define('resyncAppState', { resource: 'accounts', action: 'write' }, '[collections, initialSync]', 'Force app-state resynchronization.'),
  'account.reachout-timelock': define('fetchAccountReachoutTimelock', { resource: 'accounts', action: 'read' }, '[]', 'Fetch account reachout timelock state.'),
  'account.new-chat-cap': define('fetchNewChatMessageCap', { resource: 'accounts', action: 'read' }, '[]', 'Fetch new-chat message cap state.'),
} as const satisfies Record<string, ActionDefinition>;

export type BaileysActionName = keyof typeof baileysActions;

export function isBaileysAction(value: string): value is BaileysActionName {
  return Object.hasOwn(baileysActions, value);
}
