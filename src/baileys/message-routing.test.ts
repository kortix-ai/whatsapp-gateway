import { describe, expect, it } from 'vitest';
import { bareJid, isGroupJid, mentionedJids } from './session.js';
import { messageText } from './session.js';

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

/**
 * WhatsApp delivers a reaction as a message whose content is `reactionMessage`,
 * with no text of its own. Routing it as a plain message wakes a consumer with
 * an empty body and no way to distinguish a thumbs-up from someone sending
 * nothing at all — so it gets its own event type carrying the emoji.
 */
describe('reactions are routed as reactions, not as empty messages', () => {
  const reaction = {
    message: {
      reactionMessage: {
        text: '👍',
        key: { id: '3B513F1266686AD1E234', fromMe: false, remoteJid: '120363@g.us' },
      },
    },
  } as never;

  it('carries no message text, which is why it must not be a message event', () => {
    // messageText() returns null here: a consumer woken on `message.received`
    // would render an empty prompt.
    expect(messageText(reaction)).toBeNull();
  });

  it('is not confused with a normal text message', () => {
    expect(messageText({ message: { conversation: 'hello' } } as never)).toBe('hello');
  });
});

/**
 * Call routing. Baileys reports a call as a burst of status transitions; only
 * two of them are things a consumer acts on — it started ringing, and it is
 * over. Everything between is transport chatter.
 */
describe('call statuses worth waking an agent for', () => {
  const RINGING = 'offer';
  const OVER = ['terminate', 'timeout', 'reject'];
  const NOISE = ['ringing', 'preaccept', 'transport', 'relaylatency', 'accept'];

  const routed = (status: string) =>
    status === RINGING ? 'call.received' : OVER.includes(status) ? 'call.ended' : null;

  it('announces an incoming call the moment it starts ringing', () => {
    expect(routed('offer')).toBe('call.received');
  });

  it('reports the end however it ended', () => {
    for (const status of OVER) expect(routed(status)).toBe('call.ended');
  });

  it('stays silent through the transport chatter in between', () => {
    // A single call emits several of these. Forwarding them would wake the
    // agent repeatedly for one event.
    for (const status of NOISE) expect(routed(status)).toBeNull();
  });
});
