import { describe, expect, it } from 'vitest';
import { assertValidProxy, createProxyAgent, createProxyDispatcher, redactProxy } from './proxy.js';

/**
 * Baileys takes THREE different proxy objects and silently misbehaves when
 * given the wrong kind. The failure mode that motivated these tests: an undici
 * dispatcher passed as `fetchAgent` made every media send die with
 * "Media upload failed on all hosts", which reads like a WhatsApp outage.
 *
 * These pin the two constructors to the shapes their consumers actually
 * require, so the two can never be swapped again without a red test.
 */
describe('proxy objects match the transport that consumes them', () => {
  const HTTP = 'http://user:pass@proxy.example.com:8080';
  const SOCKS = 'socks5://user:pass@proxy.example.com:1080';

  it('createProxyAgent returns a node http.Agent — what http.request needs', () => {
    for (const url of [HTTP, SOCKS]) {
      const agent = createProxyAgent(url) as unknown as Record<string, unknown>;
      // node's http.request drives an agent through addRequest/createConnection.
      expect(typeof agent.addRequest).toBe('function');
      // Must NOT be an undici dispatcher: Baileys' upload path checks for
      // `.dispatch` to decide it can hand the object to fetch instead.
      expect(agent.dispatch).toBeUndefined();
    }
  });

  it('createProxyDispatcher returns an undici Dispatcher — what fetch needs', () => {
    const dispatcher = createProxyDispatcher(HTTP) as unknown as Record<string, unknown>;
    expect(typeof dispatcher.dispatch).toBe('function');
  });

  it('has no dispatcher for SOCKS, so callers must handle unproxied fetch', () => {
    expect(createProxyDispatcher(SOCKS)).toBeUndefined();
  });

  it('never leaks proxy credentials into logs', () => {
    expect(redactProxy(HTTP)).toBe('http://***@proxy.example.com:8080');
    expect(redactProxy('http://proxy.example.com:8080')).toBe('http://proxy.example.com:8080');
    expect(redactProxy('not a url')).toBe('invalid-proxy-url');
  });

  it('rejects unsupported schemes at startup rather than at first send', () => {
    expect(() => assertValidProxy(HTTP)).not.toThrow();
    expect(() => assertValidProxy(SOCKS)).not.toThrow();
    expect(() => assertValidProxy('ftp://proxy.example.com')).toThrow(/scheme must be/);
  });
});
