# WhatsApp Gateway: Engineering Status Quo and Design Handoff

Status: canonical implementation and design-engineering handoff

Updated: 2026-07-21

Repository: `/Users/markokraemer/Projects/kortix/whatsapp-gateway`

Branch: `main`

Local application: `http://localhost:8080`

Kortix production: `https://wag.kortix.cloud`

Scalar API reference: `http://localhost:8080/docs`

OpenAPI 3.1: `http://localhost:8080/openapi.json`

Generic agent skill: `http://localhost:8080/v1/skill.md`

Compact capability map: `http://localhost:8080/v1/capabilities.md`

This document describes what exists now. It is not a backlog. The backend, API, CLI, persistence, self-hosting stack, standard API-key model, routed Tailwind/shadcn web console, AWS deployment, CI/CD path, and real-device acceptance flow are implemented and verified.

## 1. Product contract

WhatsApp Gateway is an open-source, self-hosted managed Baileys service for developers and AI agents.

A user brings an existing WhatsApp account, creates a named connection, pairs it through WhatsApp Linked Devices, and gives an agent a connection-scoped API key. The agent can then use the account through REST, curl, `wag`, signed webhooks, and the credential-free `SKILL.md`.

The gateway supports:

- Multiple users and multiple WhatsApp connections in one deployment.
- Private allowlisted signup by default.
- One API key for one connection, recommended for agents.
- Account-wide keys for trusted administrative tooling.
- Persisted reads for chats, contacts, groups, messages, unread state, commands, and events.
- Durable idempotent mutations.
- 119 managed high-level Baileys socket actions.
- Signed, retrying, replayable webhooks.
- A browserless always-on worker model.
- VPS deployment with Docker Compose, PostgreSQL, Caddy, and automatic HTTPS.

The gateway links existing registered WhatsApp accounts. Buying a number and registering a fresh WhatsApp account are intentionally outside the current product boundary.

## 2. Non-negotiable architecture decisions

### No raw WhatsApp WebSocket proxy

Baileys owns a long-lived encrypted WhatsApp Web protocol connection. It is not a safe tenant JSON-RPC socket. The raw socket would bypass Signal/Noise state, auth mutation, durable commands, account authorization, leases, input normalization, auditability, and version insulation.

The gateway therefore owns every Baileys socket. External clients use:

1. Account and pairing control routes.
2. Persisted read routes.
3. Durable managed command routes.
4. Normalized events and signed webhooks.

### One number is one session, not one container

One WhatsApp connection equals one Baileys WebSocket session. A worker process multiplexes sessions. `WORKER_CAPACITY` defaults to 25. PostgreSQL leases guarantee that exactly one worker replica owns a connection at a time.

Approximate active capacity:

```text
worker replicas × WORKER_CAPACITY
```

Scale by adding worker replicas and sizing PostgreSQL. Do not deploy one Docker container per phone number.

### Prisma/PostgreSQL end to end

There is no Drizzle, SQLite, direct `pg` persistence, multi-file Baileys auth state, browser fleet, or WhatsApp Cloud API in this repository. Prisma and PostgreSQL are the only persistence layer.

## 3. Technology stack

- TypeScript and Node `>=22.19`.
- Hono `4.12.31`.
- React `19.2.4` and Vite `7.3.1`.
- Prisma `6.19.3` and PostgreSQL 17.
- Better Auth `1.6.23` with Prisma adapter.
- Better Auth API-key plugin `1.6.23`.
- Baileys `7.0.0-rc13`.
- Scalar Hono API Reference `0.11.11`.
- Zod, Undici, Pino, Vitest, ESLint, TypeScript, and tsup.

## 4. Runtime topology

One Docker image supports four roles:

### API

- Hono API and Better Auth.
- Account- and connection-scoped API-key authorization.
- Static React console.
- OpenAPI, Scalar, capability map, and skill.

### Baileys worker

- Acquires renewable per-account leases.
- Opens and owns long-lived Baileys sessions.
- Persists auth changes and synchronized WhatsApp state.
- Claims and executes durable commands.
- Emits normalized durable events.

### Webhook worker

- Claims pending/retrying deliveries.
- Revalidates DNS and blocks unsafe destinations.
- Signs requests with HMAC-SHA256.
- Retries with backoff/jitter.
- Dead-letters exhausted deliveries and supports replay.

### Migration job

