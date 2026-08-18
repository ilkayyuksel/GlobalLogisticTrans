# The backend, built and run for production.
#
# ── BUILT FROM THE REPOSITORY ROOT ──────────────────────────────────────────
#   docker build -f apps/backend/Dockerfile .
#
# The context is the whole workspace, not apps/backend, because the backend is
# not self-contained: it imports @tms/parser from apps/parser and the Prisma
# schema and migrations live at the root. Building from the app directory would
# mean copying files upward out of the context, which cannot be done.
# ────────────────────────────────────────────────────────────────────────────
#
# ── THE MONOREPO LAYOUT SURVIVES INTO THE RUNTIME IMAGE ─────────────────────
# The final image keeps /app/apps/backend, /app/apps/parser and /app/node_modules
# exactly as the repository has them. That is deliberate: @tms/parser is a
# workspace link, and pdfjs-dist is resolved from inside the parser at runtime
# through require.resolve. Flattening the layout is what broke that resolution
# once before; preserving it means the container resolves modules the same way
# the developer machine does.
# ────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependencies ───────────────────────────────────────────────────
# Every dependency, dev ones included: nest build and prisma generate need them.
FROM node:22-bookworm-slim AS dependencies

# openssl is what Prisma inspects to decide WHICH engine binary to download.
# Without it the slim image reports no version, Prisma falls back to the
# OpenSSL 1.1 build, and `migrate deploy` then tries to fetch the 3.0 one over
# the internet at startup — from a container that is deliberately on an
# offline network. Installing it here is what makes the right engine land in
# the image at build time.
RUN apt-get update   && apt-get install --no-install-recommends --yes ca-certificates openssl   && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# corepack ships with Node and pins pnpm to the version package.json names, so
# the image cannot drift from the lockfile the repository was resolved with.
RUN corepack enable

# Manifests first, so a change to source code does not invalidate the install
# layer — by far the most expensive one.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/parser/package.json ./apps/parser/

RUN pnpm install --frozen-lockfile

# ── Stage 2: build ──────────────────────────────────────────────────────────
FROM dependencies AS build

# The Prisma schema and the generator live at the root.
COPY prisma ./prisma
COPY prisma.config.ts ./

COPY apps/parser ./apps/parser
COPY apps/backend ./apps/backend

# The parser is built first: the backend compiles against its emitted types.
RUN pnpm --filter @tms/parser build

# Generated from the schema, not committed, so it must happen inside the image.
#
# `prisma generate` connects to nothing — it reads the schema and writes a
# client — but prisma.config.ts resolves DATABASE_URL when the CLI loads it, so
# the variable has to exist. A placeholder is passed for this command only: it
# is never stored in the image, and the real URL is supplied at runtime by
# compose.
RUN DATABASE_URL="postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder"   pnpm exec prisma generate

RUN pnpm --filter @tms/backend build

# ── Stage 3: the parser smoke test ──────────────────────────────────────────
# A real transport order, parsed by the real parser, inside the image that will
# run it. This is the check that pdfjs-dist resolves here — a build that passes
# every test on a developer machine and cannot load pdfjs in the container is
# exactly the failure this catches, and it catches it at build time rather than
# on the first email.
#
# It runs against the committed fixtures in docs/06-pdf, which are test
# documents rather than customer data, and neither the fixtures nor this stage
# reach the runtime image.
FROM build AS smoke-test

COPY docs/06-pdf ./docs/06-pdf
COPY docker/parser-smoke-test.cjs ./

# No pipe: the build must fail when the parser does, and a pipeline would
# report the exit code of the last command instead.
RUN node parser-smoke-test.cjs

# ── Stage 4: production dependencies ────────────────────────────────────────
# A clean install with the dev dependencies left out, and the Prisma client
# generated INTO it.
#
# Two things this deliberately does not do, both learned from failures the smoke
# test above caught:
#
#   * it does not prune the build tree. `pnpm prune --prod` at the workspace
#     root removed apps/parser/node_modules/pdfjs-dist, and the parser then
#     could not read a PDF at all;
#   * it does not copy the generated client out of the build stage. Prisma 7
#     generates into the @prisma/client package inside pnpm's store, whose
#     directory name carries a content hash — there is no stable path to copy.
#
# Generating here instead is what makes the runtime tree both complete and free
# of build tooling. The CLI is available because it is a production dependency:
# `prisma migrate deploy` runs from this image.
FROM dependencies AS production-dependencies

# CI=true answers pnpm's "replace node_modules?" prompt, which a build has no
# terminal for.
ENV CI=true

RUN pnpm install --frozen-lockfile --prod

COPY prisma ./prisma
COPY prisma.config.ts ./

RUN DATABASE_URL="postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder" \
  pnpm exec prisma generate

# ── Stage 5: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# Trust store for outbound TLS — the mailbox connection and Auth0's JWKS
# endpoint both need it, and the slim image does not carry one.
# tini reaps zombies and forwards signals, so `docker compose down` stops the
# process rather than waiting out the timeout.
RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

RUN corepack enable

# The workspace skeleton, so pnpm and Node resolve exactly as they do in
# development.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/backend/package.json ./apps/backend/
COPY --chown=node:node apps/parser/package.json ./apps/parser/

# The production tree, with the generated Prisma client and every workspace
# dependency — pdfjs-dist among them — intact. pnpm's node_modules is a tree of
# symlinks into node_modules/.pnpm, so each is copied whole: copying only the
# top level would leave dangling links.
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=production-dependencies /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --chown=node:node --from=production-dependencies /app/apps/parser/node_modules ./apps/parser/node_modules

COPY --chown=node:node --from=build /app/apps/parser/dist ./apps/parser/dist
COPY --chown=node:node --from=build /app/apps/backend/dist ./apps/backend/dist

# The schema and migrations: `prisma migrate deploy` runs from this image, as a
# separate one-shot container before the backend starts. The CLI is a runtime
# dependency for exactly that reason, so the production install keeps it.
COPY --chown=node:node --from=production-dependencies /app/prisma ./prisma
COPY --chown=node:node --from=production-dependencies /app/prisma.config.ts ./prisma.config.ts

# What the smoke test read, carried into the image.
#
# It is here for a second reason as well: Docker builds only the stages a target
# depends on, so without this line the smoke-test stage would be skipped
# entirely by `--target runtime` and the check would silently never run.
COPY --chown=node:node --from=smoke-test /parser-smoke.txt ./parser-smoke.txt

# Where uploaded and emailed transport orders are written. A named volume is
# mounted here by compose; the directory is created so the path exists even when
# it is not, and is owned by the unprivileged user that writes to it.
RUN mkdir -p /app/storage/pdf && chown -R node:node /app/storage

# Never root. The application writes only to the storage volume.
USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/backend/dist/main.js"]
