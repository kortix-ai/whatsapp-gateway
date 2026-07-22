#!/usr/bin/env bash
#
# End-to-end send check against a LIVE gateway, over plain curl.
#
# Covers every send path that has its own transport, because they fail
# independently and have done so in production:
#
#   text / formatted / location  → websocket        (`agent`)
#   image / document / audio     → media upload     (`fetchAgent`, node https)
#   media from a remote URL      → source fetch     (global fetch + dispatcher)
#   media download back out      → media download   (global fetch + dispatcher)
#
# A green text send tells you almost nothing about media: that was exactly the
# 2026-07-22 failure, where text worked for weeks while every image died with
# "Media upload failed on all hosts".
#
# Usage:
#   WAG_URL=https://wag.kortix.cloud \
#   WAG_KEY=wag_xxx \
#   WAG_ACCOUNT=wa_xxx \
#   WAG_TO=+15551234567 \
#     ./scripts/e2e-media.sh
#
# Exit 0 only if every case passes.

set -uo pipefail

: "${WAG_URL:?set WAG_URL}"
: "${WAG_KEY:?set WAG_KEY}"
: "${WAG_ACCOUNT:?set WAG_ACCOUNT}"
: "${WAG_TO:?set WAG_TO}"

PASS=0
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

api() { curl -sS -H "x-api-key: $WAG_KEY" "$@"; }

# Every send is asynchronous: the POST only enqueues. Polling the command to a
# terminal state is the whole point — the original bug reported "ok" on enqueue
# and failed a second later, so anything that stops at the 200 proves nothing.
await_command() {
  local id="$1" deadline=$((SECONDS + 90)) status error
  while ((SECONDS < deadline)); do
    local body; body="$(api "$WAG_URL/v1/commands/$id")"
    status="$(printf '%s' "$body" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))' 2>/dev/null)"
    case "$status" in
      completed) return 0 ;;
      failed)
        error="$(printf '%s' "$body" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("error",""))' 2>/dev/null)"
        printf '%s' "$error" > "$TMP/last_error"; return 1 ;;
    esac
    sleep 2
  done
  printf 'timed out after 90s (status=%s)' "$status" > "$TMP/last_error"; return 1
}

check() {
  local name="$1" payload="$2"
  printf '  %-34s ' "$name"
  local resp; resp="$(api -X POST "$WAG_URL/v1/accounts/$WAG_ACCOUNT/messages" \
    -H 'content-type: application/json' -d "$payload")"
  local cid; cid="$(printf '%s' "$resp" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("command_id") or d.get("id") or "")' 2>/dev/null)"
  if [[ -z "$cid" ]]; then
    echo "FAIL (no command id): $(printf '%s' "$resp" | head -c 150)"; ((FAIL++)); return
  fi
  if await_command "$cid"; then
    echo "ok"; ((PASS++))
  else
    echo "FAIL: $(cat "$TMP/last_error" 2>/dev/null | head -c 150)"; ((FAIL++))
  fi
}

echo "gateway: $WAG_URL"
echo "account: $WAG_ACCOUNT  →  $WAG_TO"
echo

echo "reachability"
printf '  %-34s ' "GET /v1/accounts"
if api "$WAG_URL/v1/accounts" | grep -q "$WAG_ACCOUNT"; then echo "ok"; ((PASS++))
else echo "FAIL (account not visible to this key)"; ((FAIL++)); fi

# The websocket path. Historically fine; here to prove the socket is healthy so
# a media failure below can't be blamed on the connection.
echo
echo "websocket sends"
check "plain text"        "$(printf '{"to":"%s","text":"e2e: plain text"}' "$WAG_TO")"
check "formatted text"    "$(printf '{"to":"%s","text":"e2e: *bold* _italic_ ~strike~"}' "$WAG_TO")"
check "location"          "$(printf '{"to":"%s","content":{"location":{"degreesLatitude":48.8584,"degreesLongitude":2.2945,"name":"Eiffel Tower"}}}' "$WAG_TO")"

# The media paths. These are the ones that actually regress.
echo
echo "media sends (upload path)"
check "image from URL"    "$(printf '{"to":"%s","content":{"image":{"url":"https://picsum.photos/seed/kortix/600/400"},"caption":"e2e: image"}}' "$WAG_TO")"
check "document from URL" "$(printf '{"to":"%s","content":{"document":{"url":"https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"},"mimetype":"application/pdf","fileName":"e2e.pdf"}}' "$WAG_TO")"

# Empty/invalid media must be REJECTED at the API, not surfaced as an ENOENT
# from deep inside the send path (seen in production as
# "ENOENT: no such file or directory, open ''").
echo
echo "input validation"
printf '  %-34s ' "empty media url rejected"
code="$(api -o /dev/null -w '%{http_code}' -X POST "$WAG_URL/v1/accounts/$WAG_ACCOUNT/messages" \
  -H 'content-type: application/json' -d "$(printf '{"to":"%s","content":{"image":{"url":"  "}}}' "$WAG_TO")")"
if [[ "$code" == 4* ]]; then echo "ok (HTTP $code)"; ((PASS++))
else echo "FAIL: expected 4xx, got $code"; ((FAIL++)); fi

# Download is a different transport from upload and can fail on its own.
echo
echo "media download path"
printf '  %-34s ' "GET /messages/{id}/media"
MID="$(api "$WAG_URL/v1/accounts/$WAG_ACCOUNT/messages?limit=25" | python3 -c '
import sys, json
try: rows = json.load(sys.stdin).get("data", [])
except Exception: rows = []
media = {"imageMessage","videoMessage","documentMessage","audioMessage","stickerMessage"}
print(next((r["id"] for r in rows if r.get("type") in media), ""))' 2>/dev/null)"
if [[ -z "$MID" ]]; then
  echo "SKIP (no media message in recent history)"
else
  code="$(api -o "$TMP/dl.bin" -w '%{http_code}' "$WAG_URL/v1/messages/$MID/media")"
  size=$(wc -c < "$TMP/dl.bin" | tr -d ' ')
  if [[ "$code" == "200" && "$size" -gt 0 ]]; then echo "ok ($size bytes)"; ((PASS++))
  else echo "FAIL: HTTP $code, $size bytes"; ((FAIL++)); fi
fi

echo
echo "─────────────────────────────"
echo "passed $PASS, failed $FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
