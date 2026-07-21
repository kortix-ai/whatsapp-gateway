import type { LookupAddress } from 'node:dns';
import { describe, expect, it } from 'vitest';
import { createPublicLookup, isPublicIp } from './url-security.js';

describe('webhook URL security', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('accepts public address %s', (address) => {
    expect(isPublicIp(address)).toBe(true);
  });

  it('rejects a rebinding answer during the connector lookup', async () => {
    const resolve = (_hostname: string, _options: unknown, callback: (error: null, addresses: LookupAddress[]) => void) => {
      callback(null, [
        { address: '1.1.1.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]);
    };
    const lookup = createPublicLookup(resolve);
    const error = await new Promise<NodeJS.ErrnoException | null>((resolveError) => {
      lookup('example.com', { all: true }, (nextError) => resolveError(nextError));
    });
    expect(error?.message).toBe('Private webhook destinations are blocked');
  });
});
