import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { decryptJson, encryptJson, signWebhook, signWebhookBody, verifyWebhookSignature } from './crypto.js';

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

  it('signs the body alone for generic receivers, independent of the timestamp', () => {
    const body = '{"id":"evt_test"}';
    // Must match what a plain HMAC-over-raw-body receiver computes, byte for
    // byte — this is the contract Kortix webhook triggers verify against.
    expect(signWebhookBody('whsec_test', body)).toBe(
      createHmac('sha256', 'whsec_test').update(body).digest('hex'),
    );
    expect(signWebhookBody('whsec_test', body)).not.toBe(signWebhook('whsec_test', '1784589000', body));
    expect(signWebhookBody('whsec_test', body)).not.toBe(signWebhookBody('whsec_other', body));
  });
});
