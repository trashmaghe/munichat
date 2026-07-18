# Production edge — Caddy + automatic HTTPS

The `docker/docker-compose.edge.yml` overlay puts a **Caddy** reverse proxy in
front of the `web` and `api` containers. Caddy gives you, with no manual cert
handling:

- **Trusted TLS** — automatic [Let's Encrypt](https://letsencrypt.org)
  certificates, issued and **auto-renewed** for your domains.
- **HTTP/2 and HTTP/3** — enabled automatically.
- **Compression** — zstd/gzip on responses.
- **Security headers** — HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, and long-lived immutable caching on the hashed
  `/assets/*` bundle.

Local development and CI are unaffected — they talk to the containers directly
and never load this overlay.

## Architecture

Two subdomains, each on its own automatic certificate:

| Domain (`.env`) | Serves | Proxies to |
|---|---|---|
| `APP_DOMAIN` | the static SPA | `web:80` |
| `API_DOMAIN` | REST + WebSocket | `api:${PORT}` |

Keeping the API on its own subdomain matches the app's existing separate-origin
design (`WEB_ORIGIN` CORS + `VITE_API_URL`). Caddy upgrades the socket.io /
WebSocket connection transparently, so realtime chat works through the proxy.

## One-time setup

1. **DNS** — point both `APP_DOMAIN` and `API_DOMAIN` at the host's public IP
   (A/AAAA records). Open inbound **80** and **443** (TCP + UDP).
2. **`.env`** — set the edge block:
   ```
   APP_DOMAIN=chat.yourdomain.gov.br
   API_DOMAIN=api.chat.yourdomain.gov.br
   ACME_EMAIL=ti@yourdomain.gov.br
   WEB_ORIGIN=https://chat.yourdomain.gov.br
   ```
3. **Rebuild the web image against the real API origin.** Vite inlines
   `VITE_API_URL`/`VITE_WS_URL` at build time, so the image must be built with
   the HTTPS URLs:
   ```sh
   docker compose -f docker/docker-compose.yml \
     build web \
     --build-arg VITE_API_URL=https://api.chat.yourdomain.gov.br \
     --build-arg VITE_WS_URL=wss://api.chat.yourdomain.gov.br
   ```

## Run

```sh
docker compose \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.edge.yml \
  --env-file .env up -d
```

On first start Caddy provisions certificates (a few seconds). They're persisted
in the `caddy_data` volume, so restarts don't re-request them and you won't hit
Let's Encrypt rate limits.

## Notes

- **Staging certs while testing DNS:** add `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory`
  to the global block in `docker/caddy/Caddyfile` to avoid burning the
  production rate limit, then remove it once DNS is confirmed.
- In this overlay the `web`/`api` host port publications from the base compose
  are still present but no longer required — external traffic comes through
  Caddy on 80/443. You can drop those `ports:` in a hardened deployment.
- Kubernetes deployments should use cert-manager on the existing ingress
  instead of this overlay (see `k8s/`).
