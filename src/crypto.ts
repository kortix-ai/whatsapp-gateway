import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

const VERSION = 'v1';

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptJson<T>(value: string): T {
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split('.');
  if (version !== VERSION || !ivRaw || !tagRaw || !ciphertextRaw) throw new Error('Invalid encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', config.encryptionKey, Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8')) as T;
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifyWebhookSignature(secret: string, timestamp: string, body: string, signature: string): boolean {
  const expected = Buffer.from(signWebhook(secret, timestamp, body));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
