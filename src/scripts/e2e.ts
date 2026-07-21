import { randomUUID } from 'node:crypto';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const email = process.env.E2E_EMAIL ?? 'marko@kortix.ai';
  const password = process.env.E2E_PASSWORD ?? 'correct-horse-battery-staple';
  const deniedEmail = `denied-${randomUUID()}@example.com`;
  const denied = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Denied', email: deniedEmail, password }),
  });
  assert(denied.status >= 400, `Non-allowlisted signup unexpectedly returned ${denied.status}`);
  const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Gateway E2E', email, password }),
  });
  const authResponse = signup.status === 200 ? signup : await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  if (authResponse.status !== 200) throw new Error(`Authentication failed: ${authResponse.status} ${await authResponse.text()}`);
  const cookie = authResponse.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
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
  const createSecondAccount = await authenticated('/v1/accounts', {
    method: 'POST', body: JSON.stringify({ display_name: 'E2E second number' }),
  });
  assert(createSecondAccount.status === 201, `Second account creation failed: ${createSecondAccount.status}`);
  const secondAccount = await createSecondAccount.json() as { id: string };

  const mint = await authenticated('/v1/api-keys', {
    method: 'POST', body: JSON.stringify({ name: 'E2E connection key', scope: 'connection', account_id: account.id }),
  });
  if (mint.status !== 201) throw new Error(`API-key mint failed: ${mint.status} ${await mint.text()}`);
  const access = await mint.json() as { key: string; id: string; scope: string; account_id: string };
  assert(access.key.startsWith('wag_'), 'API key has the wrong prefix');
  assert(access.scope === 'connection' && access.account_id === account.id, 'Connection key scope is incorrect');

  const mintAccountKey = await authenticated('/v1/api-keys', {
    method: 'POST', body: JSON.stringify({ name: 'E2E account key', scope: 'account' }),
  });
  assert(mintAccountKey.status === 201, `Account API-key mint failed: ${mintAccountKey.status}`);
  const accountAccess = await mintAccountKey.json() as { key: string; id: string; scope: string; account_id: null };
  assert(accountAccess.key.startsWith('wag_') && accountAccess.scope === 'account' && accountAccess.account_id === null, 'Account key scope is incorrect');

  const list = await fetch(`${baseUrl}/v1/accounts`, { headers: { 'x-api-key': access.key } });
  if (list.status !== 200) throw new Error(`API-key authentication failed: ${list.status} ${await list.text()}`);
  const listed = await list.json() as { data: Array<{ id: string }> };
  assert(listed.data.length === 1 && listed.data[0]?.id === account.id, 'Account scope was not enforced');
  const deniedSecondAccount = await fetch(`${baseUrl}/v1/accounts/${secondAccount.id}`, { headers: { 'x-api-key': access.key } });
  assert(deniedSecondAccount.status === 404, `Connection key escaped its account scope: ${deniedSecondAccount.status}`);
  const accountWideList = await fetch(`${baseUrl}/v1/accounts`, { headers: { 'x-api-key': accountAccess.key } });
  const accountWideAccounts = await accountWideList.json() as { data: Array<{ id: string }> };
  assert(accountWideList.status === 200 && accountWideAccounts.data.some(({ id }) => id === account.id) && accountWideAccounts.data.some(({ id }) => id === secondAccount.id), 'Account-wide key did not include both connections');
  const apiKeyCannotManageKeys = await fetch(`${baseUrl}/v1/api-keys`, { headers: { 'x-api-key': access.key } });
  assert(apiKeyCannotManageKeys.status === 403, `API key unexpectedly managed API keys: ${apiKeyCannotManageKeys.status}`);
  const scopedKeyCannotCreateAccount = await fetch(`${baseUrl}/v1/accounts`, {
    method: 'POST', headers: { 'x-api-key': access.key, 'content-type': 'application/json' },
    body: JSON.stringify({ display_name: 'Scope escape' }),
  });
  assert(scopedKeyCannotCreateAccount.status === 403, `Connection key created another connection: ${scopedKeyCannotCreateAccount.status}`);
  const createPairingWebhook = await fetch(`${baseUrl}/v1/webhook-endpoints`, {
    method: 'POST', headers: { 'x-api-key': access.key, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/whatsapp-gateway-connection-e2e', description: 'Connection endpoint', event_types: ['pairing.qr.updated'] }),
  });
  assert(createPairingWebhook.status === 201, `Connection webhook creation failed: ${createPairingWebhook.status}`);
  const pairingWebhook = await createPairingWebhook.json() as { id: string; accountIds: string[] };
  assert(pairingWebhook.accountIds.length === 1 && pairingWebhook.accountIds[0] === account.id, 'Connection webhook scope was not forced');

  const skill = await fetch(`${baseUrl}/v1/skill.md`);
  const skillText = await skill.text();
  assert(skill.status === 200 && skillText.includes('name: whatsapp-gateway') && !skillText.includes(access.key), 'Generic credential-free skill endpoint failed');
  const capabilities = await fetch(`${baseUrl}/v1/capabilities.md`);
  assert(capabilities.status === 200 && (await capabilities.text()).includes('/v1/commands/{commandId}'), 'Capability endpoint failed');

  const actionCatalog = await fetch(`${baseUrl}/v1/baileys-actions`, { headers: { 'x-api-key': access.key } });
  assert(actionCatalog.status === 200, `Baileys action catalog failed: ${actionCatalog.status}`);
  const actions = await actionCatalog.json() as { data: Array<{ name: string; method: string }> };
  assert(actions.data.length > 90 && actions.data.some((action) => action.name === 'privacy.fetch'), 'Baileys action catalog is incomplete');
  const eventTypesResponse = await fetch(`${baseUrl}/v1/webhook-event-types`, { headers: { 'x-api-key': access.key } });
  const eventTypes = await eventTypesResponse.json() as { data: string[] };
  assert(eventTypesResponse.status === 200 && eventTypes.data.includes('message.created'), 'Webhook event catalog is incomplete');
  const eventsResponse = await fetch(`${baseUrl}/v1/events?account_id=${account.id}&after_sequence=0`, { headers: { 'x-api-key': access.key } });
  assert(eventsResponse.status === 200, `Event read API failed: ${eventsResponse.status}`);

  if (process.env.E2E_PAIRING === '1') {
    const pair = await authenticated(`/v1/accounts/${account.id}/pair/qr`, { method: 'POST', body: '{}' });
    const pairing = await pair.json() as { qr_data_url?: string; status?: string };
    assert(pair.status === 200 && pairing.qr_data_url?.startsWith('data:image/png;base64,'), 'Real Baileys QR pairing did not produce an image');
    const repeatedPair = await authenticated(`/v1/accounts/${account.id}/pair/qr`, { method: 'POST', body: '{}' });
    const repeatedPairing = await repeatedPair.json() as { qr_data_url?: string };
    assert(repeatedPair.status === 200 && repeatedPairing.qr_data_url === pairing.qr_data_url, 'Repeated pairing did not reuse the active QR');
    const scopedStatus = await fetch(`${baseUrl}/v1/accounts/${account.id}/status`, { headers: { 'x-api-key': access.key } });
    const scopedStatusBody = await scopedStatus.json() as Record<string, unknown>;
    assert(scopedStatus.status === 200 && !('qr_data_url' in scopedStatusBody) && !('pairing_code' in scopedStatusBody), 'Read-only agent key leaked pairing credentials');
    const pairingEventsResponse = await fetch(`${baseUrl}/v1/events?account_id=${account.id}&type=pairing.qr.updated`, { headers: { 'x-api-key': access.key } });
    const pairingEvents = await pairingEventsResponse.json() as { data: Array<{ data: Record<string, unknown> }> };
    assert(pairingEventsResponse.status === 200 && pairingEvents.data.every((event) => !('qr_data_url' in event.data) && !('code' in event.data)), 'Durable pairing events leaked pairing credentials');
    const pairingDeliveriesResponse = await fetch(`${baseUrl}/v1/webhook-deliveries?endpoint_id=${pairingWebhook.id}`, { headers: { 'x-api-key': access.key } });
    const pairingDeliveries = await pairingDeliveriesResponse.json() as { data: Array<{ endpointId: string; event: { accountId: string; type: string } }> };
    assert(pairingDeliveriesResponse.status === 200 && pairingDeliveries.data.some((delivery) => delivery.endpointId === pairingWebhook.id && delivery.event.accountId === account.id && delivery.event.type === 'pairing.qr.updated'), 'Connection-scoped webhook delivery was not created');

    const pairSecond = await authenticated(`/v1/accounts/${secondAccount.id}/pair/qr`, { method: 'POST', body: '{}' });
    assert(pairSecond.status === 200, `Second Baileys QR pairing failed: ${pairSecond.status}`);

    const idempotencyKey = `e2e-${randomUUID()}`;
    const invalidMessage = JSON.stringify({ to: 'not-a-number', text: 'idempotent failure' });
    const firstCommandResponse = await fetch(`${baseUrl}/v1/accounts/${account.id}/messages`, {
      method: 'POST',
      headers: { 'x-api-key': access.key, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: invalidMessage,
    });
    assert([200, 202].includes(firstCommandResponse.status), `First durable command failed at HTTP level: ${firstCommandResponse.status}`);
    const firstCommand = await firstCommandResponse.json() as { command_id: string; status: string; error?: string | null };
    assert(firstCommand.command_id?.startsWith('cmd_'), 'Durable command did not return a command ID');

    const repeatedCommandResponse = await fetch(`${baseUrl}/v1/accounts/${account.id}/messages`, {
      method: 'POST',
      headers: { 'x-api-key': access.key, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: invalidMessage,
    });
    const repeatedCommand = await repeatedCommandResponse.json() as { command_id: string };
    assert([200, 202].includes(repeatedCommandResponse.status) && repeatedCommand.command_id === firstCommand.command_id, 'Idempotent retry did not return the original command');

    const conflictingCommand = await fetch(`${baseUrl}/v1/accounts/${account.id}/messages`, {
      method: 'POST',
      headers: { 'x-api-key': access.key, 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ to: 'not-a-number', text: 'different work' }),
    });
    assert(conflictingCommand.status === 409, `Idempotency conflict returned ${conflictingCommand.status}`);

    const commandResult = await fetch(`${baseUrl}/v1/commands/${firstCommand.command_id}?wait_seconds=1`, { headers: { 'x-api-key': access.key } });
    const commandResultBody = await commandResult.json() as { command_id?: string; status?: string; id?: string };
    assert(commandResult.status === 200 && commandResultBody.command_id === firstCommand.command_id && !('id' in commandResultBody), `Command result envelope failed: ${commandResult.status}`);

    const secondCommandResponse = await authenticated(`/v1/accounts/${secondAccount.id}/messages`, {
      method: 'POST',
      headers: { 'idempotency-key': `e2e-${randomUUID()}` },
      body: invalidMessage,
    });
    assert([200, 202].includes(secondCommandResponse.status), `Second-account command failed at HTTP level: ${secondCommandResponse.status}`);
    const secondCommand = await secondCommandResponse.json() as { command_id: string };
    const scopedCommandLookup = await fetch(`${baseUrl}/v1/commands/${secondCommand.command_id}`, { headers: { 'x-api-key': access.key } });
    assert(scopedCommandLookup.status === 404, `Connection key read another account command: ${scopedCommandLookup.status}`);
    const accountCommandLookup = await fetch(`${baseUrl}/v1/commands/${secondCommand.command_id}`, { headers: { 'x-api-key': accountAccess.key } });
    assert(accountCommandLookup.status === 200, `Account key could not read a tenant command: ${accountCommandLookup.status}`);
  }

  const invalidWebhook = await authenticated('/v1/webhook-endpoints', {
    method: 'POST', body: JSON.stringify({ url: 'https://example.com/whatsapp-gateway-e2e', event_types: ['not.a.real.event'] }),
  });
  assert(invalidWebhook.status === 400, `Invalid webhook event returned ${invalidWebhook.status}`);
  const retargetConnectionWebhook = await fetch(`${baseUrl}/v1/webhook-endpoints/${pairingWebhook.id}`, {
    method: 'PATCH', headers: { 'x-api-key': access.key, 'content-type': 'application/json' },
    body: JSON.stringify({ account_ids: [secondAccount.id] }),
  });
  assert(retargetConnectionWebhook.status === 403, `Connection key retargeted its webhook: ${retargetConnectionWebhook.status}`);
  const deleteConnectionWebhook = await fetch(`${baseUrl}/v1/webhook-endpoints/${pairingWebhook.id}`, {
    method: 'DELETE', headers: { 'x-api-key': access.key },
  });
  assert(deleteConnectionWebhook.status === 204, `Connection webhook deletion failed: ${deleteConnectionWebhook.status}`);
  const createWebhook = await authenticated('/v1/webhook-endpoints', {
    method: 'POST', body: JSON.stringify({
      url: 'https://example.com/whatsapp-gateway-e2e', description: 'E2E endpoint',
      event_types: ['message.created'], account_ids: [secondAccount.id],
    }),
  });
  if (createWebhook.status !== 201) throw new Error(`Webhook creation failed: ${createWebhook.status} ${await createWebhook.text()}`);
  const webhook = await createWebhook.json() as { id: string; secret: string };
  assert(webhook.secret.startsWith('whsec_'), 'Webhook did not return its one-time secret');
  const crossScopeWebhookDetail = await fetch(`${baseUrl}/v1/webhook-endpoints/${webhook.id}`, { headers: { 'x-api-key': access.key } });
  assert(crossScopeWebhookDetail.status === 404, `Connection key read another connection webhook: ${crossScopeWebhookDetail.status}`);
  const webhookDetailResponse = await authenticated(`/v1/webhook-endpoints/${webhook.id}`);
  const webhookDetail = await webhookDetailResponse.json() as Record<string, unknown>;
  assert(webhookDetailResponse.status === 200 && !('secret' in webhookDetail), 'Webhook detail leaked its signing secret');
  const patchWebhook = await authenticated(`/v1/webhook-endpoints/${webhook.id}`, {
    method: 'PATCH', body: JSON.stringify({ description: 'Updated E2E endpoint', enabled: false, event_types: ['connection.opened'] }),
  });
  const patchedWebhook = await patchWebhook.json() as { description: string; enabled: boolean; eventTypes: string[] };
  assert(patchWebhook.status === 200 && patchedWebhook.description === 'Updated E2E endpoint' && patchedWebhook.enabled === false && patchedWebhook.eventTypes[0] === 'connection.opened', 'Webhook patch failed');
  const deleteWebhook = await authenticated(`/v1/webhook-endpoints/${webhook.id}`, { method: 'DELETE' });
  assert(deleteWebhook.status === 204, `Webhook deletion failed: ${deleteWebhook.status}`);

  const keyListResponse = await authenticated('/v1/api-keys');
  assert(keyListResponse.status === 200, `API-key list failed: ${keyListResponse.status}`);
  const keyList = await keyListResponse.json() as { data: Array<{ id: string }> };
  const createdKey = keyList.data.find((key) => key.id === access.id) ?? keyList.data[0];
  assert(createdKey, 'Created API key was not listed');
  const revoke = await authenticated(`/v1/api-keys/${createdKey.id}`, { method: 'DELETE' });
  assert(revoke.status === 204, `API-key revocation failed: ${revoke.status}`);
  const revokedUse = await fetch(`${baseUrl}/v1/accounts`, { headers: { 'x-api-key': access.key } });
  assert(revokedUse.status === 401, `Revoked API key returned ${revokedUse.status}`);
  const revokeAccountKey = await authenticated(`/v1/api-keys/${accountAccess.id}`, { method: 'DELETE' });
  assert(revokeAccountKey.status === 204, `Account API-key revocation failed: ${revokeAccountKey.status}`);

  console.log(JSON.stringify({
    ok: true,
    signup_status: authResponse.status,
    account_status: createAccount.status,
    key_prefix: access.key.slice(0, 4),
    scoped_accounts: listed.data.length,
    account_scoped_accounts: accountWideAccounts.data.length,
    allowlist_denial_status: denied.status,
    baileys_actions: actions.data.length,
    pairing_checked: process.env.E2E_PAIRING === '1',
    revoked_key_status: revokedUse.status,
    webhook_crud: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
