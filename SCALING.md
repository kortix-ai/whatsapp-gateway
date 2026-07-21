# Scaling and Reliability

This document separates infrastructure capacity from WhatsApp product and policy risk. A cluster can hold thousands of WebSockets and still be the wrong foundation for a commercial WhatsApp product.

## What one connection consumes

Each linked WhatsApp account is one long-lived Baileys WebSocket plus in-memory protocol state. It is **not** one browser and **not** one container. A worker process multiplexes connections; the default `WORKER_CAPACITY` is 25. PostgreSQL is the durable source for encrypted auth/Signal state, socket ownership leases, synchronized data, commands, events, and webhook deliveries.

Configured active capacity is approximately:

```text
worker replicas × WORKER_CAPACITY
```

Set capacity from measured memory, CPU, connection stability, event rate, and database load—not from the formula alone. Keep at least 30% worker headroom so rolling deploys and lease takeovers do not overload the remaining replicas.

## Practical tiers

| Connected accounts | Recommended position | Topology |
| ---: | --- | --- |
| 1–25 | Good fit for private/internal Baileys use | Current Docker Compose stack on one VPS/EC2; tested backups and monitoring |
| 25–250 | Viable for opt-in linked devices | Managed PostgreSQL, 2+ API replicas, 2+ Baileys workers across failure domains, 2+ webhook workers, metrics and alerting |
| 250–1,000 | Technically possible, operationally risky | Sharded worker pools, connection admission control, queue/load tests, retention/partitioning, dedicated on-call; accept upstream protocol/enforcement incidents |
| Thousands | Do not promise as a Baileys-only commercial service | Official WhatsApp Cloud API as the primary connector; Baileys only as an explicit best-effort linked-device option |

The ranges are planning guidance, not WhatsApp limits. Benchmark with representative history syncs, media, groups, reconnects, commands, and webhook fan-out before raising a shard's admission limit.

## Safe distributed topology

```text
                         ┌──────────────────────┐
clients ── HTTPS/WAF ──► │ stateless API replicas│
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │ managed PostgreSQL HA │
                         │ auth, leases, queues, │
                         │ events and sync state │
                         └──────┬────────┬──────┘
                                │        │
                ┌───────────────▼──┐  ┌──▼────────────────┐
                │ Baileys worker    │  │ webhook workers    │
                │ shards, multi-AZ  │  │ concurrent claims  │
                └───────┬───────────┘  └───────────────────┘
                        │ stable outbound internet
                        ▼
                    WhatsApp
```

One account lease is owned by one worker at a time. Leases expire after a dead worker stops heartbeating; another replica can take over. Reconnect attempt state lives in PostgreSQL, so a crash or lease handoff cannot reset a failing account into a two-second reconnect storm. Webhook replicas use atomic `FOR UPDATE SKIP LOCKED` claims, so replicas increase delivery throughput without intentionally duplicating a live claim. Delivery remains at-least-once because a process can die after the receiver accepts but before success is committed; consumers must deduplicate event IDs.

All replicas that may own the same account must share that PostgreSQL control plane. Do not restore or copy a live account's encrypted auth/Signal state into another concurrently running database. Cross-database workers cannot see each other's lease and WhatsApp will repeatedly replace the competing socket.

## Required before production scale

The repository provides the control-plane primitives, but the single-node reference deployment is not highly available. Before hundreds or thousands of accounts, add:

1. Multi-AZ managed PostgreSQL with connection pooling, point-in-time recovery, tested restores, query monitoring, and capacity alarms.
2. Multiple API, worker, and webhook replicas across failure domains. Drain workers during deploys and leave enough spare socket capacity for takeovers.
3. Prometheus/OpenTelemetry metrics for active sessions, lease loss, reconnect attempts, command age/failures, webhook lag/retries/dead letters, database saturation, event rate, and per-account health.
4. Per-tenant quotas, connection admission limits, outbound rate controls, abuse response, audit review, API-key rotation, and incident runbooks.
5. Message/event/webhook retention. Full WhatsApp message payloads and media metadata are large; archive or delete by policy and partition the largest time-series tables when measured volume warrants it.
6. Load and chaos tests: kill workers, cut database/network access, expire leases, deploy during traffic, reconnect a shard simultaneously, and replay webhook backlogs.
7. A Baileys upgrade canary. Pin the version, test a small account cohort, then roll out by shard because an upstream WhatsApp protocol change can break every session independently of your infrastructure.

When auth is behind a CDN, configure only that CDN's exact CIDRs in `TRUSTED_PROXY_CIDRS`; this lets Better Auth derive per-client rate-limit keys without trusting spoofed forwarded headers. Keep the origin firewalled to the CDN when possible.

Database polling is intentionally simple and reliable for the current product. At sustained high command/event volume, introduce a durable queue or PostgreSQL notification layer for wakeups while keeping PostgreSQL records as the recovery source of truth. Do not make an ephemeral broker the only copy of a command or event.

## Residential proxies and fingerprinting

Do not build residential-proxy rotation or browser-fingerprint spoofing into this service.

- Baileys does not run Chromium/Selenium; there is no browser canvas, font, or WebGL fingerprint to spoof.
- It speaks directly to WhatsApp over a WebSocket, as documented by the [Baileys project](https://github.com/WhiskeySockets/Baileys).
- The same Baileys README says it is unofficial/not endorsed by WhatsApp, should be used at the operator's discretion, and discourages spam, bulk, and automated messaging.
- A proxy sees highly sensitive connection traffic, adds failure modes, and rotating an address disrupts a long-lived socket.
- Trying to disguise automation or evade platform enforcement is not a reliable or defensible product control.

AWS egress is not, by itself, evidence that residential IPs are required. For legitimate isolation, compliance, regional routing, or blast-radius control, assign **stable dedicated egress** to a worker shard and keep a connection on that shard. Treat any IP change as a reconnect event. Account consent, messaging behavior, recipient feedback, and compliance remain more important than pretending a data-center process is a residential browser.

## Baileys versus the official Cloud API

Baileys is useful when an opted-in user needs linked-device access to the broad regular-client surface, including groups and personal chat state. Its tradeoff is that the protocol is unofficial, upstream compatibility can change, and WhatsApp/Meta does not give this gateway a commercial availability guarantee.

The official [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/overview) is built for business messaging at scale, uses Graph API for outbound traffic and webhooks for inbound/status events, and is automatically scaled by Meta within its limits. It does not expose every personal-client behavior Baileys exposes. For a large managed product, use a connector abstraction:

```text
Gateway account API
  ├── linked-device connector (Baileys, best effort)
  └── business connector (Meta Cloud API, supported scale path)
```

Keep authorization, durable commands, normalized events, webhooks, API keys, audit logs, and the CLI common above both connectors. Route commercial/business onboarding to Cloud API; make the Baileys risk explicit for linked-device accounts.

## Current Kortix deployment

`wag.kortix.cloud` intentionally runs the private 1–25 tier: one EC2 instance, local PostgreSQL volume, one API, one Baileys worker, one webhook worker, and Caddy. It automatically restarts and reconnects, uses immutable-image CI/CD, encrypted disk/secrets, and daily backups. It has a single-instance and single-database failure domain and should not be presented as the topology for thousands of accounts.

The next infrastructure step is managed PostgreSQL plus two worker instances—not proxies. Move only when measured usage or an availability target justifies it.
