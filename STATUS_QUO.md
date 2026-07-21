# WhatsApp Gateway: Engineering Status Quo and Product Refactor Handoff

Status: canonical handoff

Repository: `/Users/markokraemer/Projects/kortix/whatsapp-gateway`

Current branch: `main`

Baseline implementation commit: `a200625`

Local application: `http://localhost:8080`

Scalar API reference: `http://localhost:8080/docs`

OpenAPI 3.1: `http://localhost:8080/openapi.json`

Generic skill: `http://localhost:8080/v1/skill.md`

This document is the complete handoff for the current engineering implementation and the next design-engineering/API simplification pass. Read it before changing the gateway.

## 1. Product goal

The product is managed WhatsApp for agents.

A user brings an existing, already-registered WhatsApp account, links it through WhatsApp’s Linked Devices flow, and receives a reliable API/CLI surface through which an agent can operate that WhatsApp account as a full personal WhatsApp client.

The target agent must be able to:

- List connected WhatsApp accounts.
- Inspect connection and pairing state.
- List chats and identify unread chats.
- List messages, including recent and unread inbound messages.
- Search/resolve contacts, chats, groups, phone numbers, and JIDs before acting.
- Send text and every richer WhatsApp message type supported by Baileys.
- Mark messages read and send receipts.
- Create and manage groups.
- Manage contacts, chats, presence, profile, privacy, blocklist, communities, newsletters/channels, WhatsApp Business features, and supported call actions.
- Receive new messages and all other normalized WhatsApp events immediately.
- Perform multi-step workflows through curl, a future CLI, or another agent runtime.
- Survive API, worker, and webhook-process restarts without losing the linked device or durable work.

Buying a phone number and registering a brand-new WhatsApp account are explicitly future work. The current system only links an existing registered WhatsApp account.

## 2. Important product decisions for the next pass

### Remove the bespoke “agent access” concept

The current `POST /v1/agent-access` endpoint mints an account-scoped Better Auth key and returns a personalized `SKILL.md`. This abstraction is confusing and should be removed from the target public product.

Target behavior:

- API keys are simply API keys.
- Users create, scope, expire, inspect, and revoke them from the API Keys page.
- Better Auth’s API-key plugin remains the authentication implementation.
- The full plaintext key is shown once.
- The generic skill never embeds a credential.
- A user gives an agent the generic skill plus a scoped key through their normal secret-delivery mechanism.
- Remove `POST /v1/agent-access` after the UI, tests, OpenAPI, smoke flow, and skill no longer depend on it.
- Replace the current agent-access UI with a normal “Create API key” flow.

Do not remove API-key authentication itself. Programmatic agent access remains a core requirement.

### Make the generic skill token-efficient and contract-driven

The generic `GET /v1/skill.md` should explain how to operate the gateway without duplicating a huge stale manual API reference.

It should point an agent to:

1. `GET /openapi.json` for the complete REST contract.
2. `GET /v1/baileys-actions` for every managed Baileys action, its exact method, argument order, description, and required permission.
3. The durable-command result contract.
4. The normalized event/webhook contract.
5. Safety rules for recipients, groups, disconnects, and secrets.

Recommended token-friendly additions:

- `GET /v1/capabilities.md`: compact Markdown grouped by account reads, commands, webhooks, and action categories.
- Or `GET /v1/capabilities.json`: a compact machine-readable projection derived from OpenAPI plus the action registry.
- Generate these representations from source-of-truth registries. Do not maintain a second handwritten route list.

The skill should teach the workflow, not carry a secret or repeat every OpenAPI schema.

### Do not proxy the raw WhatsApp WebSocket

Baileys opens a long-lived encrypted WhatsApp Web protocol WebSocket. That socket is not a general JSON-RPC API that can be safely forwarded to a tenant or agent.

Raw proxying would expose or bypass:

- WhatsApp protocol nodes and low-level transport frames.
- Signal/Noise cryptographic state.
- Authentication credential mutation.
- Retry and message-key state.
- The one-worker lease invariant.
- Tenant/account authorization.
- Durable command recording and recovery.
- Input normalization and JID handling.
- Auditability and permission enforcement.
- Upgrade insulation when Baileys/WhatsApp changes.

The gateway must own the Baileys socket. External clients should use gateway RPC/REST and normalized gateway events.

