import { describe, expect, it } from 'vitest';
import { needsTranscode } from './transcode.js';

/**
 * WhatsApp sends voice notes as `audio/ogg; codecs=opus`. Model audio inputs
 * accept mp3/wav/m4a/flac/webm and not opus, so serving the raw bytes ends with
 * the recipient asking the sender to type their message out instead — the exact
 * failure this converts away.
 */
describe('needsTranscode', () => {
  it('catches the format WhatsApp actually sends', () => {
    expect(needsTranscode('audio/ogg; codecs=opus')).toBe(true);
    expect(needsTranscode('audio/ogg')).toBe(true);
    expect(needsTranscode('AUDIO/OGG; CODECS=OPUS')).toBe(true);
    expect(needsTranscode('audio/opus')).toBe(true);
  });

  it('leaves formats consumers can already read alone', () => {
    for (const type of ['audio/mpeg', 'audio/mp4', 'audio/wav', 'image/jpeg', 'application/pdf', null, undefined, '']) {
      expect(needsTranscode(type)).toBe(false);
    }
  });
});
