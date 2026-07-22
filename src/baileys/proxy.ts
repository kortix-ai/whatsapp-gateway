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
 * Build an undici dispatcher for Baileys' fetch-based transfers — media
 * DOWNLOAD and source-URL fetches, passed as `options.dispatcher`.
 *
 * Media UPLOAD is deliberately NOT one of these: on Node, Baileys uploads via
 * the `https` module (to sidestep an undici request-body buffering bug), so it
 * needs the node Agent from {@link createProxyAgent} instead. Passing a
 * dispatcher as `fetchAgent` makes every upload host fail with the thoroughly
 * unhelpful "Media upload failed on all hosts".
 *
 * undici has no SOCKS dispatcher, so SOCKS proxies return undefined here and
 * their fetch-based transfers go out unproxied.
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
