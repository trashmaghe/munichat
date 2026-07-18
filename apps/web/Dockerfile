# Build from the repo root: docker build -f apps/web/Dockerfile .
#
# The API/WebSocket origins are resolved at RUNTIME (window.__ELYZIAN__, written
# to /config.js by docker-entrypoint.sh from VITE_API_URL/VITE_WS_URL at
# container start), so ONE prebuilt image serves any deployment — no rebuild per
# environment. The build ARGs below remain only as the fallback baked into the
# bundle for source builds where no runtime config is present.

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# packages/shared/tsconfig.json `extends "../../tsconfig.base.json"` — tsc
# needs it on disk at build time or it fails with TS5083 (Cannot read file
# '.../tsconfig.base.json').
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

# --ignore-scripts: this is a single-lockfile workspace, so a plain `npm ci`
# here would also try to run apps/api's postinstall (prisma generate), which
# would fail since apps/api/prisma isn't copied into this image at all — the
# web build has nothing to do with Prisma and needs no postinstall of its own.
RUN npm ci --ignore-scripts

COPY packages/shared packages/shared
COPY apps/web apps/web

ARG VITE_API_URL=http://localhost:3000
ARG VITE_WS_URL=ws://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

RUN npm run build:shared
RUN npm run build -w apps/web

# ---

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
# Regenerates /config.js from the container's env before nginx starts, so the
# API/WS origins are set per deployment without rebuilding the image.
COPY apps/web/docker-entrypoint.sh /docker-entrypoint.d/40-elyzian-config.sh
RUN chmod +x /docker-entrypoint.d/40-elyzian-config.sh
EXPOSE 80
