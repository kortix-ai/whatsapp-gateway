#!/usr/bin/env bash
set -euo pipefail

deploy_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$deploy_root/.env"

if [[ ! -r "$env_file" ]]; then
  echo 'Production .env is missing.' >&2
  exit 1
fi

value() {
  sed -n "s/^$1=//p" "$env_file" | tail -1
}

aws_region="$(value AWS_REGION)"
backup_bucket="$(value AWS_BACKUP_BUCKET)"
postgres_db="$(value POSTGRES_DB)"
postgres_user="$(value POSTGRES_USER)"
backup_dir="$deploy_root/runtime/backups"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$backup_dir/whatsapp-gateway-$timestamp.sql.gz"

install -d -m 700 "$backup_dir"
cd "$deploy_root"
docker compose --env-file .env -f docker-compose.production.yml exec -T postgres \
  pg_dump -U "$postgres_user" "$postgres_db" | gzip -9 > "$backup_file"
aws s3 cp "$backup_file" "s3://$backup_bucket/postgres/$(basename "$backup_file")" \
  --region "$aws_region" --only-show-errors
find "$backup_dir" -type f -name 'whatsapp-gateway-*.sql.gz' -mtime +7 -delete
printf 'Uploaded %s\n' "s3://$backup_bucket/postgres/$(basename "$backup_file")"
