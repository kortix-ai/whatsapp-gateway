import { gatewayPermissions } from '../../../shared/permissions.js';

/**
 * Gateway permission registry, shared with the server (src/shared/permissions.ts).
 * Used to render permission presets and the custom matrix when minting API keys.
 * Widened so `actions.includes('read')` typechecks over the const tuples.
 */
export const PERMISSION_REGISTRY: Record<string, readonly string[]> = gatewayPermissions;

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