- Runs `prisma migrate deploy` before long-running services start.

Local Compose exposes API `8080` and PostgreSQL `54329`. The production Compose stack keeps PostgreSQL private and places Caddy in front of the API on ports 80/443.

WhatsApp requires outbound internet only. There is no public WhatsApp-facing callback endpoint.

## 5. Persistent models

Better Auth:

- `User`, `Session`, `Account`, `Verification`, `Apikey`.

Gateway:

- `Tenant`: owner-backed workspace.
- `WhatsAppAccount`: named connection, phone/JID, status, pairing state, timestamps, errors.
- `WhatsAppAccountLease`: worker ownership and expiry.
- `WhatsAppAuthCredential`: encrypted Baileys credentials.
- `WhatsAppSignalKey`: encrypted per-key Signal state.
- `WhatsAppChat`: name, unread count, archive state, metadata.
- `WhatsAppContact`: name, notify name, phone, JID, metadata.
- `WhatsAppGroup`: subject, owner, participants, metadata.
- `WhatsAppMessage`: normalized searchable fields and full JSON-compatible payload.
- `AccountEventSequence`: per-account monotonic sequence.
- `InboundEvent`: durable ordered normalized event.
- `OutboundCommand`: idempotent durable mutation and terminal result.
- `WebhookEndpoint`: event and connection subscriptions plus encrypted signing secret.
- `WebhookDelivery`: attempts, response/error state, retry/dead-letter state.
- `AuditLog`: actor/resource/action history.

Six migrations currently deploy the schema, pairing expiry, idempotency, pairing-event secret scrubbing, and webhook connection scope.

## 6. Authentication, allowlist, and API keys

### Signup allowlist

Private mode is enabled by default:

```dotenv
AUTH_ALLOWLIST_ENABLED=true
ALLOWED_EMAILS=marko@kortix.ai
```

Allowlisted emails are normalized case-insensitively. Non-allowlisted users cannot sign up, create a session, or use an existing key. Multiple emails are comma-separated.

Open signup is an explicit operator choice:

```dotenv
AUTH_ALLOWLIST_ENABLED=false
```

### Standard API keys

The bespoke Agent Access endpoint and personalized skill were removed. API keys are standard Better Auth API keys managed by:

- `GET /v1/api-keys`
- `POST /v1/api-keys`
- `DELETE /v1/api-keys/{keyId}`

Only a signed-in browser owner can list, mint, or revoke keys.

Scopes:

- `connection`: exactly one `account_id`; recommended for an agent.
- `account`: every current and future connection owned by the user.

Keys begin with `wag_`, are hashed at rest, rate-limited, permission-aware, expirable, revocable, and returned in plaintext once. Programmatic requests accept `X-API-Key` and `Authorization: Bearer wag_...`.

Connection scope is enforced on account lists, account reads, persisted state, commands, events, mutations, webhook endpoints, and webhook deliveries. A connection key cannot create another connection or retarget a webhook. An out-of-scope account, command, endpoint, or delivery returns 404.

Pairing material is not returned by general status or durable events to an API key. It is available only to the signed-in owner or from an explicit authorized pairing operation.

## 7. Baileys lifecycle and pairing

The worker calls `makeWASocket` directly with encrypted Prisma-backed auth state. It uses Baileys' installed protocol behavior, identifies as Ubuntu Chrome, does not force online presence, and requests full history synchronization.

### QR

`POST /v1/accounts/{accountId}/pair/qr` starts a five-minute Linked Devices attempt and returns a 384×384 PNG data URL. Repeating the explicit operation during an active attempt returns the current unexpired QR instead of clearing it. The `wag pair qr` command retries the explicit operation and writes the PNG to disk.

### Phone code

`POST /v1/accounts/{accountId}/pair/code` normalizes the number and queues `requestPairingCode` after the transport is ready.

### Security

- General API-key status never contains `qr_data_url` or `pairing_code`.
- Pairing events retain lifecycle metadata only, never the QR/code.
- An upgrade migration removes QR/code fields from older durable events.
- Pairing expires after the configured TTL and clears unregistered auth state.
- Successful open stores JID/phone, clears pairing state, and marks connected.
- Logout clears linked-device auth.
- Recoverable closes become reconnecting and are leased again.

## 8. Synchronized WhatsApp state

The worker persists:

