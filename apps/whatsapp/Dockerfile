# The WhatsApp delivery service, built and run for production.
#
# ── BUILT FROM THE REPOSITORY ROOT ──────────────────────────────────────────
#   docker build -f apps/whatsapp/Dockerfile .
#
# The context is the whole workspace because the lockfile and the workspace
# definition live at the root, and pnpm resolves against them.
# ────────────────────────────────────────────────────────────────────────────
#
# ── WHAT THIS CONTAINER HOLDS ───────────────────────────────────────────────
# A logged-in WhatsApp account. The session files under /app/session ARE the
# account: anyone holding them can send as the company. So this image publishes
# no port to the host, sits on the internal network only, runs as an
# unprivileged user, and keeps the session on a named volume that survives the
# container being replaced.
# ────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependencies ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

RUN corepack enable

# Manifests first, so a source change does not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/parser/package.json ./apps/parser/
COPY apps/whatsapp/package.json ./apps/whatsapp/

# --filter, so the backend's and the frontend's dependency trees are never
# installed into this image. It needs Baileys and nothing else.
RUN pnpm install --frozen-lockfile --filter @tms/whatsapp

# ── Stage 2: build ──────────────────────────────────────────────────────────
FROM dependencies AS build

COPY apps/whatsapp ./apps/whatsapp

RUN pnpm --filter @tms/whatsapp build

# The disconnect codes this service decides on are duplicated in
# reconnect-policy.ts, because that module must stay loadable in a CommonJS test
# runner and Baileys 7 is ESM-only. Nothing in the unit tests can check the
# duplicate, so the check runs HERE against the real package. A renumbered
# reason fails the build rather than producing a service that reads a temporary
# drop as a logout — and deletes a working session for it.
RUN node apps/whatsapp/verify-disconnect-codes.cjs

# ── Stage 3: production dependencies ────────────────────────────────────────
FROM dependencies AS production-dependencies

ENV CI=true

RUN pnpm install --frozen-lockfile --prod --filter @tms/whatsapp

# ── Stage 4: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# ca-certificates for the outbound TLS connection to WhatsApp; tini so that
# `docker compose down` stops the process rather than waiting out the timeout.
# A clean stop matters more here than elsewhere: the socket is closed WITHOUT
# logging out, which is what lets the next container reuse the session.
RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

RUN corepack enable

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/whatsapp/package.json ./apps/whatsapp/

# pnpm's node_modules is a tree of symlinks into node_modules/.pnpm, so both
# levels are copied whole: the top level alone would leave dangling links.
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=production-dependencies /app/apps/whatsapp/node_modules ./apps/whatsapp/node_modules

COPY --chown=node:node --from=build /app/apps/whatsapp/dist ./apps/whatsapp/dist

# The mount point for the session volume. Created and owned here so the path
# exists — and is writable by the unprivileged user — even before compose
# mounts anything over it.
RUN mkdir -p /app/session && chown -R node:node /app/session

# Never root. This process writes only to the session volume.
USER node

EXPOSE 3200

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/whatsapp/dist/index.js"]
