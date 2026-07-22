import { describe, expect, it } from 'vitest';
import { webhookBackoffMs, isPermanentRejection } from './dispatcher.js';

describe('webhook retry backoff', () => {
  it('grows exponentially and caps at one hour', () => {
    expect(webhookBackoffMs(1, () => 0)).toBe(1_000);
    expect(webhookBackoffMs(2, () => 0)).toBe(2_000);
    expect(webhookBackoffMs(20, () => 0)).toBe(3_600_000);
  });

  it('adds bounded jitter', () => {
    expect(webhookBackoffMs(4, () => 0.999)).toBeGreaterThanOrEqual(8_000);
    expect(webhookBackoffMs(4, () => 0.999)).toBeLessThan(9_600);
  });
});

describe('permanent rejections do not consume retry capacity', () => {
  it('dead-letters a rejected signature instead of retrying it', () => {
    // A 401 means the receiver does not accept our signature. Resending is
    // guaranteed to fail, and each attempt occupies a slot in the same bounded
    // pool that live events queue behind.
    expect(isPermanentRejection(401)).toBe(true);
    expect(isPermanentRejection(403)).toBe(true);
    expect(isPermanentRejection(410)).toBe(true);
  });

  it('keeps retrying anything that might succeed later', () => {
    for (const code of [404, 408, 429, 500, 502, 503, 504, undefined]) {
      expect(isPermanentRejection(code)).toBe(false);
    }
  });
});
