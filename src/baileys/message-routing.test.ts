import { describe, expect, it } from 'vitest';
import { bareJid, isGroupJid, mentionedJids } from './session.js';

/**
 * The routing facts a webhook consumer binds on. A group is a different
 * CONVERSATION, so it gets its own event type rather than a boolean on the
 * payload — and "was I addressed" has to be answerable without spending an
 * agent turn to decide to stay silent.
 */
describe('message routing signals', () => {
  it('distinguishes group chats from 1:1 chats by JID suffix', () => {
    expect(isGroupJid('120363000000000000@g.us')).toBe(true);
    expect(isGroupJid('4917000000@s.whatsapp.net')).toBe(false);
    // A group id merely CONTAINING the DM domain must not fool the check.
    expect(isGroupJid('s.whatsapp.net@g.us')).toBe(true);
  });

  it('strips the device suffix so a mention matches our own JID', () => {
    // Baileys reports our own id device-qualified but mentions bare, so a
    // naive comparison would never match and mention-gating would be dead.
    expect(bareJid('4917000000:5@s.whatsapp.net')).toBe('4917000000@s.whatsapp.net');
    expect(bareJid('4917000000@s.whatsapp.net')).toBe('4917000000@s.whatsapp.net');
  });

  it('finds mentions whatever content variant carries the contextInfo', () => {
    const mentions = ['4917000000@s.whatsapp.net'];
    expect(mentionedJids({ message: { extendedTextMessage: { text: 'hi', contextInfo: { mentionedJid: mentions } } } } as never))
      .toEqual(mentions);
    // Captions carry mentions too — an image that @s you is still addressing you.
    expect(mentionedJids({ message: { imageMessage: { caption: 'look', contextInfo: { mentionedJid: mentions } } } } as never))
      .toEqual(mentions);
  });

  it('reports no mentions for plain messages and empty payloads', () => {
    expect(mentionedJids({ message: { conversation: 'hello' } } as never)).toEqual([]);
    expect(mentionedJids({ message: null } as never)).toEqual([]);
    expect(mentionedJids({} as never)).toEqual([]);
  });
});
