import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { Agent } from 'undici';
import ipaddr from 'ipaddr.js';
import { config } from '../config.js';

type ResolveAll = (
  hostname: string,
  options: LookupAllOptions,
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

export function isPublicIp(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

function assertPublicAddresses(addresses: LookupAddress[]): void {
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error('Private webhook destinations are blocked');
  }
}

const resolveAll: ResolveAll = dnsLookup;

/**
 * Resolve and validate addresses inside the connector itself. This closes the
 * DNS-rebinding window between an application-level lookup and TCP connect.
 */
export function createPublicLookup(resolve: ResolveAll = resolveAll): LookupFunction {
  return (hostname, options, callback) => {
    const lookupOptions: LookupAllOptions = {
      all: true,
      order: 'verbatim',
      ...(options.family !== undefined ? { family: options.family } : {}),
      ...(options.hints !== undefined ? { hints: options.hints } : {}),
    };
    resolve(hostname, lookupOptions, (error, addresses) => {
      if (error) {
        callback(error, []);
        return;
      }
      try {
        assertPublicAddresses(addresses);
      } catch (nextError) {
        callback(nextError as NodeJS.ErrnoException, []);
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      const first = addresses[0];
      if (!first) {
        callback(new Error('Webhook hostname did not resolve'), []);
        return;
      }
      callback(null, first.address, first.family);
    });
  };
}

export function createWebhookAgent(): Agent {
  return new Agent({
    // The public-only lookup re-validates every new connection; the dev-only
    // ALLOW_PRIVATE_WEBHOOKS flag skips that single check, nothing else.
    connect: { ...(config.ALLOW_PRIVATE_WEBHOOKS ? {} : { lookup: createPublicLookup() }), timeout: 10_000 },
    bodyTimeout: 10_000,
    headersTimeout: 10_000,
    maxResponseSize: 64 * 1024,
    pipelining: 1,
  });
}

export async function validateWebhookUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Webhook URL must use HTTP or HTTPS');
  if (url.username || url.password) throw new Error('Webhook URL cannot contain credentials');
  if (config.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production webhook URLs must use HTTPS');
  if (config.ALLOW_PRIVATE_WEBHOOKS) return url;
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new Error('Private webhook destinations are blocked');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  assertPublicAddresses(addresses);
  return url;
}
