#!/usr/bin/env bash
set -euo pipefail

deploy_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$deploy_root"

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker is required: https://docs.docker.com/engine/install/' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Compose v2 is required.' >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  cp .env.production.example .env
  chmod 600 .env
  echo 'Created .env from .env.production.example. Fill every replace-with value, then rerun.' >&2
  exit 1
fi
if grep -q 'replace-with' .env; then
  echo 'Replace every placeholder in .env before deployment.' >&2
  exit 1
fi

docker compose --env-file .env -f docker-compose.production.yml up -d --build --remove-orphans --wait
docker compose --env-file .env -f docker-compose.production.yml ps

domain="$(sed -n 's/^DOMAIN=//p' .env | tail -1)"
echo "WhatsApp Gateway is starting at https://${domain}"
