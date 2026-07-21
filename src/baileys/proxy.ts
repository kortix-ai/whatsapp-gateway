import type { Agent } from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { ProxyAgent, type Dispatcher } from 'undici';

/**
 * Build a proxy agent for the WebSocket connection so WhatsApp sees a residential
 * exit IP instead of the datacenter the gateway runs in. Used by the `ws` client
 * (node http agent). Supports http(s):// and socks(4|5):// (e.g. IPRoyal sessions).
 */
export function createProxyAgent(url: string): Agent {
  const scheme = new URL(url).protocol.replace(':', '').toLowerCase();
  if (scheme.startsWith('socks')) return new SocksProxyAgent(url) as unknown as Agent;
  return new HttpsProxyAgent(url) as unknown as Agent;
}

/**
 * Build an undici dispatcher for fetch-based media transfers (Baileys media
 * upload/download go through undici's `fetch`, which needs a dispatcher, not a
 * node http agent). undici has no native SOCKS dispatcher, so SOCKS proxies fall
 * back to the node http agent path and this returns undefined.
 */
export function createProxyDispatcher(url: string): Dispatcher | undefined {
  const scheme = new URL(url).protocol.replace(':', '').toLowerCase();
  if (scheme === 'http' || scheme === 'https') return new ProxyAgent(url);
  return undefined;
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
