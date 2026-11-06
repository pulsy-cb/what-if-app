#!/bin/sh
set -eu

DATA="${WHATIF_DATA:-/data}"
SKILL="${WHATIF_SKILL_DIR:-/skill}"

if [ ! -d "$SKILL/studio" ]; then
  echo "warning: no studio/ in $SKILL — scaffold and pipeline steps will refuse to run." >&2
  echo "         mount the what-if-animation skill (see docker-compose.yml)." >&2
fi

# /data is usually a bind mount owned by the host (often root). Fix its owner as root, then run the app
# as the unprivileged "node" user: the agent writes files and executes commands, so it must not be root.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  chown -R node:node "$DATA" 2>/dev/null || echo "warning: cannot chown $DATA (read-only mount?)" >&2
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=1000 --regid=1000 --init-groups node /app/dist/orchestrator/main.js
  fi
  echo "warning: setpriv not found — running as root" >&2
fi

mkdir -p "$DATA"
exec node /app/dist/orchestrator/main.js
