import { describe, expect, it } from 'vitest';
import { envSchema } from './config.js';

// docker-compose passes unset optional vars as "" (via ${VAR:-}). Empty strings must
// never fail validation for optional env vars — that crash-loops every container.
describe('env schema', () => {
  const composeEmptyEnv = {
    WA_PROXY_URL: '',
    WA_WEB_VERSION: '',
    WA_COUNTRY_CODE: '',
    TRUSTED_PROXY_CIDRS: '',
    ALLOWED_EMAILS: '',
    WORKER_ID: '',
  };

  it('accepts empty strings for every optional/compose-passed var', () => {
    const parsed = envSchema.parse(composeEmptyEnv);
    expect(parsed.WA_PROXY_URL).toBeUndefined();
    expect(parsed.WA_WEB_VERSION).toBeUndefined();
    expect(parsed.WA_COUNTRY_CODE).toBeUndefined();
  });

  it('normalizes and keeps a real country code', () => {
    expect(envSchema.parse({ WA_COUNTRY_CODE: 'gb' }).WA_COUNTRY_CODE).toBe('GB');
  });
});