If streaming is needed, add a gateway-owned SSE or WebSocket endpoint that emits normalized, persisted `InboundEvent` records. Do not expose raw Baileys/WhatsApp frames.

### Keep reads, control plane, and commands distinct

One generic action endpoint can cover most live Baileys operations, but it cannot replace the whole API.

The target API has four necessary planes:

1. Control plane: create/link/disconnect accounts and inspect connection state.
2. Read model: query persisted chats, contacts, groups, messages, unread state, events, and command results even when the WhatsApp socket is temporarily offline.
3. Command plane: durably invoke managed Baileys operations.
4. Event plane: signed webhooks and a future normalized stream/poll surface.

The read model is essential. Baileys is event-driven and does not provide a durable “list all local messages/unread history” server database for an external agent. The gateway persists this state in PostgreSQL and exposes it through query endpoints.

### Consolidate duplicate mutation routes carefully

The current API has both dedicated convenience mutations and the generic managed-action endpoint.

Examples:

- `POST /v1/accounts/{accountId}/messages` overlaps `messages.send`.
- `POST /v1/accounts/{accountId}/groups` overlaps `groups.create`.
- Group update/participant routes overlap managed group actions.

Target recommendation:

- Keep the generic durable action command surface as the complete mutation/control escape hatch.
- Keep persisted read routes.
- Keep account/pairing/session routes.
- Keep webhook routes.
- Deprecate overlapping convenience mutations only after the CLI, skill, examples, and E2E tests use the managed-action surface successfully.
- It is acceptable to retain a very small set of ergonomic aliases such as `messages.send` if they materially improve common curl use. They must delegate to the same command implementation and share one result contract.
- Never keep two implementations of the same WhatsApp operation.

## 3. Current stack

- TypeScript.
- Node `>=22.19`.
- Hono `4.12.31`.
- React `19.2.4`.
- Vite `7.3.1`.
- PostgreSQL 17.
- Prisma `6.19.3` end to end.
- Better Auth `1.6.23` with Prisma adapter.
- Better Auth API-key plugin `1.6.23`.
- Baileys `7.0.0-rc13`.
- Scalar Hono API Reference `0.11.11`.
- Zod `4.3.6`.
- Undici for secured webhook delivery.
- Vitest, ESLint, TypeScript, and tsup.

There is no Drizzle, SQLite, direct `pg`, browser automation process, or WhatsApp Cloud API in this project.

## 4. Runtime architecture

One Docker image supports four roles:

### API role

- Hono REST API.
- Better Auth routes and browser session handling.
- API-key authorization.
- React/Vite production assets.
- OpenAPI document.
- Scalar reference.
- Generic skill.

### Worker role

- Owns long-lived Baileys WebSocket sessions.
- Acquires one renewable PostgreSQL lease per WhatsApp account.
- Capacity is configurable; local default is 25 accounts per worker.
- Polls for accounts that are pairing, reconnecting, or have stored credentials.
- Starts/stops Baileys sessions as leases are gained/lost.
- Processes durable outbound commands for owned accounts.
- Persists incoming WhatsApp state and normalized events.

### Webhook role

- Claims pending/retrying webhook deliveries.
- Signs each request.
- Retries with exponential backoff and jitter.
- Marks permanent exhaustion as `dead_letter`.
- Recovers deliveries left in `processing` by a crashed worker.
- Revalidates destination DNS at delivery time.

### Migration role

- Runs `prisma migrate deploy` before the application roles start.

### Local Docker topology

- API: host port `8080`.
- PostgreSQL: host port `54329`.
- Persistent named PostgreSQL volume.
- API, worker, and webhooks restart unless stopped.
- No inbound WhatsApp-facing endpoint is required; Baileys only needs outbound internet access.

## 5. Persistence and tenancy

PostgreSQL is the durable source of truth.

### Better Auth models

- `User`
- `Session`
- `Account`
- `Verification`
- `Apikey`

### Gateway models

