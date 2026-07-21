import { randomUUID } from 'node:crypto';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const email = `e2e-${randomUUID()}@example.com`;
  const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Gateway E2E', email, password: 'correct-horse-battery-staple' }),
  });
  if (signup.status !== 200) throw new Error(`Signup failed: ${signup.status} ${await signup.text()}`);
  const cookie = signup.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  assert(cookie, 'Signup did not set a session cookie');

  const authenticated = async (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { cookie, 'content-type': 'application/json', origin: baseUrl, ...init?.headers },
  });

  const createAccount = await authenticated('/v1/accounts', {
    method: 'POST', body: JSON.stringify({ display_name: 'E2E number' }),
  });
  if (createAccount.status !== 201) throw new Error(`Account creation failed: ${createAccount.status} ${await createAccount.text()}`);
  const account = await createAccount.json() as { id: string };

  const mint = await authenticated('/v1/agent-access', {
    method: 'POST', body: JSON.stringify({ name: 'E2E agent', account_ids: [account.id] }),
  });
  if (mint.status !== 201) throw new Error(`Agent key mint failed: ${mint.status} ${await mint.text()}`);
  const access = await mint.json() as { api_key: string; key_id: string; skill_md: string };
  assert(access.api_key.startsWith('wag_'), 'Agent API key has the wrong prefix');
  assert(access.skill_md.includes(access.api_key), 'Personalized skill does not contain the one-time key');

  const list = await fetch(`${baseUrl}/v1/accounts`, { headers: { 'x-api-key': access.api_key } });
  if (list.status !== 200) throw new Error(`API-key authentication failed: ${list.status} ${await list.text()}`);
  const listed = await list.json() as { data: Array<{ id: string }> };
  assert(listed.data.length === 1 && listed.data[0]?.id === account.id, 'Account scope was not enforced');

  const forbidden = await fetch(`${baseUrl}/v1/webhook-endpoints`, { headers: { 'x-api-key': access.api_key } });
  assert(forbidden.status === 401, `Permission boundary returned ${forbidden.status}, expected 401`);

  const skill = await fetch(`${baseUrl}/v1/skill.md`);
  assert(skill.status === 200 && (await skill.text()).includes('name: whatsapp-gateway'), 'Generic skill endpoint failed');

  const actionCatalog = await fetch(`${baseUrl}/v1/baileys-actions`, { headers: { 'x-api-key': access.api_key } });
  assert(actionCatalog.status === 200, `Baileys action catalog failed: ${actionCatalog.status}`);
  const actions = await actionCatalog.json() as { data: Array<{ name: string; method: string }> };
  assert(actions.data.length > 90 && actions.data.some((action) => action.name === 'privacy.fetch'), 'Baileys action catalog is incomplete');

  if (process.env.E2E_PAIRING === '1') {
    const pair = await authenticated(`/v1/accounts/${account.id}/pair/qr`, { method: 'POST', body: '{}' });
    const pairing = await pair.json() as { qr_data_url?: string; status?: string };
    assert(pair.status === 200 && pairing.qr_data_url?.startsWith('data:image/png;base64,'), 'Real Baileys QR pairing did not produce an image');
    const scopedStatus = await fetch(`${baseUrl}/v1/accounts/${account.id}/status`, { headers: { 'x-api-key': access.api_key } });
    const scopedStatusBody = await scopedStatus.json() as Record<string, unknown>;
    assert(scopedStatus.status === 200 && !('qr_data_url' in scopedStatusBody) && !('pairing_code' in scopedStatusBody), 'Read-only agent key leaked pairing credentials');
  }

  const keyListResponse = await authenticated('/api/auth/api-key/list');
  assert(keyListResponse.status === 200, `API-key list failed: ${keyListResponse.status}`);
  const keyList = await keyListResponse.json() as { apiKeys: Array<{ id: string }> };
  const createdKey = keyList.apiKeys.find((key) => key.id === access.key_id) ?? keyList.apiKeys[0];
  assert(createdKey, 'Created API key was not listed');
  const revoke = await authenticated('/api/auth/api-key/delete', { method: 'POST', body: JSON.stringify({ keyId: createdKey.id }) });
  assert(revoke.status === 200, `API-key revocation failed: ${revoke.status}`);
  const revokedUse = await fetch(`${baseUrl}/v1/accounts`, { headers: { 'x-api-key': access.api_key } });
  assert(revokedUse.status === 401, `Revoked API key returned ${revokedUse.status}`);

  console.log(JSON.stringify({
    ok: true,
    signup_status: signup.status,
    account_status: createAccount.status,
    key_prefix: access.api_key.slice(0, 4),
    scoped_accounts: listed.data.length,
    permission_denial_status: forbidden.status,
    baileys_actions: actions.data.length,
    pairing_checked: process.env.E2E_PAIRING === '1',
    revoked_key_status: revokedUse.status,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
