# Elyzian desktop software

Two native Windows applications, both built with [Tauri](https://tauri.app)
(Rust shell + the OS WebView, so the installers are a few MB rather than
hundreds), branded with the Elyzian asphodel:

| App | Workspace | For | What it does |
|---|---|---|---|
| **Elyzian** (client) | `apps/desktop` | Every user | A native window onto the Elyzian web app. |
| **Elyzian Enterprise Installer** | `apps/enterprise-installer` | IT / the stack owner | A wizard that collects all credentials and **deploys the whole stack** to the server. |

Neither binary can be produced on Linux/CI-Ubuntu — building `.exe`/`.msi`
needs a Windows toolchain and (for distribution) code signing. The
[`desktop-build.yml`](../.github/workflows/desktop-build.yml) workflow builds
both on a `windows-latest` runner; the normal CI builds only the frontends.

---

## Elyzian client (`apps/desktop`)

A thin shell. Its bundled frontend is a first-run **connect screen** — the user
types their Elyzian server address (`chat.yourcity.gov.br`) and the WebView
navigates to the server's hosted web app. The address is remembered, so later
launches reconnect automatically (with a "Change server" escape). Nothing about
a deployment is baked into the binary, so **one build serves every city**.

```sh
npm run tauri:dev   -w @elyzian/desktop     # run locally
npm run tauri:build -w @elyzian/desktop     # produce installers
```

Output: `apps/desktop/src-tauri/target/release/bundle/{nsis,msi}/`.

## Elyzian Enterprise Installer (`apps/enterprise-installer`)

A guided, seven-step wizard (see `src/App.tsx`) that mirrors `.env.example`:

1. **Preflight** — checks Docker Engine, the daemon, Compose v2, and that it can
   find the stack (`docker/docker-compose.yml`).
2. **Database & cache** — Postgres + Redis (password generated).
3. **Object storage** — MinIO (password generated).
4. **Directory** — LDAP / Active Directory: URL, service-account bind DN +
   password, base DN, search bases, and the AD-vs-OpenLDAP attribute names.
5. **Integrations** — GLPI (ticketing) and Tactical RMM (monitoring) tokens +
   webhook secrets; optional.
6. **Networking & TLS** — the Caddy edge toggle, domains, and ACME email for
   automatic Let's Encrypt certificates.
7. **Review & Deploy** — shows the generated `.env` (secrets masked), writes it,
   then runs Docker Compose and streams the logs live, finishing with an API
   health check.

All secrets are generated with the WebView's Web Crypto and never leave the
machine. The `.env`-generation logic is pure TypeScript and unit-tested
(`src/lib/config.test.ts`).

### Native commands

The Rust backend (`src-tauri/src/lib.rs`) exposes four commands:

- `preflight` — is Docker present, running, and is the stack here?
- `write_env_file` — persist the generated `.env` beside the compose files.
- `deploy_stack` — `docker compose … up -d --build`, streaming output to the UI
  via the `deploy-log` event (edge overlay added when TLS is enabled).
- `stack_health` — probe the API's `/health` endpoint.

### Deployment model (v1)

The installer runs **inside the Elyzian server release directory** — the folder
containing `docker/`, `apps/`, and the Dockerfiles. Ship the installer together
with a checkout/release of the repo; the IT team runs it there, and Compose
builds the API/web images from that source on first boot. Requirements on the
server:

- **Docker Desktop / Engine** (Linux containers) with Compose v2.
- Ports open per your config; for the TLS edge, `80`/`443` and DNS for both
  domains pointing at the host.

```sh
npm run tauri:dev   -w @elyzian/enterprise-installer
npm run tauri:build -w @elyzian/enterprise-installer
```

> **Follow-up (not in v1):** publishing pre-built `api`/`web` images to a
> registry and shipping an images-only compose file would let the installer
> deploy without the source tree present (a smaller, faster download). The
> registry choice is deferred, matching the note in `ci.yml`.

---

## Building both locally (on Windows)

```sh
npm ci
rustup toolchain install stable
npm run tauri:build -w @elyzian/desktop
npm run tauri:build -w @elyzian/enterprise-installer
```

Signing: set up a code-signing certificate and Tauri's
[`bundle.windows.certificateThumbprint`](https://tauri.app/distribute/sign/windows/)
before distributing, so Windows SmartScreen doesn't warn users.