- `Tenant`: one owner-backed workspace today.
- `WhatsAppAccount`: display name, phone, JID, status, pairing state, errors, timestamps.
- `WhatsAppAccountLease`: worker ownership, generation, heartbeat, lease expiry.
- `WhatsAppAuthCredential`: encrypted Baileys credentials.
- `WhatsAppSignalKey`: encrypted individual Signal keys.
- `WhatsAppChat`: synchronized chat state and unread count.
- `WhatsAppContact`: synchronized contact/JID/phone state.
- `WhatsAppGroup`: synchronized group metadata and participants.
- `WhatsAppMessage`: normalized searchable message fields plus full payload.
- `AccountEventSequence`: monotonically increasing per-account event counter.
- `InboundEvent`: durable ordered normalized WhatsApp/gateway event.
- `OutboundCommand`: durable command, claim, result, error, retry state.
- `WebhookEndpoint`: encrypted signing secret, URL, description, enabled state, subscriptions.
- `WebhookDelivery`: per-endpoint delivery attempts and response/error state.
- `AuditLog`: actor/resource/action record.

The exact schema is `prisma/schema.prisma`.

## 6. Security implementation

### Baileys state encryption

- Credentials and Signal keys are stored in PostgreSQL, not local files.
- Each value is encrypted with AES-256-GCM.
- Auth state implements the Baileys auth interface directly.
- Production must provide a unique `ENCRYPTION_KEY`.

### API keys

- Better Auth API keys use the `wag_` prefix.
- Keys are hashed at rest.
- Keys are revocable and expirable.
- Rate limiting defaults to 600 requests per 60 seconds.
- Permissions are resource/action scoped.
- Metadata can scope a key to specific WhatsApp account IDs.
- Browser API calls use the session cookie.
- Programmatic calls accept `X-API-Key` or `Authorization: Bearer wag_...`.

### Webhook security

- Secrets are encrypted at rest and returned once at endpoint creation.
- Signature: HMAC-SHA256 over `timestamp + "." + raw_body`.
- Header: `X-WhatsApp-Signature: v1=<hex>`.
- Other headers: event ID, delivery ID, timestamp.
- Private, loopback, link-local, and metadata destinations are blocked by default.
- DNS is validated both at creation and delivery.
- Undici connects to the validated address to reduce DNS-rebinding risk.
- Redirects are not followed.

### Secret UI rules

Never log, persist, commit, add to URLs, or place in transient toasts:

- API keys.
- Webhook signing secrets.
- Pairing codes.
- QR data URLs.
- Baileys credentials or Signal keys.

## 7. Baileys connection and pairing

### Connection behavior

- Uses `makeWASocket` directly.
- Uses Baileys’ package-locked default protocol version; it does not call `fetchLatestBaileysVersion()`.
- Identifies as an Ubuntu Chrome linked device.
- Does not force online presence on connect.
- Requests full history synchronization.
- Persists every credential update.

### QR pairing

- `POST /v1/accounts/{accountId}/pair/qr` sets pairing mode and a five-minute expiry.
- Worker opens the Baileys connection.
- Every new Baileys QR frame replaces the stored QR.
- QR is generated at 384 px with a four-module quiet zone.
- UI/status clients always receive the newest available QR.
- Unregistered auth state is deleted when pairing expires.

### Phone pairing code

- `POST /v1/accounts/{accountId}/pair/code` normalizes the phone to digits.
- The worker waits until the connection transport is ready before requesting the code.
- Pairing code is stored temporarily and returned through authorized pairing state.
- Attempts expire and clear unregistered auth state.

### Open/close behavior

- On open, account status becomes `connected`; phone/JID and last-connected time are stored; pairing secrets are cleared.
- On close, logged-out sessions clear stored auth and become `disconnected`.
- Non-logout closes become `reconnecting` and are eligible for lease/session restart.
- Connection events are durably emitted.

## 8. Synchronized WhatsApp state

The worker listens to Baileys events and persists:

- Initial messaging history.
- Chat upserts, updates, deletes, and lock state.
- Contact upserts and updates.
- Message creation, updates, deletion, media updates, reactions, and receipts.
- Group upserts, metadata changes, participant changes, join requests, and member tags.
- Calls.
- Presence.
- Blocklist changes.
- Labels.
- Newsletter events.
- Settings, LID mapping, history status, and message capping.

Messages store:

- Gateway ID.
- WhatsApp message ID.
- Account and chat JID.
- Sender JID.
- Inbound/outbound direction.
- Message type.
- Extracted text/caption when available.
- Full JSON-compatible Baileys payload.
- Status and timestamp.

Current read limitations that matter to an agent:

