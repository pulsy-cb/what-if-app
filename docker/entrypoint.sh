#!/bin/sh
set -eu

mkdir -p "${WHATIF_DATA:-/data}"

if [ ! -d "${WHATIF_SKILL_DIR:-/skill}/studio" ]; then
  echo "warning: no studio/ in ${WHATIF_SKILL_DIR:-/skill} — scaffold and pipeline steps will refuse to run." >&2
  echo "         mount the what-if-animation skill at /skill (see docker-compose.yml)." >&2
fi

if [ -n "${WHATIF_AUTH_TOKEN:-}" ]; then
  echo "auth: token required for /api"
fi

exec node /app/dist/orchestrator/main.js
