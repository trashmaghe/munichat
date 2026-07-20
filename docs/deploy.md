# Deploying Elyzian — production runbook

A step-by-step for a **professional, single-host** deployment: the full stack in
Docker, behind the **Caddy edge** with automatic HTTPS, pulling **prebuilt
images** so the server needs no source. Aimed at an IT/ops team.

> Prefer a GUI? The **Enterprise Installer** ([docs/desktop-apps.md](desktop-apps.md))
> automates steps 4–6 on Windows Server. This runbook is the auditable,
> reproducible path most teams want for production.

---

## 0. Topology

```
                 ┌──────────── your server ────────────┐
  browsers ──►   │  Caddy (443, auto-TLS)               │
  desktop  ──►   │    ├─ APP_DOMAIN → web (nginx SPA)    │
                 │    └─ API_DOMAIN → api (NestJS)       │
                 │  api ─► postgres · redis · minio      │
                 │  api ─► Active Directory (LDAPS)      │
                 └──────────────────────────────────────┘
      external:  GLPI (tickets) · Tactical RMM (alerts)  — optional
```

See the diagram in the [README](../README.md#architecture) for the full picture.

---

## 1. Prerequisites

**Host**
- Linux server **or** Windows Server with Docker Desktop in **Linux-container** mode.
- **Docker Engine + Compose v2** (`docker compose version`).
- Sizing to start: **2 vCPU / 4 GB RAM / 40 GB disk**; scale up with usage.
  Postgres and MinIO data live in named volumes — put them on durable storage.

**Network / DNS**
- Two DNS **A/AAAA** records at the host's public IP:
  - `APP_DOMAIN` — e.g. `chat.novaserrana.mg.gov.br`
  - `API_DOMAIN` — e.g. `api.chat.novaserrana.mg.gov.br`
- Inbound **80 and 443** (TCP **and** UDP for HTTP/3) open. Let's Encrypt needs 80 reachable.

**Directory**
- Reachable **Active Directory / LDAP** and a **read-only service account** for binding.
  (Or use the bundled OpenLDAP for a pilot — see step 4, option B.)

**Optional integrations**
- **GLPI** URL + app/user tokens · **Tactical RMM** URL + API key. Leave blank to skip.

---

## 2. Publish the images (once, from CI)

The stack pulls `api`/`web` images from **GHCR**. Publish them from a machine with repo access:

1. Push a version tag **or** run the workflow manually:
   ```sh
   git tag v0.1.0 && git push origin v0.1.0     # triggers .github/workflows/release-images.yml
   ```
   This builds and pushes `ghcr.io/<owner>/elyzian-api` and `-web`.
2. Make the two GHCR packages **public** (GitHub → your profile/org → Packages →
   each package → *Package settings* → visibility **Public**).
   *Private?* Then on the server run `docker login ghcr.io` with a PAT that has
   `read:packages` before deploying.

> No CI / air-gapped? Build on a build host and `docker save | docker load`, or
> deploy build-from-source with `docker/docker-compose.yml` instead of the
> images file.

---

## 3. Put the deploy files on the server

You only need the `docker/` tree and a `.env` — not the whole source:

```sh
sudo mkdir -p /opt/elyzian && cd /opt/elyzian
# copy the repo's docker/ directory and .env.example here
#   (git sparse-checkout, scp, or a release tarball)
```

You should end up with `/opt/elyzian/docker/…` and `/opt/elyzian/.env.example`.

---

## 4. Configure `.env`

```sh
cp .env.example .env
```

Generate **strong, shell-safe secrets** (alphanumeric — avoids DSN/URL escaping):

```sh
gen() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-40}"; echo; }
gen 40   # run for each: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (must differ),
         #                POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD
```

Edit `.env` and set at least:

| Group | Keys |
|---|---|
| **Postgres** | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `DATABASE_URL` using the **same** values with host `postgres` (e.g. `postgresql://elyzian:<pw>@postgres:5432/elyzian?schema=public`) |
| **MinIO** | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET` |
| **JWT** | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (different values) |
| **Domains / TLS** | `APP_DOMAIN`, `API_DOMAIN`, `ACME_EMAIL`, `WEB_ORIGIN=https://<APP_DOMAIN>`, `VITE_API_URL=https://<API_DOMAIN>`, `VITE_WS_URL=wss://<API_DOMAIN>` |
| **Images** | `ELYZIAN_REGISTRY=ghcr.io/<owner>`, `ELYZIAN_IMAGE_TAG=v0.1.0` |
| **Integrations** | `GLPI_*`, `RMM_*` (or leave blank) |

### Directory — pick ONE

**Option A — corporate Active Directory (recommended for production).**
Point the app at your DC and **remove the bundled OpenLDAP** so nothing extra runs:

```
LDAP_URL=ldaps://dc01.novaserrana.mg.gov.br:636
LDAP_BIND_DN=CN=elyzian-svc,OU=Service Accounts,DC=novaserrana,DC=mg,DC=gov,DC=br
LDAP_BIND_PASSWORD=<service-account-password>
LDAP_BASE_DN=DC=novaserrana,DC=mg,DC=gov,DC=br
LDAP_USER_SEARCH_BASE=OU=Users,DC=novaserrana,DC=mg,DC=gov,DC=br
LDAP_GROUP_SEARCH_BASE=OU=Groups,DC=novaserrana,DC=mg,DC=gov,DC=br
LDAP_USERNAME_ATTRIBUTE=sAMAccountName
LDAP_UNIQUE_ID_ATTRIBUTE=objectGUID
```

Then edit `docker/docker-compose.images.yml`: **delete the whole `openldap:`
service block**, and remove the two lines under `api:` → `depends_on:` that
reference it:
```yaml
      openldap:
        condition: service_healthy
```
(The API talks to your DC directly; it must not wait on a local LDAP container.)

**Option B — bundled OpenLDAP (pilot / no AD yet).**
Keep the `openldap` service and set `LDAP_URL=ldap://openldap:389`,
`LDAP_BIND_DN=cn=admin,dc=elyzian,dc=local`, `LDAP_BASE_DN=dc=elyzian,dc=local`.
Seed your users/groups by editing `docker/ldap/bootstrap.ldif` before first boot.

---

## 5. Deploy

From `/opt/elyzian`:

```sh
# 1) download the images
docker compose -f docker/docker-compose.images.yml -f docker/docker-compose.edge.yml \
  --env-file .env pull

# 2) start everything (DB migrations run automatically via the api-migrate step)
docker compose -f docker/docker-compose.images.yml -f docker/docker-compose.edge.yml \
  --env-file .env up -d
```

On first start Caddy provisions certificates (a few seconds, once DNS resolves).
The `api-migrate` service runs `prisma migrate deploy` and the API waits for it,
so the schema is applied before the app accepts traffic.

> **Tip — validate DNS with staging certs first.** Add
> `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` to the global
> block in `docker/caddy/Caddyfile` while testing, then remove it and re-deploy
> to get trusted certs (avoids Let's Encrypt rate limits). See [deploy-edge.md](deploy-edge.md).

---

## 6. Verify

```sh
docker compose -f docker/docker-compose.images.yml -f docker/docker-compose.edge.yml ps   # all healthy/up
curl -fsS https://<API_DOMAIN>/health && echo OK                                          # API healthy
```

- Open `https://<APP_DOMAIN>` → the sign-in screen loads over HTTPS.
- Sign in with a directory account → department channels appear (provisioned
  from the user's `memberOf` groups).
- MinIO console (admin only): `http://<host>:9001` — confirm the bucket exists.
- If login fails, it's almost always LDAP: `docker compose logs -f api` and check
  the bind DN/URL/base DN.

---

## 7. Harden (before real users)

- **Secrets** — keep `.env` `chmod 600`, owned by the deploy user; never commit
  it. Rotate the generated secrets from the pilot before go-live.
- **Firewall** — expose only 80/443 publicly. Behind the edge, the
  `postgres`/`redis`/`minio`/`api`/`web` host-port publications aren't needed
  externally; bind them to `127.0.0.1` or drop the `ports:` in a hardened
  override so only Caddy is reachable.
- **TLS** — trusted certs only (remove the staging `acme_ca` line). HSTS and
  security headers are already set by the edge.
- **Backups** — see below; test a restore before you rely on it.
- **Updates** — track a pinned `ELYZIAN_IMAGE_TAG`, not `latest`, so deploys are
  deterministic and rollbackable.

---

## 8. Operations

**Logs**
```sh
docker compose -f docker/docker-compose.images.yml -f docker/docker-compose.edge.yml logs -f api
```

**Update to a new version**
```sh
# publish the new image tag from CI, then on the server:
sed -i 's/^ELYZIAN_IMAGE_TAG=.*/ELYZIAN_IMAGE_TAG=v0.2.0/' .env
docker compose -f docker/docker-compose.images.yml -f docker/docker-compose.edge.yml --env-file .env pull
docker compose -f docker/docker-compose.images.yml -f docker/docker-compose.edge.yml --env-file .env up -d
```
New migrations apply automatically on the way up.

**Roll back** — set `ELYZIAN_IMAGE_TAG` back to the previous tag and re-run
`pull` + `up -d`. (Roll back only if the newer release had no destructive
migration.)

**Backups**
```sh
# Postgres (the system of record)
docker compose ... exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > pg-$(date +%F).sql.gz

# MinIO (attachments) — mirror the bucket out with the mc client, or snapshot the
# minio_data volume with your backup tooling.
```
Schedule these (cron/systemd timer) and copy off-host. `redis_data` is
transient (presence/queue) and needs no backup.

**Restore (Postgres)**
```sh
gunzip -c pg-YYYY-MM-DD.sql.gz | docker compose ... exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

**Scale the API horizontally** — the Socket.IO Redis adapter supports multiple
API instances. Drop the `api` `ports:` publication (let Caddy load-balance the
`api` service) and run `... up -d --scale api=3`. Postgres/Redis/MinIO stay single.

---

## 9. Alternatives

- **Enterprise Installer** — the same deploy as a Windows wizard (Docker check →
  config → pull → up). See [docs/desktop-apps.md](desktop-apps.md).
- **Build from source** (no registry) — swap `docker-compose.images.yml` for
  `docker-compose.yml` and add `--build` to `up`; the server then needs the full
  repo checked out.
- **Kubernetes** — manifests live in [`k8s/`](../k8s); use cert-manager on the
  ingress instead of the Caddy overlay.

---

## Quick reference

```sh
cd /opt/elyzian
C="docker compose -f docker/docker-compose.images.yml -f docker/docker-compose.edge.yml --env-file .env"
$C pull && $C up -d      # deploy / update
$C ps                    # status
$C logs -f api           # logs
$C down                  # stop (keeps volumes/data)
```