- Messages support `chat_jid`, `before`, and `limit` but not explicit unread-only, direction, type, status, sender, or since filters.
- Chats contain `unreadCount`, so an agent can identify unread chats and then fetch their messages, but this is inefficient.
- There is no global event-read API or event stream.
- There is no command-status read endpoint.

These are priority API additions for reliable CLI/agent use.

## 9. Durable commands

All external WhatsApp mutations run through `OutboundCommand` records.

Current behavior:

- API enqueues a command in PostgreSQL.
- The account-owning worker claims it.
- Worker executes against its Baileys socket.
- Result or error is persisted.
- API waits up to a bounded time and returns the result when complete.
- If still pending, API returns an accepted/pending response with a command ID.
- Commands stuck in processing are returned to pending after worker timeout.
- Completion/failure emits normalized events.

Critical missing contract:

- Add `GET /v1/commands/{commandId}` with tenant/account authorization.
- Return one stable envelope for pending, processing, completed, and failed states.
- Add optional client idempotency keys to command-producing requests.
- Define retryability and surface `attempt_count`, `created_at`, `completed_at`, `result`, and safe error details.

Without a command-status endpoint, an agent cannot reliably follow every asynchronous action to completion.

## 10. Managed Baileys surface

`GET /v1/baileys-actions` returns every managed high-level action. 119 actions are currently registered.

`POST /v1/accounts/{accountId}/actions/{action}` accepts:

```json
{
  "args": []
}
```

It verifies:

- Tenant/account access.
- Action existence.
- The action-specific permission.
- Durable command execution.

### Can this send everything?

Yes, within the high-level content and methods supported by the installed Baileys version.

`messages.send` maps to Baileys `sendMessage(jid, content, options?)` and can carry text, media, contacts, locations, reactions, polls, events, buttons/lists where supported, stickers, and other supported message content.

The gateway deliberately does not expose low-level transport, protocol, retry, raw Signal-state, or raw WebSocket primitives such as `sendNode`, `query`, direct relay/crypto mutation, or raw socket writes. Those are not normal user actions and would break gateway invariants.

### Current action categories

- Messages: 10.
- Presence: 2.
- Contacts: 5.
- Chats: 4.
- Profile: 5.
- Blocklist: 2.
- Privacy: 11.
- Groups: 20.
- Communities: 23.
- Newsletters/channels: 19.
- WhatsApp Business: 12.
- Calls: 2.
- Bots: 1.
- Account/app state: 3.

The exact registry is `src/baileys/actions.ts`. Tests classify every callable Baileys socket member as managed, handled by a dedicated endpoint, or intentionally internal.

## 11. Event and webhook system

### Event durability

Every event receives:

- Gateway event ID.
- Tenant ID.
- Account ID.
- Monotonic per-account sequence.
- Type.
- Timestamp.
- JSON data.

The event and synchronized database change are committed before webhook delivery is queued where applicable.

### Current 36 event types

Pairing and connection:

- `pairing.qr.updated`
- `pairing.code.created`
- `pairing.expired`
- `connection.opened`
- `connection.closed`

Messages and history:

- `message.created`
- `message.updated`
- `message.deleted`
- `message.media.updated`
- `message.reaction.updated`
- `message.receipt.updated`
- `message.capping.updated`
- `history.synced`
- `history.status.updated`

Chats, contacts, and presence:

- `chat.updated`
- `chat.deleted`
- `chat.locked`
- `contact.updated`
- `presence.updated`
- `lid_mapping.updated`

Groups:

- `group.updated`
- `group.participants.updated`
- `group.join_request.updated`
- `group.member_tag.updated`

Commands:

- `command.completed`
- `command.failed`

Other:

- `call.updated`
- `settings.updated`
- `blocklist.set`
- `blocklist.updated`
- `label.updated`
- `label.association.updated`
- `newsletter.reaction.updated`
- `newsletter.view.updated`
- `newsletter.participants.updated`
- `newsletter.settings.updated`

### Webhook subscriptions

- Empty `event_types` means all current and future event types.
- A non-empty array means only exact matching event types.
- Enabled endpoints receive at-least-once delivery.
- Delivery states include pending, processing, retrying, delivered, and dead letter.
- Failed deliveries can be replayed.

### Current webhook UI defect

The current UI only asks for a URL and silently submits `event_types: []`. It does not let the user choose events, add a description, understand URL security, safely save the one-time secret, delete/manage endpoints, inspect a delivery, or replay it from a useful table.