- Initial history and history status.
- Chat upserts, updates, deletes, locks, archive state, and unread counts.
- Contacts and LID mappings.
- Messages, updates, deletes, media refresh, reactions, receipts, and capping.
- Groups, participants, join requests, and member tags.
- Calls, presence, blocklist, labels, settings, and newsletter events.

Read filters:

- Chats: `q`, `unread`, `archived`.
- Contacts and groups: `q`.
- Messages: `chat_jid`, `unread`, `direction`, `status`, `type`, `sender_jid`, `since`, `before`, `limit`.
- Events: `account_id`, `type`, `after_sequence`, `since`, `limit`.

Unread message filtering resolves chats with a positive unread count and returns inbound messages from those chats.

`GET /v1/accounts/{accountId}/messages/{messageId}/media` downloads and decrypts stored image, video, audio, sticker, or document content while WhatsApp still hosts it. `?download=1` forces attachment disposition.

## 9. Durable command contract

Every external mutation is inserted into `OutboundCommand` before execution. The owning worker claims it and persists completion or failure.

Command-producing requests accept `Idempotency-Key` up to 200 characters. The uniqueness boundary is tenant plus key.

- Same key and same work returns the original command.
- Same key and different work returns HTTP 409.
- Payload comparison is structural, not object-key-order dependent.

The stable mutation response is:

```json
{
  "command_id": "cmd_...",
  "account_id": "wa_...",
  "type": "socket.action",
  "status": "pending | processing | completed | failed",
  "result": {},
  "error": null,
  "attempt_count": 1,
  "idempotency_key": "client-operation-id",
  "created_at": "...",
  "updated_at": "...",
  "completed_at": "..."
}
```

Pending/processing responses use HTTP 202. Completed and failed terminal command envelopes use HTTP 200 so clients can always recover the durable ID and inspect the business outcome.

`GET /v1/commands/{commandId}?wait_seconds=30` reads or long-polls the authorized command.

## 10. Managed Baileys surface

`GET /v1/baileys-actions` returns 119 registered operations with:

- Public action name.
- Exact installed Baileys socket method.
- Ordered argument description.
- Human description.
- Required resource/action permission.

`POST /v1/accounts/{accountId}/actions/{action}` accepts `{"args":[]}` and executes through the durable command path.

Coverage includes messages and rich content, receipts, history, presence, contacts, chats, profile, privacy, blocklist, groups, communities, newsletters/channels, WhatsApp Business, supported calls, bots, and account/app-state operations.

Tests inspect the installed Baileys TypeScript socket declaration and require every callable method to be classified as managed, dedicated pairing/logout behavior, or intentionally internal. Raw transport, protocol, crypto, relay, retry, and Signal-state mutation primitives are intentionally private.

## 11. Event and webhook system

There are 36 normalized event types. Every event has a gateway ID, tenant/account ID, per-account sequence, type, timestamp, and JSON data.

`GET /v1/webhook-event-types` is the event registry. Endpoint creation validates exact registry values.

Endpoint routes support list, create, detail, patch, and delete. Endpoints may target all tenant connections or explicit `account_ids`; a connection key is forced to its assigned connection. Delivery routes support connection-scoped filtered pagination, detail, and replay.

Subscriptions:

- Empty `event_types`: all current and future events.
- Non-empty `event_types`: exact selected events.

Signatures:

```text
input = timestamp + "." + raw_body
X-WhatsApp-Signature: v1=<HMAC-SHA256 hex>
```

The secret is returned once and encrypted at rest. Headers also include event ID, delivery ID, and timestamp.

Webhook URL security rejects credentials, unsafe protocols, loopback, private, link-local, and cloud-metadata targets. DNS is validated at creation and again during delivery; redirects are not followed.

## 12. Public REST surface

### System and discovery

- `GET /health`
- `GET /openapi.json`
- `GET /docs`
- `GET /v1/skill.md`
- `GET /v1/capabilities.md`
- `GET|POST /api/auth/*`

### API keys and catalogs

- `GET /v1/api-keys`
- `POST /v1/api-keys`
- `DELETE /v1/api-keys/{keyId}`
- `GET /v1/baileys-actions`
- `GET /v1/webhook-event-types`

### Accounts and pairing

- `GET /v1/accounts`
- `POST /v1/accounts`
- `GET /v1/accounts/{accountId}`
- `GET /v1/accounts/{accountId}/status`
- `POST /v1/accounts/{accountId}/pair/qr`
- `POST /v1/accounts/{accountId}/pair/code`
- `DELETE /v1/accounts/{accountId}/session`

