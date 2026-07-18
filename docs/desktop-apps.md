# Elyzian desktop software

Two native Windows applications, both built with [Tauri](https://tauri.app)
(Rust shell + the OS WebView, so the installers are a few MB rather than
hundreds), branded with the Elyzian asphodel:

| App | Workspace | For | What it does |
|---|---|---|---|
| **Elyzian** (client) | `apps/desktop` | Every user | A native window onto the Elyzian web app; auto-updates itself. |
| **Elyzian Enterprise Installer** | `apps/enterprise-installer` | IT / the stack owner | A wizard that collects all credentials, **downloads the app images, and deploys the whole stack** to the server. |

## Platforms

Native installers are built for **Windows 10+** on **x64, x86 (32-bit), and
ARM64** (`desktop-build.yml`, a `windows-latest` matrix). The binaries can't be
produced on Linux/CI-Ubuntu — they need a Windows toolchain — so the normal CI
(`ci.yml`) builds only the frontends.

**Windows 7 is intentionally not a target.** Tauri v2, the WebView2 runtime, and
modern Rust all require Windows 10+ (Microsoft ended WebView2 support for Win7
in October 2024). Windows 7 machines use Elyzian through a **browser** instead —
the client is only a wrapper around the hosted web app, so a Win7 user opens
`https://chat.yourcity.gov.br` in Firefox ESR (still Win7-compatible) and gets
the full experience with no native install.

---

## Elyzian client (`apps/desktop`)

A thin shell. Its bundled frontend is a first-run **connect screen** — the user
types their Elyzian server address and the WebView navigates to the server's
hosted web app. The address is remembered, so later launches reconnect
automatically (with a "Change server" escape). **One build serves every city.**

```sh
npm run tauri:dev   -w @elyzian/desktop     # run locally
npm run tauri:build -w @elyzian/desktop     # produce installers
```

### Auto-update

The client checks a GitHub Release on launch and offers a one-click "Update &
restart" when a newer **signed** build is published (Tauri updater + process
plugins; `useUpdate.ts`).

Two pieces make it live:

1. **A signing keypair.** Generate one and keep the private key secret:
   ```sh
   npm run tauri -w @elyzian/desktop -- signer generate -w elyzian-updater.key
   ```
   Put the **public** key in `apps/desktop/src-tauri/tauri.conf.json`
   (`plugins.updater.pubkey`) — replace the placeholder committed there — and add
   two repo secrets: `TAURI_SIGNING_PRIVATE_KEY` (the private key) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
2. **Signed releases.** Push a `client-v*` tag; `release-desktop.yml` builds
   signed updater artifacts and publishes them (plus `latest.json`) to a GitHub
   Release, which the updater endpoint reads.

`createUpdaterArtifacts` is **off** in the committed config, so the ordinary
`desktop-build.yml` still builds without any secrets; the release workflow flips
it on where the key is present.

## Elyzian Enterprise Installer (`apps/enterprise-installer`)

A guided, seven-step wizard (`src/App.tsx`) mirroring `.env.example`:

1. **Preflight** — checks Docker Engine, the daemon, and Compose v2, with a
   **"Get Docker Desktop"** helper if it's missing, and confirms the stack files
   shipped inside the installer.
2. **Database & cache** — Postgres + Redis (password generated).
3. **Object storage** — MinIO (password generated).
4. **Directory** — LDAP / Active Directory: URL, service-account bind DN +
   password, base DN, search bases, and the AD-vs-OpenLDAP attribute names.
5. **Integrations** — GLPI + Tactical RMM tokens/webhook secrets; optional.
6. **Networking & TLS** — the Caddy edge toggle, domains, and ACME email.
7. **Review & Deploy** — shows the generated `.env` (secrets masked), then
   **downloads the images and starts the stack**, streaming the logs live and
   finishing with an API `/health` check.

Secrets are generated with Web Crypto and never leave the machine. The
`.env`-generation logic is pure TypeScript and unit-tested (`src/lib/config.test.ts`).

### How "download everything" works

The installer **bundles the small `docker/` compose tree** (compose files,
Caddyfile, LDAP seeds) as a Tauri resource — no app source. At deploy it:

1. copies that tree to a writable working directory and writes `.env` beside it;
2. runs `docker compose -f docker/docker-compose.images.yml … pull` — which
   **downloads the prebuilt `api`/`web` images** from the registry;
3. runs `… up -d` (adding `docker-compose.edge.yml` when TLS is enabled).

The images come from **GHCR**, published by `release-images.yml` (on a `v*` tag
or on demand) to `ghcr.io/<owner>/elyzian-{api,web}`. The registry and tag are
in `.env` (`ELYZIAN_REGISTRY`, `ELYZIAN_IMAGE_TAG`). The **web image reads its
API/WS origins at runtime** (`/config.js`, written by the container from
`VITE_API_URL`/`VITE_WS_URL`), so one prebuilt image serves any deployment.

Native commands (`src-tauri/src/lib.rs`): `preflight`, `open_url` (the Docker
helper), `deploy_stack` (stage → pull → up, streaming via the `deploy-log`
event), and `stack_health`.

Requirements on the server: **Docker Desktop / Engine** (Linux containers) with
Compose v2; ports per your config, and for the TLS edge, `80`/`443` open with
DNS for both domains pointing at the host.

```sh
npm run tauri:dev   -w @elyzian/enterprise-installer
npm run tauri:build -w @elyzian/enterprise-installer
```

---

## Building locally (on Windows)

```sh
npm ci
rustup toolchain install stable
rustup target add i686-pc-windows-msvc aarch64-pc-windows-msvc   # for x86 / ARM64
npm run tauri:build -w @elyzian/desktop            -- --target x86_64-pc-windows-msvc
npm run tauri:build -w @elyzian/enterprise-installer -- --target x86_64-pc-windows-msvc
```

Signing: set up a code-signing certificate and Tauri's
[`bundle.windows.certificateThumbprint`](https://tauri.app/distribute/sign/windows/)
before distributing, so Windows SmartScreen doesn't warn users. (This is
separate from the updater signing key above.)