The refactor must provide explicit “All events” versus “Selected events,” a searchable categorized event picker, description, safe secret dialog, endpoint management, delivery table, filters, detail, and replay.

### Webhook API gaps

Current API supports list/create/delete endpoints and list/replay deliveries. Add as needed:

- `GET /v1/webhook-event-types`
- `GET /v1/webhook-endpoints/{endpointId}`
- `PATCH /v1/webhook-endpoints/{endpointId}`
- `GET /v1/webhook-deliveries/{deliveryId}`
- Filters and pagination for delivery list.
- Signing-secret rotation.

## 12. Current REST surface

### Public/system

- `GET /health`
- `GET /openapi.json`
- `GET /docs`
- `GET /v1/skill.md`
- `GET|POST /api/auth/*`

### Account/control plane

- `GET /v1/accounts`
- `POST /v1/accounts`
- `GET /v1/accounts/{accountId}`
- `GET /v1/accounts/{accountId}/status`
- `POST /v1/accounts/{accountId}/pair/qr`
- `POST /v1/accounts/{accountId}/pair/code`
- `DELETE /v1/accounts/{accountId}/session`

### Persisted reads

- `GET /v1/accounts/{accountId}/chats`
- `GET /v1/accounts/{accountId}/contacts`
- `GET /v1/accounts/{accountId}/groups`
- `GET /v1/accounts/{accountId}/messages`

### Convenience mutations, candidates for consolidation

- `POST /v1/accounts/{accountId}/messages`
- `POST /v1/accounts/{accountId}/groups`
- `PATCH /v1/accounts/{accountId}/groups/{groupId}`
- `POST /v1/accounts/{accountId}/groups/{groupId}/participants`
- `DELETE /v1/accounts/{accountId}/groups/{groupId}/participants/{participantId}`

### Complete managed action surface

- `GET /v1/baileys-actions`
- `POST /v1/accounts/{accountId}/actions/{action}`

### Webhooks

- `GET /v1/webhook-endpoints`
- `POST /v1/webhook-endpoints`
- `DELETE /v1/webhook-endpoints/{endpointId}`
- `GET /v1/webhook-deliveries`
- `POST /v1/webhook-deliveries/{deliveryId}/replay`

### Current bespoke endpoint to remove

- `POST /v1/agent-access`

### Better Auth API-key routes

- Managed under `/api/auth/api-key/*`.
- Current UI uses list and delete.
- The next UI should use the normal API-key creation route instead of `POST /v1/agent-access`.

OpenAPI currently documents 28 explicit Hono operations across 24 paths. The route-coverage test verifies every explicit Hono operation appears in OpenAPI. The skill test verifies every custom `/v1` path appears in the served and installable skill.

## 13. Target API for agent/CLI reliability

The following is the recommended stable public shape after consolidation.

### Authentication

- Standard Better Auth API keys only.
- One key format and permission model.

### Accounts

- List/create/get/status/pair/disconnect.

### Read model

- Chats with unread filtering.
- Messages with chat, unread, direction, type, sender, status, since/before, and limit filters.
- Contacts.
- Groups.
- Events with account, type, sequence/since, and cursor filtering.
- Command status.

### Commands

- Action catalog.
- One durable action execution endpoint.
- Stable result envelope.
- Idempotency keys.

### Events

- Webhooks.
- Optional SSE/WebSocket stream of normalized durable events.
- Cursor/resume by event sequence.
- Never raw WhatsApp protocol frames.

### Contract discovery

- OpenAPI.
- Compact capability representation.
- Generic workflow-oriented skill.

## 14. Future CLI contract

A future CLI should be a thin client of the public API, not a second Baileys implementation.

Illustrative commands:

```text
wag auth status
wag accounts list
wag accounts status <account>
wag pair qr <account>
wag chats list <account> --unread
wag messages list <account> --chat <jid> --unread
wag messages send <account> --to <phone-or-jid> --text <text>
wag messages read <account> --message <id>
wag groups list <account>
wag groups create <account> --subject <name> --participant <phone>...
wag actions list --category privacy
wag actions run <account> <action> --args '<json-array>'
wag commands get <command-id> --wait
wag events tail <account> --type message.created
wag webhooks list
```

CLI requirements:

- Reads `WHATSAPP_GATEWAY_API_KEY` and a base URL.
- Never prints the key.
- JSON output mode for agents.
- Human table output mode for developers.
- Stable exit codes.
- `--wait` for durable commands.
- Explicit confirmation for consequential human-mode actions; `--yes` for already-authorized automation.
- No hidden local WhatsApp session or credentials.

## 15. Current frontend status

Current files:

- `src/web/main.tsx`: authentication, all dashboard data/state, polling, and every workflow in one component.
- `src/web/styles.css`: entire hand-written visual system.
- `src/web/index.html`: Vite shell.

Current features:

- Sign up, sign in, sign out.
- Number list/create/select.
- QR and phone-code pairing.
- Connection polling.
- API-key mint through agent-access, list, copy, skill download, revoke.
- Webhook create/list and small delivery strip.
- Send text.
- Create group.
- Generic Baileys action explorer.
- Recent synchronized messages.

Current problems:

- The entire console is one long grid mixing global and account-scoped concerns.
- No real routing or deep links.
- The number row is technically a button, but selection is already active, has weak affordance, and does not navigate; clicking the only number appears to do nothing.
- The webhook form cannot select events and has poor error/secret handling.
- Raw JSON is displayed as success feedback.
- No query cache or reusable domain architecture.
- Missing filtering, searching, pagination, details, and management flows.
- Custom global CSS and demo-card styling do not meet product quality.

## 16. Design-engineering mandate

Reimplement the frontend from scratch with:

- Tailwind CSS.
- shadcn/ui/Radix primitives.
- Lucide icons.
- A real router.
- TanStack Query or an equivalent robust server-state layer.
- React Hook Form plus Zod for forms.
- Reusable feature/domain components.
- Real browser E2E tests.

Do not incrementally polish the old dashboard or preserve its card layout.

Visual direction:

- Calm developer infrastructure console.
- Neutral surfaces.
- Dense but legible.
- WhatsApp green only as an earned accent.
- Amber for pairing/retrying.
- Red for errors, dead letter, and destructive actions.
- Clear typography and table hierarchy.
- Minimal shadow/decorative chrome.
- No gratuitous gradients, glow, or pill overload.

## 17. Target information architecture

```text
/auth/sign-in
/auth/sign-up

/app
  /numbers
  /numbers/new
  /numbers/:accountId
    /overview
    /pairing
    /chats
    /contacts
    /groups
    /messages
    /actions
  /webhooks
  /webhooks/new
  /webhooks/:endpointId
    /overview
    /deliveries
  /api-keys
  /developer
```

Global navigation:

- Numbers.
- Webhooks.
- API keys.
- Developer.
- API reference.
- User menu/sign out.

Number sub-navigation:

- Overview.
- Pairing.
- Chats.
- Contacts.
- Groups.
- Messages.
- Advanced actions.

## 18. Required UX flows

### Numbers

- Number rows are obvious links/buttons with display name, formatted phone, status, and trailing affordance.
- Entire row navigates to `/app/numbers/{accountId}/overview`.
- URL preserves selection across reload/back/forward.
- Search, status filters, and sorting.
- Dedicated “Connect number” flow.
- Clear empty/loading/error states.

### Pairing

- Create connection.
- Choose QR or code.
- Preparing state while a worker acquires the lease.
- Fresh QR replacement and five-minute countdown.
- Exact Linked Devices instructions.
- Pairing-code one-time display and copy.
- Connected success transition.
- Expired/retry and connection-error states.
- Never persist or log QR/code material.

### Chats/messages/unread

- Search chats and show unread counts.
- Chat detail/message list with cursor pagination.
- Clear inbound/outbound message treatment.
- Resolve recipient through chats/contacts before send.
- Text composer plus advanced rich-content JSON.
- Durable pending/completed/failed action state.
- Add backend unread/message filters rather than filtering an incomplete client page.

### Contacts

- Search name, notify name, phone, or JID.
- Contact details and send action.
- Advanced mutations use the managed-action surface.

### Groups

- Search/list/detail.
- Create with contact picker and manual E.164/JID entry.
- Update subject/description.
- Add/remove/promote/demote participants.
- Confirm consequential changes.

### API keys

- Replace Agent Access with standard Create API Key.
- Name, account scope, expiry, rate-limit visibility, and permission presets/custom matrix.
- One-time key dialog with copy and acknowledgement.
- List prefix, scope, permissions, created/expiry state.
- Revoke with confirmation.
- Generic skill download is separate and never embeds the key.

