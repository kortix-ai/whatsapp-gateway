import { describe, expect, it } from 'vitest';
import { describeMessage, unwrapContent } from './message-facts.js';

const msg = (content: unknown) => ({ message: content } as never);

/**
 * The contract: every message a person sends produces a NON-EMPTY summary, and
 * everything that is not a person saying something is marked so it never wakes
 * an agent. Both halves matter — production carried 592 `unknown` and 288
 * `protocolMessage` frames that reached consumers as empty messages.
 */
describe('describeMessage', () => {
  it('describes a voice note distinctly from an attached audio file', () => {
    const voice = describeMessage(msg({ audioMessage: { ptt: true, seconds: 12, mimetype: 'audio/ogg' } }));
    expect(voice.summary).toBe('voice message (0:12)');
    expect(voice.media?.voice_note).toBe(true);

    const attached = describeMessage(msg({ audioMessage: { ptt: false, seconds: 95, mimetype: 'audio/mp4' } }));
    expect(attached.summary).toBe('audio (1:35)');
    expect(attached.media?.voice_note).toBe(false);
  });

  it('names a document by its filename and size', () => {
    const facts = describeMessage(
      msg({ documentMessage: { fileName: 'invoice.pdf', mimetype: 'application/pdf', fileLength: 2_400_000 } }),
    );
    expect(facts.summary).toBe('invoice.pdf · 2.4 MB');
    expect(facts.media).toMatchObject({ kind: 'document', file_name: 'invoice.pdf' });
  });

  it('keeps a caption, because that is the part worth replying to', () => {
    expect(describeMessage(msg({ imageMessage: { caption: 'look at this' } })).summary)
      .toBe('photo · "look at this"');
    expect(describeMessage(msg({ imageMessage: {} })).summary).toBe('photo');
  });

  it('distinguishes a video note from a video', () => {
    expect(describeMessage(msg({ ptvMessage: { seconds: 7 } })).summary).toBe('video note (0:07)');
    expect(describeMessage(msg({ videoMessage: { seconds: 7 } })).summary).toBe('video (0:07)');
  });

  it('carries structured facts for location, contacts and polls', () => {
    const loc = describeMessage(msg({ locationMessage: { degreesLatitude: 48.85, degreesLongitude: 2.29, name: 'Eiffel Tower' } }));
    expect(loc.summary).toBe('location · Eiffel Tower');
    expect(loc.location).toMatchObject({ latitude: 48.85, longitude: 2.29, live: false });

    expect(describeMessage(msg({ liveLocationMessage: { degreesLatitude: 1, degreesLongitude: 2 } })).location?.live).toBe(true);

    const contact = describeMessage(msg({ contactMessage: { displayName: 'Jane Doe' } }));
    expect(contact.summary).toBe('contact card · Jane Doe');
    expect(contact.contacts).toEqual([{ display_name: 'Jane Doe' }]);

    const poll = describeMessage(msg({
      pollCreationMessageV3: { name: 'Lunch?', options: [{ optionName: 'Pizza' }, { optionName: 'Sushi' }] },
    }));
    expect(poll.summary).toBe('poll · "Lunch?"');
    expect(poll.poll).toEqual({ question: 'Lunch?', options: ['Pizza', 'Sushi'] });
  });

  it('marks system and undecryptable frames as not user content', () => {
    for (const content of [
      { protocolMessage: { type: 0 } },
      { senderKeyDistributionMessage: {} },
      { placeholderMessage: {} },
    ]) {
      expect(describeMessage(msg(content)).user_content).toBe(false);
    }
  });

  it('never returns an empty summary, whatever arrives', () => {
    const shapes = [
      { conversation: 'hi' }, { extendedTextMessage: { text: 'hi' } },
      { imageMessage: {} }, { videoMessage: {} }, { audioMessage: {} }, { documentMessage: {} },
      { stickerMessage: {} }, { lottieStickerMessage: {} }, { ptvMessage: {} },
      { locationMessage: {} }, { contactMessage: {} }, { albumMessage: {} },
      { groupInviteMessage: {} }, { interactiveMessage: {} }, { templateMessage: {} },
      { pollCreationMessageV3: {} }, { reactionMessage: { text: '👍' } },
      { protocolMessage: {} }, { placeholderMessage: {} },
      // A shape this gateway has never seen must still describe itself rather
      // than arriving blank.
      { someFutureThingMessage: {} },
    ];
    for (const content of shapes) {
      const facts = describeMessage(msg(content));
      expect(facts.summary.length).toBeGreaterThan(0);
    }
    expect(describeMessage(msg(null)).summary).toBe('empty message');
  });

  it('reads through the envelopes WhatsApp nests content inside', () => {
    // A disappearing voice note is an audioMessage wrapped twice over; reading
    // the outer layer would report it as an unknown shape.
    const nested = msg({ ephemeralMessage: { message: { viewOnceMessageV2: { message: { audioMessage: { ptt: true, seconds: 5 } } } } } });
    expect(describeMessage(nested).summary).toBe('voice message (0:05)');
    expect(unwrapContent({ ephemeralMessage: { message: { conversation: 'x' } } } as never)?.conversation).toBe('x');
  });

  it('records what a reply points at', () => {
    const facts = describeMessage(msg({ extendedTextMessage: { text: 'agreed', contextInfo: { stanzaId: 'ABC123' } } }));
    expect(facts.quoted?.message_id).toBe('ABC123');
  });
});
