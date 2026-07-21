# Contributing

Contributions are welcome through focused pull requests.

## Development

```bash
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Run every gate before opening a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm skill:validate
pnpm build
docker compose -f docker-compose.production.yml config
```

For behavior changes, also run the curl smoke and TypeScript E2E against the real local Docker stack. Pairing tests use a real outbound Baileys connection.

## Engineering boundaries

- Use Prisma/PostgreSQL for persistence.
- Keep linked-device credentials and Signal keys encrypted.
- Preserve one active worker lease per WhatsApp connection.
- Keep mutations authenticated, scoped, permission-checked, durable, and idempotent.
- Never expose raw WhatsApp protocol, relay, retry, or cryptographic primitives.
- Never place API keys, webhook secrets, pairing QR/code material, or real message content in commits, fixtures, logs, issues, or pull requests.
- Update OpenAPI, the capability map, skill, CLI, tests, and README when a public contract changes.

Please report security issues through the process in [SECURITY.md](SECURITY.md), not a public issue.
