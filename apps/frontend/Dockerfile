# The frontend, built and run for production.
#
# Built from the repository root, for the same reason as the backend:
#
#   docker build -f apps/frontend/Dockerfile .
#
# ── NEXT_PUBLIC_API_URL IS A BUILD-TIME VALUE ───────────────────────────────
# Next inlines every NEXT_PUBLIC_* variable into the JavaScript it sends to the
# browser. It is therefore fixed when `next build` runs, NOT when the container
# starts: setting it in compose's `environment:` alone would leave the browser
# calling whatever the image was built with.
#
# It is passed as a build argument instead, and compose passes the same value
# under `build.args`. An image built for one deployment cannot be reused for
# another with a different API host — which is the honest consequence of how
# Next works, not a limitation of this file.
# ────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependencies ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/parser/package.json ./apps/parser/

RUN pnpm install --frozen-lockfile

# ── Stage 2: build ──────────────────────────────────────────────────────────
FROM dependencies AS build

# The public API base URL, baked into the client bundle. Defaulted so a build
# without the argument still works locally; production always passes it.
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY apps/frontend ./apps/frontend

# Next reads NODE_ENV itself; setting it here keeps the build and the runtime
# on the same code paths.
ENV NODE_ENV=production

RUN pnpm --filter @tms/frontend build

# ── Stage 3: production dependencies ────────────────────────────────────────
FROM dependencies AS production-dependencies

# pnpm asks for confirmation before replacing an existing node_modules tree, and
# a build has no terminal to answer with. CI=true is pnpm's own documented
# answer: proceed without asking.
ENV CI=true

RUN pnpm install --frozen-lockfile --prod

# ── Stage 4: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# The Auth0 SDK fetches the tenant's OpenID configuration over TLS, so the
# runtime needs a trust store. tini forwards signals so the server stops
# promptly on `docker compose down`.
RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# Bind to every interface: the proxy reaches this container over the compose
# network, and Next's default localhost binding would refuse that connection.
ENV HOSTNAME=0.0.0.0

WORKDIR /app

RUN corepack enable

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/frontend/package.json ./apps/frontend/

COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=production-dependencies /app/apps/frontend/node_modules ./apps/frontend/node_modules

COPY --chown=node:node --from=build /app/apps/frontend/.next ./apps/frontend/.next
COPY --chown=node:node --from=build /app/apps/frontend/next.config.mjs ./apps/frontend/

USER node

EXPOSE 3100

ENTRYPOINT ["/usr/bin/tini", "--"]
# `next start`, never `next dev`: the development server recompiles on every
# request and serves unminified code.
CMD ["node", "apps/frontend/node_modules/next/dist/bin/next", "start", "apps/frontend", "--port", "3100", "--hostname", "0.0.0.0"]