### Reads and events

- `GET /v1/accounts/{accountId}/chats`
- `GET /v1/accounts/{accountId}/contacts`
- `GET /v1/accounts/{accountId}/groups`
- `GET /v1/accounts/{accountId}/messages`
- `GET /v1/accounts/{accountId}/messages/{messageId}/media`
- `GET /v1/events`
- `GET /v1/commands/{commandId}`

### Durable mutations

- `POST /v1/accounts/{accountId}/actions/{action}`
- `POST /v1/accounts/{accountId}/messages`
- `POST /v1/accounts/{accountId}/groups`
- `PATCH /v1/accounts/{accountId}/groups/{groupId}`
- `POST /v1/accounts/{accountId}/groups/{groupId}/participants`
- `DELETE /v1/accounts/{accountId}/groups/{groupId}/participants/{participantId}`

Convenience routes and the generic action route share the same command implementation and stable result contract.

### Webhooks

- `GET /v1/webhook-endpoints`
- `POST /v1/webhook-endpoints`
- `GET /v1/webhook-endpoints/{endpointId}`
- `PATCH /v1/webhook-endpoints/{endpointId}`
- `DELETE /v1/webhook-endpoints/{endpointId}`
- `GET /v1/webhook-deliveries`
- `GET /v1/webhook-deliveries/{deliveryId}`
- `POST /v1/webhook-deliveries/{deliveryId}/replay`

The OpenAPI test reads every explicit Hono route and fails when a method/path is missing from the document.

## 13. `wag` CLI

The CLI is implemented in `src/cli.ts`, built to `dist/server/cli.js`, shipped with a Node shebang, and exposed as the `wag` npm bin.

Configuration:

```bash
export WHATSAPP_GATEWAY_URL=https://whatsapp.example.com
export WHATSAPP_GATEWAY_API_KEY=wag_...
```

Implemented commands:

```text
wag auth status
wag accounts list
wag accounts status <account>
wag pair qr <account> --output pairing.png
wag pair code <account> --phone <e164>
wag chats list <account> --unread --search <text>
wag messages list <account> --chat <jid> --unread --limit <n>
wag messages send <account> --to <phone-or-jid> --text <text>
wag messages read <account> --message <gateway-message-id>
wag groups list <account> --search <text>
wag groups create <account> --subject <name> --participant <phone>...
wag actions list --category privacy
wag actions run <account> <action> --args '<json-array>'
wag commands get <command-id> --wait
wag events tail <account> --type message.created --once
wag webhooks list
```

Global options are `--base-url`, `--api-key`, and `--json`. Command mutations accept `--idempotency-key`. The CLI never implements Baileys itself and never prints the API key.

## 14. Skill and contract discovery

`GET /v1/skill.md` and `skills/whatsapp-gateway/SKILL.md` are credential-free. They teach an agent to:

1. Load `/v1/capabilities.md` for a compact route map.
2. Load `/openapi.json` for exact schemas.
3. Load `/v1/baileys-actions` for installed operations.
4. Select an authorized connection.
5. Read before acting when a destination is ambiguous.
6. Use idempotency and poll durable commands.
7. Keep keys, webhook secrets, and pairing material secret.

`scripts/validate-skill.mjs` validates portable skill frontmatter without relying on a machine-specific Codex path.

## 15. Self-hosting and release assets

Included:

- `Dockerfile`: shared production image.
- `docker-compose.yml`: local PostgreSQL/API/worker/webhook/migration stack.
- `docker-compose.production.yml`: private PostgreSQL plus Caddy HTTPS stack.
- `.env.example`: local configuration.
- `.env.production.example`: VPS configuration contract.
- `deploy/Caddyfile`: automatic TLS and security headers.
- `scripts/deploy-vps.sh`: validated deploy/update command.
- `.github/workflows/ci.yml`: lint, types, tests, skill, build, packaging, Compose validation.
- `.github/workflows/container.yml`: GHCR container build/publish workflow.
- `LICENSE`: MIT.
- `README.md`: operator, API, CLI, security, webhook, scaling, and development guide.

Production deployment requires DNS, ports 80/443, generated secrets, and matching `POSTGRES_PASSWORD`/`DATABASE_URL`. PostgreSQL and Caddy data use named volumes. API, worker, webhook, and Caddy services restart automatically.