### Webhooks

- Dedicated page and endpoint table.
- Add endpoint with URL, description, and explicit All versus Selected events.
- Searchable categorized 36-event picker.
- Recommended preset: message created, connection opened/closed, command failed.
- Safe one-time signing-secret dialog.
- Explain public HTTPS and SSRF restrictions.
- Endpoint details and lifecycle where backend supports it.
- Delivery table with status, event, account, attempts, HTTP status, timestamps, retry/dead-letter information.
- Delivery detail and replay.
- Never silently submit all events.

### Baileys actions

- Fetch action registry dynamically.
- Search by name/method/arguments/description.
- Filter category and permission.
- JSON array editor with validation.
- Account context.
- Consequential-action confirmation.
- Structured result/pending/error viewer.

### Developer

- Gateway base URL.
- OpenAPI link/download.
- Scalar reference.
- Generic skill download.
- Capability/action catalog.
- Authentication example.
- Webhook signing example.

## 19. Webhook creation specification

The create request should be visibly constructed as:

```json
{
  "url": "https://agent.example.com/webhooks/whatsapp",
  "description": "Production agent ingress",
  "event_types": [
    "message.created",
    "connection.opened",
    "connection.closed"
  ]
}
```

Selection rules:

- “All current and future events” sends `[]`.
- “Selected events” sends exact selected strings.
- Category-level and global select/clear.
- Search event names/descriptions.
- Display selected count.
- Explain that selecting all current checkboxes is not identical to all future events.

After creation, show the secret once in a blocking dialog with:

- Copy secret.
- Required signature headers.
- HMAC input format.
- Verification docs link/example.
- “I stored this secret” acknowledgement.

Never place the secret in a banner or toast.

## 20. Suggested frontend structure

```text
src/web/
  app.tsx
  main.tsx
  routes.tsx
  styles.css
  components/
    app-shell.tsx
    page-header.tsx
    status-badge.tsx
    empty-state.tsx
    error-state.tsx
    secret-dialog.tsx
    confirm-action-dialog.tsx
    json-viewer.tsx
    ui/
  lib/
    api-client.ts
    query-client.ts
    format.ts
    permissions.ts
    webhook-events.ts
  features/
    auth/
    numbers/
    pairing/
    chats/
    contacts/
    messages/
    groups/
    api-keys/
    webhooks/
    baileys-actions/
    developer/
```

State rules:

- Route params select account/endpoint.
- One typed fetch client includes cookies and normalizes errors.
- Query library owns server state, polling, invalidation, and retry.
- Two-second status polling only while pairing/connecting/reconnecting; slower while stable.
- Message/group polling only while relevant views are active until a normalized stream exists.
- Never persist one-time secrets.

## 21. Accessibility and responsive requirements

- WCAG 2.1 AA contrast.
- Full keyboard operation and visible focus.
- Correct landmarks and heading hierarchy.
- Persistent field labels.
- Radix focus trapping/restoration for dialogs.
- Status announcements that never announce secrets.
- Accessible row actions and icon labels.
- Reduced-motion support.
- Mobile sidebar sheet and compact account navigation.
- No horizontal document overflow at 320 px.
- QR remains scannable and preserves quiet zone.

## 22. Current verification status

