import { describe, expect, it } from 'vitest';
import { reconnectDelayMs } from './reconnect.js';

describe('reconnect backoff', () => {
  it('grows exponentially and caps at five minutes', () => {
    expect(reconnectDelayMs(1, () => 0)).toBe(1_000);
    expect(reconnectDelayMs(2, () => 0)).toBe(2_000);
    expect(reconnectDelayMs(10, () => 0)).toBe(300_000);
    expect(reconnectDelayMs(100, () => 0)).toBe(300_000);
  });

  it('adds bounded jitter so replicas do not reconnect in lockstep', () => {
    expect(reconnectDelayMs(3, () => 0)).toBe(4_000);
    expect(reconnectDelayMs(3, () => 0.999)).toBeGreaterThanOrEqual(4_000);
    expect(reconnectDelayMs(3, () => 0.999)).toBeLessThan(4_800);
  });
});
