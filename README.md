<div align="center">

<img src="docs/assets/elyzian-mark.svg" width="116" alt="Elyzian" />

# Elyzian

### Municipal Communications Platform

**Prefeitura Municipal de Nova Serrana · Minas Gerais**

**English** · [Português](README.pt-br.md)

<br />

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React_18-20232A?logo=react&logoColor=61DAFB)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-24C8DB?logo=tauri&logoColor=white)

![Node.js](https://img.shields.io/badge/Node.js_20-5FA04E?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis_7-FF4438?logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![Caddy](https://img.shields.io/badge/Caddy-1F88C0?logo=caddy&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-06B6D4?logo=tailwindcss&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?logo=socketdotio&logoColor=white)

![License](https://img.shields.io/badge/license-Proprietary-6a7167)
![CI](https://github.com/trashmaghe/elyzian/actions/workflows/ci.yml/badge.svg)

</div>

A self-hosted, real-time communications platform for a municipal government —
replacing WhatsApp/Spark with **Active Directory** sign-in, department channels,
inline media (images, PDF, video, and voice notes), **GLPI** ticketing, and
**Tactical RMM** device alerts. It ships as a Dockerized stack, a native
**Windows desktop client**, and a one-wizard **enterprise installer** that
deploys the whole thing.

## Architecture

<div align="center">
  <img src="docs/assets/architecture.png" alt="How Elyzian fits together — clients, Caddy edge, web + API, data services, and GLPI/RMM integrations" width="100%" />
</div>

**How the pieces fit**

- **Clients** — the browser/PWA, a native **desktop client** (Tauri + Rust, a
  thin shell over the hosted web app that auto-updates), and the **enterprise
  installer** that stands the stack up.
- **Caddy edge** — terminates TLS with automatic Let's Encrypt certificates,
  speaks HTTP/2 + HTTP/3, and reverse-proxies the app and API.
- **Web** — a single React 18 SPA (Vite, TanStack Query, Zustand, Tailwind)
  served by nginx. It reads its API origin at runtime, so one prebuilt image
  serves any deployment. File uploads go **straight to MinIO** via presigned URLs.
- **API** — one NestJS app exposing REST **and** a Socket.IO gateway that share
  the same auth validator; a BullMQ worker handles link previews off the request
  path. Scales horizontally via the Redis Socket.IO adapter.
- **PostgreSQL** — the system of record (Prisma), with keyset-paginated history
  and full-text search.
- **Redis** — refresh-token store, presence, the Socket.IO pub/sub, and the job queue.
- **MinIO** — S3-compatible storage for every attachment.
- **OpenLDAP / Active Directory** — sign-in binds against the directory;
  department channels are provisioned from each user's `memberOf` groups.
- **GLPI / Tactical RMM** — `/ticket` opens helpdesk tickets and status flows
  back via a signed webhook; RMM device alerts post into a channel.

## Languages & stack

| Area | Built with |
|---|---|
| **Languages** | TypeScript · Rust · SQL · Shell · CSS · HTML |
| **Backend** | Node.js 20, NestJS, Socket.IO, BullMQ, Prisma |
| **Frontend** | React 18, Vite, TanStack Query, Zustand, Tailwind CSS, shadcn/Base UI |
| **Desktop** | Tauri 2 (Rust) — native Windows client + enterprise installer |
| **Data** | PostgreSQL 16, Redis 7, MinIO (S3) |
| **Directory** | Active Directory / OpenLDAP via `ldapts` |
| **Integrations** | GLPI (ticketing), Tactical RMM (monitoring) |
| **Edge / infra** | Docker Compose, Caddy (auto-TLS), Kubernetes manifests |
| **Testing** | Jest, Supertest, Vitest, React Testing Library |

## Desktop software

Two native Windows apps built with Tauri (a few MB each, OS WebView — not
Chromium), branded with the Elyzian asphodel:

- **Elyzian** — the client. A first-run screen takes the server address, then the
  window becomes the hosted app; it auto-updates itself.
- **Elyzian Enterprise Installer** — a seven-step wizard that checks for Docker,
  collects every credential/webhook, **downloads the app images**, and deploys
  the stack with Compose — streaming logs and finishing with a health check.

Installers are built for **Windows 10+ on x64, x86 (32-bit) and ARM64**. Windows
7 machines use the hosted app in a browser. See **[docs/desktop-apps.md](docs/desktop-apps.md)**.

## Quick start (development)

```bash
npm install
cp .env.example .env
npm run docker:up          # postgres, redis, minio, openldap
npm run prisma:migrate     # apply the schema
npm run dev                # shared (watch) + API + web
```

- API — http://localhost:3000 (health at `/health`)
- Web — http://localhost:5173
- MinIO console — http://localhost:9001

## Project structure

```
elyzian/
├── apps/
│   ├── api/                  # NestJS backend (REST + Socket.IO)
│   ├── web/                  # React SPA (Vite)
│   ├── desktop/              # Tauri desktop client
│   └── enterprise-installer/ # Tauri deploy wizard
├── packages/
│   └── shared/               # shared Zod DTOs + socket contracts
├── docker/                   # compose stacks (dev, images, edge) + configs
├── k8s/                      # Kubernetes manifests
└── docs/                     # architecture, desktop, deploy, pt-BR docs
```

## Documentation

- **[docs/deploy.md](docs/deploy.md)** — production deployment runbook (step by step)
- **[docs/architecture.md](docs/architecture.md)** — full architecture write-up
- **[docs/desktop-apps.md](docs/desktop-apps.md)** — the desktop client + enterprise installer
- **[docs/deploy-edge.md](docs/deploy-edge.md)** — production Caddy + auto-TLS edge
- **[docs/estrutura-do-codigo.md](docs/estrutura-do-codigo.md)** — module-by-module walkthrough (pt-BR)

## Scripts (from repo root)

| Script | Does |
|---|---|
| `npm run dev` | Run shared (watch) + API + web concurrently |
| `npm run build` / `lint` / `typecheck` / `test` | Across all workspaces |
| `npm run docker:up` / `docker:down` / `docker:logs` | Manage the local data services |
| `npm run prisma:migrate` / `prisma:generate` / `prisma:studio` | Prisma CLI wrappers |

`npm run test:e2e -w apps/api` runs the API's e2e tests (needs the Docker services up).

## Roadmap

- [x] **Foundation** — monorepo, Docker services, Prisma schema, CI
- [x] **Auth** — Active Directory (LDAPS) sign-in, JWT sessions, channel sync
- [x] **Chat core** — Socket.IO, history, presence, typing indicators
- [x] **Rich content** — uploads (MinIO), link previews, edit/delete/reply, inline media + voice notes, PDF preview
- [x] **Integrations** — GLPI `/ticket` + webhooks, Tactical RMM alerts
- [x] **Polish** — full-text search, rate limiting, notifications, PWA, unread badges
- [x] **Brand & delivery** — the Elyzian asphodel identity, native desktop apps, self-deploying enterprise installer
- [ ] **Next** — see [docs/ideias-futuras.md](docs/ideias-futuras.md)

<div align="center">
<br />
<img src="docs/assets/brasao-pmns.png" width="52" alt="Brasão de Nova Serrana" />
<br />
<sub>Built for the Prefeitura Municipal de Nova Serrana · MG</sub>
</div>
