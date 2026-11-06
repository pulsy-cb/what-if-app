#!/usr/bin/env bash
# Drive the running app with curl: create a project + thread, send one instruction.
# Usage: bash scripts/demo.sh [instruction]
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3000}"
TOKEN="${WHATIF_AUTH_TOKEN:-}"
INSTRUCTION="${1:-Fais un tour du projet et propose un plan en 3 étapes.}"

q() { if [ -n "$TOKEN" ]; then printf '?token=%s' "$TOKEN"; fi; }
hdr=(-H 'content-type: application/json')
if [ -n "$TOKEN" ]; then hdr+=(-H "x-whatif-token: $TOKEN"); fi

echo "== health"
curl -sS "$BASE/api/health$(q)"; echo

echo "== project"
curl -sS -X POST "${hdr[@]}" -d '{"name":"demo"}' "$BASE/api/projects$(q)"; echo

echo "== thread"
THREAD=$(curl -sS -X POST "${hdr[@]}" -d '{"projectId":"demo","title":"demo"}' "$BASE/api/threads$(q)" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
echo "thread $THREAD"

echo "== message"
curl -sS -X POST "${hdr[@]}" -d "$(python3 -c 'import json,sys;print(json.dumps({"text":sys.argv[1]}))' "$INSTRUCTION")" \
  "$BASE/api/threads/$THREAD/messages$(q)"; echo

echo "== events (20 s)"
curl -sS -N --max-time 20 "$BASE/api/threads/$THREAD/events$(q)" | sed -u 's/^event: /· /' || true