Back up the PostgreSQL database/volume and `.env`. Losing `ENCRYPTION_KEY` makes stored linked-device auth unrecoverable.

## 16. Web console

The web console is a routed React application rebuilt with Tailwind CSS, shadcn/Radix-style primitives, Lucide icons, TanStack Query, React Hook Form, Zod, and Sonner.

Implemented routes:

```text
/auth/sign-in
/auth/sign-up
/app/numbers
/app/numbers/new
/app/numbers/:accountId/overview
/app/numbers/:accountId/pairing
/app/numbers/:accountId/chats
/app/numbers/:accountId/contacts
/app/numbers/:accountId/groups
/app/numbers/:accountId/messages
/app/numbers/:accountId/actions
/app/webhooks
/app/webhooks/new
/app/webhooks/:endpointId/overview
/app/webhooks/:endpointId/deliveries
/app/api-keys
/app/developer
```

Implemented UX outcomes:

- Entire connection rows are navigable links with URL-persisted selection, fixing the original non-clickable number behavior.
- Pairing has preparation, current QR/code, expiry countdown, retry, error, and connected states.
- Webhook creation explicitly distinguishes all current/future events from selected events.
- Event picker is searchable/categorized and sends exact `event_types`.
- API keys have scope, expiry, permission presets/matrix, one-time secret dialog, and revoke confirmation.
- Webhook signing secrets use a blocking one-time acknowledgement dialog, never a toast.
- Chats/messages support search, unread filters, pagination, recipient resolution, and durable command feedback.
- Groups support create, subject/description update, and participant administration with confirmation.
- Action explorer loads the dynamic catalog, searches/filters it, validates JSON args, and renders the command envelope.
- Developer view links OpenAPI, Scalar, skill, capabilities, CLI setup, curl auth, and webhook verification.
- Production SPA fallback makes deep links and hard refreshes resolve to the client shell.
- Messages include a media preview/download flow backed by the authenticated media route.

Source layout:

```text
src/web/
  app.tsx
  main.tsx
  routes.tsx
  components/
  lib/
  features/auth/
  features/numbers/
  features/pairing/
  features/chats/
  features/contacts/
  features/messages/
  features/groups/
  features/api-keys/
  features/webhooks/
  features/baileys-actions/
  features/developer/
```

## 18. Verification completed

Green local gates:

- `pnpm lint`.
- `pnpm typecheck`.
- `pnpm test`: 6 files, 27 tests.
- `pnpm skill:validate`.
- `pnpm build` for server, CLI, and web.
- `npm pack --dry-run` includes server, CLI, web, Prisma migrations, skill, README, and license.
- Production Compose configuration validation.
- Shell syntax validation for deploy and smoke scripts.

Green live Docker proof:

- PostgreSQL healthy with all six migrations applied.
- API, worker, and webhook roles healthy.
- `/health`, `/openapi.json`, `/docs`, skill, capabilities, catalogs, and route coverage.
- Non-allowlisted signup rejected.
- `marko@kortix.ai` is the sole production allowlisted owner.
- Connection- and account-scoped API keys minted and enforced across WhatsApp state, commands, and webhooks.
- Cross-connection reads and command reads denied to a connection key.
- Owner-only API-key management enforced.
- The existing user-owned linked-device state was re-encrypted for the production key and migrated without exposing either key.
- Production reconnected the real `Marko Main` account and persisted its phone/JID.
- Status/events do not leak pairing credentials.
- 119 managed Baileys actions discovered.
- Idempotent retry returns the same command; conflicting reuse returns 409.
- Durable command ID/result authorization proven.
- Webhook event validation and endpoint create/detail/patch/delete proven.
- Connection-scoped pairing event created a scoped delivery without retaining the QR.
- API-key revocation immediately returns 401.
- Curl smoke passes.
- Expanded TypeScript E2E passes.
- Daily backup cron installed and a real encrypted S3 Postgres dump verified.
- GitHub OIDC, immutable GHCR image publish, SSM deployment, and `/health.release` SHA proof verified.
- Hosted signed webhook delivered HTTP 204 in one attempt; HMAC, event ID, and delivery ID all matched.
- Hosted connection-scoped and account-scoped keys were enforced independently.
- Hosted real self-message completed in one attempt; identical idempotent retry returned the same command ID.
- Hosted real group creation and cleanup completed.

