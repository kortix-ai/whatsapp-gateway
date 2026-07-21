import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { isAllowedEmail, normalizeEmail } from './allowlist.js';

const originalEnabled = config.AUTH_ALLOWLIST_ENABLED;
const originalEmails = [...config.allowedEmails];

afterEach(() => {
  config.AUTH_ALLOWLIST_ENABLED = originalEnabled;
  config.allowedEmails.splice(0, config.allowedEmails.length, ...originalEmails);
});

describe('authentication allowlist', () => {
  it('normalizes addresses and permits only configured users when enabled', () => {
    config.AUTH_ALLOWLIST_ENABLED = true;
    config.allowedEmails.splice(0, config.allowedEmails.length, 'marko@kortix.ai');
    expect(normalizeEmail('  MARKO@KORTIX.AI ')).toBe('marko@kortix.ai');
    expect(isAllowedEmail('MARKO@KORTIX.AI')).toBe(true);
    expect(isAllowedEmail('someone@example.com')).toBe(false);
  });

  it('permits public signup only when the allowlist is explicitly disabled', () => {
    config.AUTH_ALLOWLIST_ENABLED = false;
    config.allowedEmails.splice(0, config.allowedEmails.length);
    expect(isAllowedEmail('anyone@example.com')).toBe(true);
  });
});