The baseline passed:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`: 5 files, 24 tests.
- `pnpm skill:validate`
- `pnpm build`
- Docker image build.
- Prisma migration deployment.
- Curl smoke with signup, account creation, scoped key use/revoke, 119-action discovery, and real Baileys QR generation.
- TypeScript E2E with the same authenticated/pairing coverage.
- Live `/docs`, `/openapi.json`, and `/v1/skill.md` HTTP checks.
- OpenAPI route coverage: no missing explicit Hono route.
- Served skill route coverage: no missing custom `/v1` path.

The baseline did not complete a human phone scan in the automated environment. Final real-device proof remains:

- Scan QR with the user’s WhatsApp.
- Account becomes connected.
- Inbound message persists.
- `message.created` webhook arrives immediately.
- Outbound rich/text message succeeds.
- Group creation succeeds.
- Worker restart preserves the linked session.
- Multiple workers preserve one session owner through leases.

## 23. Required tests for the refactor

Automated gates:

- Lint.
- Typecheck.
- Unit/integration tests.
- Production server/web build.
- Skill validation.
- Curl smoke.
- TypeScript E2E.
- Docker build/up health.

Browser E2E must prove:

1. Sign up/sign in.
2. Click a number and assert the route and correct account detail.
3. Reload/back/forward preserves selection.
4. Create a connection.
5. Generate a fresh QR/code and handle expiry.
6. Real phone scan reaches Connected.
7. Webhook creation sends the exact selected `event_types` array.
8. All-events mode intentionally sends `[]`.
9. Webhook secret appears once and disappears after acknowledgement/reload.
10. Real inbound message produces synchronized state and a delivery.
11. Failed delivery can be inspected and replayed.
12. Standard API key can be created, used via curl, and revoked.
13. Generic skill contains no secret and points to the live contract.
14. A durable command can be polled to terminal state.
15. Send a real message.
16. Create a real group.
17. Run one read and one write managed action.
18. Keyboard and mobile workflows.

## 24. Definition of done for the next phase

- Root product no longer uses the bespoke Agent Access concept.
- Standard Better Auth API-key management is clear and complete.
- Generic skill is credential-free and generated/anchored to live contract sources.
- The raw WhatsApp WebSocket remains private to the worker.
- Persisted read APIs remain available and gain unread/query support.
- Managed action endpoint is the complete durable Baileys command surface.
- Duplicate convenience mutations either delegate to that surface or are safely deprecated.
- Command-status and idempotency contracts exist.
- Normalized event poll/stream support is available if agents need a live connection in addition to webhooks.
- Tailwind and shadcn/ui replace the old monolithic dashboard and global custom panel CSS.
- Number rows are obviously navigable.
- Webhook event selection and secret handling are production-grade.
- All existing backend invariants remain intact.
- Real phone, inbound event, outbound message, group, webhook, restart, and multi-worker proof passes.

## 25. Source-of-truth file map

- `README.md`: operator overview and local setup.
- `docker-compose.yml`: local roles and dependencies.
- `Dockerfile`: shared production image.
- `prisma/schema.prisma`: all persistent models.
- `prisma/migrations/`: deployment history.
- `src/main.ts`: role startup and static web serving.
- `src/config.ts`: validated runtime configuration.
- `src/api/app.ts`: HTTP routes and handlers.
- `src/api/openapi.ts`: OpenAPI/Scalar contract.
- `src/auth/auth.ts`: Better Auth and permission registry.
- `src/auth/middleware.ts`: cookie/API-key actor resolution and authorization.
- `src/baileys/auth-state.ts`: encrypted Prisma-backed Baileys auth state.
- `src/baileys/session.ts`: socket lifecycle, sync, event handlers, command execution.
- `src/baileys/actions.ts`: 119-action public registry.
- `src/worker/leases.ts`: account lease acquisition/heartbeat/release.
- `src/worker/supervisor.ts`: worker capacity and session ownership.
- `src/services/commands.ts`: durable command enqueue/wait.
- `src/services/events.ts`: ordered event persistence and webhook fan-out.
- `src/webhooks/url-security.ts`: SSRF/DNS controls.
- `src/webhooks/dispatcher.ts`: signed retrying delivery.
- `src/skill.ts`: served generic/personalized skill generator; must be simplified.
- `skills/whatsapp-gateway/SKILL.md`: installable generic skill; must remain credential-free.
- `src/web/main.tsx`: current UI behavior reference, intended for replacement.
- `src/web/styles.css`: current UI styles, intended for replacement.
- `scripts/smoke.sh`: curl black-box test.
- `src/scripts/e2e.ts`: TypeScript black-box test.

## 26. Non-negotiable engineering invariants

- Prisma/PostgreSQL remain the only persistence layer.
- Linked-device auth state is encrypted and durable.
- Exactly one worker lease owns one WhatsApp session at a time.
- External commands are authenticated, account-scoped, permission-checked, and durable.
- Incoming state is persisted before it is treated as available to agents.
- Webhooks are signed, at-least-once, retrying, replayable, and SSRF-protected.
- Raw protocol and cryptographic primitives are not exposed.
- Secrets and pairing material are never persisted in the browser or logs.
- OpenAPI, compact capability representation, skill, CLI, and implementation cannot drift into separate manual contracts.
- A UI control may not pretend to work without a real authenticated API and persisted/read-back proof.
