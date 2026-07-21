#!/usr/bin/env bash
set -euo pipefail

smoke_base_url="${SMOKE_BASE_URL:-http://localhost:8080}"
smoke_tmp="$(mktemp -d "${TMPDIR:-/tmp}/whatsapp-gateway-smoke.XXXXXX")"
trap 'rm -rf -- "$smoke_tmp"' EXIT

smoke_cookie="$smoke_tmp/cookies.txt"
smoke_body="$smoke_tmp/body.json"
smoke_email="smoke-$(node -e 'process.stdout.write(crypto.randomUUID())')@example.com"
smoke_password='correct-horse-battery-staple'

assert_status() {
  expected="$1"
  actual="$2"
  label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "$label returned HTTP $actual; expected $expected" >&2
    exit 1
  fi
}

status="$(curl -sS -o "$smoke_body" -w '%{http_code}' -c "$smoke_cookie" \
  -X POST "$smoke_base_url/api/auth/sign-up/email" \
  -H "Origin: $smoke_base_url" -H 'Content-Type: application/json' \
  --data "{\"name\":\"Gateway smoke\",\"email\":\"$smoke_email\",\"password\":\"$smoke_password\"}")"
assert_status 200 "$status" signup

status="$(curl -sS -o "$smoke_body" -w '%{http_code}' -b "$smoke_cookie" \
  -X POST "$smoke_base_url/v1/accounts" \
  -H "Origin: $smoke_base_url" -H 'Content-Type: application/json' \
  --data '{"display_name":"Curl smoke number"}')"
assert_status 201 "$status" account_create
account_id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).id)' "$smoke_body")"

status="$(curl -sS -o "$smoke_body" -w '%{http_code}' -b "$smoke_cookie" \
  -X POST "$smoke_base_url/v1/agent-access" \
  -H "Origin: $smoke_base_url" -H 'Content-Type: application/json' \
  --data "{\"name\":\"Curl smoke agent\",\"account_ids\":[\"$account_id\"]}")"
assert_status 201 "$status" agent_access
api_key="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).api_key)' "$smoke_body")"
key_id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).key_id)' "$smoke_body")"

status="$(curl -sS -o "$smoke_body" -w '%{http_code}' \
  "$smoke_base_url/v1/accounts" -H "X-API-Key: $api_key")"
assert_status 200 "$status" api_key_accounts
scoped_count="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1])).data.length))' "$smoke_body")"
[[ "$scoped_count" == 1 ]] || { echo 'Agent key account scope failed' >&2; exit 1; }

status="$(curl -sS -o "$smoke_body" -w '%{http_code}' \
  "$smoke_base_url/v1/baileys-actions" -H "X-API-Key: $api_key")"
assert_status 200 "$status" action_catalog
action_count="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1])).data.length))' "$smoke_body")"
[[ "$action_count" -ge 119 ]] || { echo "Action catalog is incomplete ($action_count)" >&2; exit 1; }

pairing_checked=false
if [[ "${SMOKE_PAIRING:-0}" == 1 ]]; then
  status="$(curl -sS -o "$smoke_body" -w '%{http_code}' -b "$smoke_cookie" \
    -X POST "$smoke_base_url/v1/accounts/$account_id/pair/qr" \
    -H "Origin: $smoke_base_url" -H 'Content-Type: application/json' --data '{}')"
  assert_status 200 "$status" qr_pairing
  node -e 'const body=JSON.parse(require("fs").readFileSync(process.argv[1])); if(!body.qr_data_url?.startsWith("data:image/png;base64,")) process.exit(1)' "$smoke_body"

  status="$(curl -sS -o "$smoke_body" -w '%{http_code}' \
    "$smoke_base_url/v1/accounts/$account_id/status" -H "X-API-Key: $api_key")"
  assert_status 200 "$status" scoped_status
  node -e 'const body=JSON.parse(require("fs").readFileSync(process.argv[1])); if("qr_data_url" in body || "pairing_code" in body) process.exit(1)' "$smoke_body"
  pairing_checked=true
fi

status="$(curl -sS -o "$smoke_body" -w '%{http_code}' -b "$smoke_cookie" \
  -X POST "$smoke_base_url/api/auth/api-key/delete" \
  -H "Origin: $smoke_base_url" -H 'Content-Type: application/json' \
  --data "{\"keyId\":\"$key_id\"}")"
assert_status 200 "$status" api_key_revoke

status="$(curl -sS -o "$smoke_body" -w '%{http_code}' \
  "$smoke_base_url/v1/accounts" -H "X-API-Key: $api_key")"
assert_status 401 "$status" revoked_key

printf '{"ok":true,"signup_status":200,"account_status":201,"scoped_accounts":%s,"baileys_actions":%s,"pairing_checked":%s,"revoked_key_status":401}\n' \
  "$scoped_count" "$action_count" "$pairing_checked"