Green live CLI proof:

- Auth status and one-connection scope.
- Account list/status.
- Privacy action discovery.
- Event tail with no pairing secrets.
- Webhook list.
- Real hosted message send, command wait, message read, group create, group cleanup, event tail, and webhook inspection.

## 19. Release state

The source is public at `https://github.com/kortix-ai/whatsapp-gateway`, GitHub CI and immutable deployment automation are green, `ghcr.io/kortix-ai/whatsapp-gateway:main` is anonymously pullable, and production runs at `https://wag.kortix.cloud` on the AWS inventory documented in `README.md`.

The `v0.1.0` GitHub release carries an npm-compatible prebuilt `wag` package and produces immutable GHCR semver tags. Direct npm registry publication is optional and is the only distribution channel not configured; the release tarball and source install are already usable.

## 20. Operator flow

1. Open `https://wag.kortix.cloud` (or `http://localhost:8080` when self-hosting).
2. Sign in with an email present in `ALLOWED_EMAILS`; production currently permits only `marko@kortix.ai`.
3. Create or select the intended named connection.
4. Click QR pairing.
5. On the phone open WhatsApp → Settings → Linked Devices → Link a Device.
6. Scan the QR before the five-minute expiry.
7. Wait for the console/API status to become `connected`.
8. Mint a connection-scoped key for that connection.
9. Prefer a connection-scoped key for an agent; use an account key only for trusted tooling that must see all present and future connections.
10. Run `wag auth status`, `wag accounts status <id>`, a read action, a test message, and any approved group action.

## 21. Source-of-truth file map

- `README.md`: public operator/developer guide.
- `STATUS_QUO.md`: this engineering/design handoff.
- `package.json`: package, scripts, and `wag` bin.
- `docker-compose.yml`: local runtime.
- `docker-compose.production.yml`: VPS runtime.
- `deploy/Caddyfile`: HTTPS reverse proxy.
- `prisma/schema.prisma` and `prisma/migrations/`: durable schema.
- `src/api/app.ts`: Hono routes and behavior.
- `src/api/openapi.ts`: Scalar/OpenAPI contract.
- `src/auth/auth.ts`: Better Auth and permission registry.
- `src/auth/allowlist.ts`: private/open-signup policy.
- `src/auth/middleware.ts`: session/key actor and connection scope.
- `src/baileys/auth-state.ts`: encrypted Prisma-backed auth.
- `src/baileys/session.ts`: socket lifecycle, synchronization, command execution.
- `src/baileys/actions.ts`: 119 managed actions.
- `src/worker/`: session leases and supervision.
- `src/services/commands.ts`: idempotency and command envelopes.
- `src/services/events.ts`: ordered events and webhook fan-out.
- `src/services/event-types.ts`: normalized event registry.
- `src/webhooks/`: URL security and signed dispatcher.
- `src/cli.ts`: thin public API CLI.
- `src/skill.ts`: served skill and compact capabilities.
- `skills/whatsapp-gateway/SKILL.md`: installable skill.
- `src/web/app.tsx`: authenticated route tree.
- `src/web/components/`: shared layout and shadcn/Radix-style primitives.
- `src/web/features/`: auth, numbers, pairing, chats, contacts, messages, groups, actions, API keys, webhooks, and developer surfaces.
- `src/web/lib/`: API client, Better Auth hooks, query client, formatting, status, and theme utilities.
- `src/web/styles.css`: Tailwind tokens and application visual layer.
- `scripts/smoke.sh`: curl black-box flow.
- `src/scripts/e2e.ts`: expanded black-box flow.

## 22. Engineering invariants for every later change

- Prisma/PostgreSQL remain the durable source of truth.
- Auth credentials and Signal keys remain encrypted.
- Exactly one worker lease owns one WhatsApp session.
- External mutations remain authenticated, connection-scoped, permission-checked, durable, and idempotent.
- Incoming state is persisted before agents consume it.
- Pairing credentials never enter durable events, webhooks, logs, status responses to agent keys, or generic skills.
- Webhooks remain signed, retrying, replayable, and SSRF-protected.
- Raw protocol, socket, relay, retry, and cryptographic primitives remain private.
- The CLI remains a thin API client.
- OpenAPI, action registry, capability map, skill, CLI, and implementation must not drift.
- A UI control is complete only when its authenticated request, payload, persisted/read-back state, and visible result are proven.
