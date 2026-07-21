/**
 * Gateway permission registry, mirroring the server's `gatewayPermissions`
 * (src/auth/auth.ts). Used to render permission presets and the custom matrix
 * when minting API keys.
 */
export const PERMISSION_REGISTRY: Record<string, readonly string[]> = {
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
};

export type PermissionPreset = 'full' | 'read' | 'custom';

export function readOnlyPermissions(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(PERMISSION_REGISTRY)) {
    if (actions.includes('read')) result[resource] = ['read'];
  }
  return result;
}

export function fullPermissions(): Record<string, string[]> {
  return Object.fromEntries(Object.entries(PERMISSION_REGISTRY).map(([resource, actions]) => [resource, [...actions]]));
}
