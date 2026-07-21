import { config } from '../config.js';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowedEmail(email: string): boolean {
  return !config.AUTH_ALLOWLIST_ENABLED || config.allowedEmails.includes(normalizeEmail(email));
}
