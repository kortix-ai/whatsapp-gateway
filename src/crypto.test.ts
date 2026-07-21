import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, signWebhook, verifyWebhookSignature } from './crypto.js';

describe('encrypted gateway state', () => {
  it('round trips JSON without retaining plaintext', () => {
    const encrypted = encryptJson({ token: 'secret-value', count: 2 });
    expect(encrypted).not.toContain('secret-value');
    expect(decryptJson(encrypted)).toEqual({ token: 'secret-value', count: 2 });
  });

  it('signs the timestamp and exact raw webhook body', () => {
    const timestamp = '1784589000';
    const body = '{"id":"evt_test"}';
    const signature = signWebhook('whsec_test', timestamp, body);
    expect(verifyWebhookSignature('whsec_test', timestamp, body, signature)).toBe(true);
    expect(verifyWebhookSignature('whsec_test', timestamp, `${body}\n`, signature)).toBe(false);
  });
});
