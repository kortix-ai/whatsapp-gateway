import type { Agent } from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

/**
 * Build a proxy agent for the Baileys socket and media transfers so WhatsApp
 * sees a residential exit IP instead of the datacenter the gateway runs in.
 * Supports http(s):// and socks(4|5):// proxy URLs (e.g. IPRoyal sticky sessions).
 */
export function createProxyAgent(url: string): Agent {
  const scheme = new URL(url).protocol.replace(':', '').toLowerCase();
  if (scheme.startsWith('socks')) return new SocksProxyAgent(url) as unknown as Agent;
  return new HttpsProxyAgent(url) as unknown as Agent;
}

/** A proxy URL with its credentials stripped, safe to log. */
export function redactProxy(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username ? '***@' : ''}${parsed.host}`;
  } catch {
    return 'invalid-proxy-url';
  }
}

/** Throws if a configured proxy URL is unparseable, so startup fails loudly. */
export function assertValidProxy(url: string): void {
  const parsed = new URL(url);
  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  if (!['http', 'https', 'socks', 'socks4', 'socks5'].includes(scheme)) {
    throw new Error(`WA_PROXY_URL scheme must be http, https, or socks5 (got ${scheme})`);
  }
}
