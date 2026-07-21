import { describe, expect, it } from 'vitest';
import { webhookBackoffMs } from './dispatcher.js';

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
