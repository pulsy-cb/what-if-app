# What If studio — the chat-driven animation app.
# Multi-stage: the build stage type-checks and compiles the TypeScript, the runtime stays lean.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    WHATIF_DATA=/data \
    WHATIF_SKILL_DIR=/skill \
    WHATIF_HOST=0.0.0.0 \
    WHATIF_PORT=3000

# python3 + pillow/numpy for the skill scripts, ffmpeg for audio, modal for the renders, and the
# Chromium libraries Remotion needs if someone forces WHATIF_RENDER=local (renders run on Modal by default).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg git ca-certificates curl util-linux \
      fonts-liberation fonts-dejavu-core \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcups2 libdrm2 libgbm1 \
      libgtk-3-0 libasound2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libpango-1.0-0 libcairo2 libxshmfence1 libx11-xcb1 \
    && python3 -m pip install --no-cache-dir --break-system-packages pillow numpy modal \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY pipeline ./pipeline
COPY engine-overlay ./engine-overlay
COPY web ./web
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /data

# No USER here: the entrypoint fixes /data ownership as root, then drops to uid 1000 (node) with setpriv.
EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
