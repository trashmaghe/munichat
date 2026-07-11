# Build from the repo root: docker build -f apps/api/Dockerfile .
# (npm workspaces needs the whole tree, not just this package, to install
# correctly — see the package.json COPY set below.)

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# packages/shared/tsconfig.json and apps/api/tsconfig.json both
# `extends "../../tsconfig.base.json"` — tsc needs it on disk at build time
# or it fails with TS5083 (Cannot read file '.../tsconfig.base.json').
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
# apps/api's postinstall (`prisma generate`) fires during `npm ci` below and
# needs the schema on disk at that point — no DB connection required for
# `generate`, just the file.
COPY apps/api/prisma apps/api/prisma

RUN npm ci

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build:shared
RUN npm run build -w apps/api

# ---

FROM node:20-alpine AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/prisma apps/api/prisma

# --ignore-scripts is required, not optional: the `prisma` CLI isn't
# installed under --omit=dev, so the postinstall hook (prisma generate)
# would otherwise fail here.
RUN npm ci --omit=dev --ignore-scripts

# ---

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# Overlay the actually-generated Prisma client on top of prod-deps' stub —
# more reliable than depending on npm prune's treatment of an untracked
# generated directory.
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/node_modules/@prisma/client ./node_modules/@prisma/client
# The workspace symlink node_modules/@munichat/shared has no dist/ until this.
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
