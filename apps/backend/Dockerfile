# Backend container image.
#
# Built from the REPOSITORY ROOT, not from apps/backend, because this is a pnpm
# workspace: the lockfile, the workspace manifest and prisma/schema.prisma all
# live at the root and are required to resolve and generate.
#
#   docker build -f apps/backend/Dockerfile -t tms-backend .

# ---------------------------------------------------------------------------
# Stage 1 — install dependencies (cached independently of source changes)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS dependencies

RUN corepack enable

WORKDIR /repository

# Only the manifests, so this layer is reused whenever source changes but
# dependencies do not.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2 — generate the Prisma client and compile TypeScript
# ---------------------------------------------------------------------------
FROM dependencies AS build

COPY prisma.config.ts ./
COPY prisma ./prisma
COPY apps/backend ./apps/backend

# The generated client must exist before tsc runs: the backend imports its types.
RUN pnpm prisma generate

RUN pnpm --filter @tms/backend build

# Drop development dependencies now that compilation is finished.
RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /repository

# node:alpine already ships an unprivileged "node" user; running as root inside
# a container is an unnecessary risk.
USER node

COPY --from=build --chown=node:node /repository/node_modules ./node_modules
COPY --from=build --chown=node:node /repository/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=build --chown=node:node /repository/apps/backend/dist ./apps/backend/dist
COPY --from=build --chown=node:node /repository/apps/backend/package.json ./apps/backend/

WORKDIR /repository/apps/backend

# Documentation only — the published port is decided by the orchestrator.
EXPOSE 3000

CMD ["node", "dist/main.js"]
