/**
 * Gateway permission registry — the single source of truth for API-key
 * resources and actions. Dependency-free so both the server (better-auth
 * statements) and the browser console (key-creation matrix) import it.
 */
export const gatewayPermissions = {
  accounts: ['read', 'write', 'pair', 'disconnect'],
  messages: ['read', 'write', 'send'],
  groups: ['read', 'write'],
  contacts: ['read', 'write'],
  chats: ['read', 'write'],
  presence: ['read', 'write'],
  profile: ['read', 'write'],
  privacy: ['read', 'write'],
  business: ['read', 'write'],
  communities: ['read', 'write'],
  newsletters: ['read', 'write'],
  calls: ['write'],
  webhooks: ['read', 'write', 'replay'],
  agent: ['skill'],
} as const;
