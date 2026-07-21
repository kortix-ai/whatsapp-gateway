#!/usr/bin/env bash
set -euo pipefail

deploy_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
secret_arn_file="${GATEWAY_SECRET_ARN_FILE:-/etc/whatsapp-gateway/secret-arn}"
region_file="${GATEWAY_AWS_REGION_FILE:-/etc/whatsapp-gateway/region}"
gateway_image="${1:-ghcr.io/kortix-ai/whatsapp-gateway:main}"

if [[ ! -r "$secret_arn_file" || ! -r "$region_file" ]]; then
  echo 'AWS deployment metadata is missing.' >&2
  exit 1
fi

secret_arn="$(<"$secret_arn_file")"
aws_region="$(<"$region_file")"
secret_json="$(aws secretsmanager get-secret-value \
  --secret-id "$secret_arn" \
  --region "$aws_region" \
  --query SecretString \
  --output text)"

install -d -m 700 "$deploy_root/runtime"
env_next="$deploy_root/runtime/gateway.env.next"
printf '%s' "$secret_json" | jq -r 'to_entries[] | "\(.key)=\(.value | tostring)"' > "$env_next"
printf 'GATEWAY_IMAGE=%s\n' "$gateway_image" >> "$env_next"
printf 'GATEWAY_RELEASE=%s\n' "${gateway_image##*:}" >> "$env_next"
chmod 600 "$env_next"
mv "$env_next" "$deploy_root/.env"

cd "$deploy_root"
docker compose --env-file .env -f docker-compose.production.yml pull
docker compose --env-file .env -f docker-compose.production.yml up -d --remove-orphans --wait
docker compose --env-file .env -f docker-compose.production.yml exec -T api \
  node -e "fetch('http://127.0.0.1:8080/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"
docker compose --env-file .env -f docker-compose.production.yml ps
