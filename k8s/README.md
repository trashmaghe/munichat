# Elyzian — Kubernetes (app tier)

**These manifests have never been applied to a real Kubernetes cluster.** No
cluster was available while writing them. They're best-effort-correct against
the Kubernetes API and against this repo's actual Dockerfiles/env vars, but
they need review by someone with real cluster access — at minimum a
`kubectl apply --dry-run=server -f k8s/` — before any production use.

## Scope

App tier only: `elyzian-api` and `elyzian-web`. Postgres, Redis, MinIO, and
LDAP/Active Directory are assumed external/managed (RDS, ElastiCache, a
managed MinIO/S3, real corporate AD, etc.) — there are no StatefulSets here.
Point the ConfigMap/Secret at wherever those actually live.

Out of scope, deliberately not covered by this PR:

- TLS / cert-manager wiring (add a `tls:` block + issuer annotation to
  `ingress.yaml` yourself once you have a domain and issuer)
- Container registry selection (all `image:` fields use
  `<REPLACE_WITH_REGISTRY>/...:<REPLACE_WITH_TAG>` placeholders)
- PodDisruptionBudgets, NetworkPolicies
- Data-tier StatefulSets (Postgres/Redis/MinIO/LDAP)
- Multi-environment image promotion beyond "rebuild the web image per
  environment" (see the build-arg note below)

## Prerequisites

- A cluster with the **ingress-nginx** controller installed
  (`ingress.yaml` uses `ingressClassName: nginx` and
  `nginx.ingress.kubernetes.io/*` annotations)
- The **metrics-server** add-on installed (required for `api-hpa.yaml`'s
  CPU-based autoscaling to have any metrics to act on)
- Credentials in hand for the external Postgres, Redis, MinIO/S3, and
  LDAP/AD instances this deployment will talk to
- A container registry you can push to

## Build, tag, push

Run from the repo root (both Dockerfiles expect the whole monorepo as their
build context):

```sh
docker build -f apps/api/Dockerfile -t <REGISTRY>/elyzian-api:<TAG> .
docker build -f apps/api/Dockerfile --target build -t <REGISTRY>/elyzian-api:<TAG>-migrator .
docker build -f apps/web/Dockerfile \
  --build-arg VITE_API_URL=https://api.<yourdomain> \
  --build-arg VITE_WS_URL=wss://api.<yourdomain> \
  -t <REGISTRY>/elyzian-web:<TAG> .

docker push <REGISTRY>/elyzian-api:<TAG>
docker push <REGISTRY>/elyzian-api:<TAG>-migrator
docker push <REGISTRY>/elyzian-web:<TAG>
```

**Known tradeoff:** Vite bakes `VITE_API_URL`/`VITE_WS_URL` into the static
bundle at build time, not at container start. That means the web image must
be rebuilt per environment (staging vs. prod point at different API
hostnames) — there's no single "build once, promote everywhere" image for
the web tier. A true runtime-injection fix (reading from a
`window.__ENV__` set by an entrypoint script) would require editing
`apps/web/src/lib/api-client.ts` / `socket.ts`, which is out of scope for
this infra-only PR.

Then replace every `<REPLACE_WITH_REGISTRY>/...:<REPLACE_WITH_TAG>`
placeholder in `api-deployment.yaml`, `web-deployment.yaml`, and
`api-migrate-job.yaml` with the real values above.

## Secrets

Don't apply `secret.example.yaml` as-is — it's a template. Preferred path,
so real credentials never touch a file in your checkout:

```sh
kubectl create secret generic elyzian-secret -n elyzian \
  --from-literal=DATABASE_URL='postgresql://user:pass@host:5432/elyzian?schema=public' \
  --from-literal=REDIS_URL='redis://:password@host:6379' \
  --from-literal=MINIO_ROOT_USER='...' \
  --from-literal=MINIO_ROOT_PASSWORD='...' \
  --from-literal=LDAP_BIND_PASSWORD='...' \
  --from-literal=JWT_ACCESS_SECRET="$(openssl rand -hex 32)" \
  --from-literal=JWT_REFRESH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=GLPI_APP_TOKEN='...' \
  --from-literal=GLPI_USER_TOKEN='...' \
  --from-literal=GLPI_WEBHOOK_SECRET='...'
```

See `secret.example.yaml` for the full list and for the file-based
alternative if you'd rather edit a (gitignored) `k8s/secret.yaml`.

Before applying `configmap.yaml`, replace every `REPLACE_ME` value with your
real `WEB_ORIGIN`, MinIO endpoint, GLPI URL, and LDAP/AD connection details.

## Apply order

```sh
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
# create the secret (see above), or: kubectl apply -f secret.yaml

kubectl apply -f api-migrate-job.yaml
kubectl wait --for=condition=complete job/elyzian-api-migrate -n elyzian --timeout=120s
kubectl delete -f api-migrate-job.yaml   # Job names are immutable; delete before reapplying next release

kubectl apply -f api-deployment.yaml
kubectl apply -f api-service.yaml
kubectl apply -f api-hpa.yaml

kubectl apply -f web-deployment.yaml
kubectl apply -f web-service.yaml

kubectl apply -f ingress.yaml
```

## Smoke test

Before pointing DNS/Ingress at it, port-forward directly to a pod:

```sh
kubectl port-forward -n elyzian deploy/elyzian-api 3000:3000
curl http://localhost:3000/health

kubectl port-forward -n elyzian deploy/elyzian-web 8080:80
curl http://localhost:8080/
```

Once Ingress is applied and DNS points `web.<domain>` / `api.<domain>` at
the ingress-nginx controller's external IP, confirm a browser session at
`web.<domain>` can complete the LDAP login flow and open a working
Socket.IO connection (check the browser network tab for a successful
`101 Switching Protocols` upgrade, or sustained long-polling if upgrade
fails) against `api.<domain>`.

## Design notes

- **Why `api` gets 2+ replicas safely:** `apps/api/src/chat/redis-io.adapter.ts`
  already wires `@socket.io/redis-adapter`, so Socket.IO broadcasts already
  propagate across instances via Redis pub/sub. Scaling past 1 replica
  without that adapter in place would silently break real-time delivery
  between clients connected to different pods.
- **Why the api Ingress has sticky sessions:** `apps/web/src/lib/socket.ts`
  doesn't force `transports: ['websocket']`, so the client starts on HTTP
  long-polling and upgrades later. The Redis adapter synchronizes broadcasts
  after a connection is established — it is not a distributed session store
  for the polling handshake's several sequential HTTP requests, which must
  all land on the same pod. Hence `nginx.ingress.kubernetes.io/affinity:
  cookie` on `elyzian-api`'s Ingress only.
- **Why liveness is `tcpSocket`, not `httpGet /health`:** `/health` does a
  real Prisma→Postgres ping. That's the right check for readiness (stop
  routing traffic here), but wrong for liveness — a transient DB blip would
  fail it too, and kubelet killing+restarting the pod wouldn't fix a
  downstream Postgres problem, just thrash while the identical check fails
  again right after restart.
- **Why no `web-hpa.yaml`:** nginx serving prebuilt static files is cheap
  enough per-request that CPU-based autoscaling has nothing meaningful to
  react to. A fixed `replicas: 2` gives HA without an autoscaler that would
  mostly sit idle. Add one later if real traffic data says otherwise.
- **Subdomain routing, not path-prefix:** `apps/api/src/main.ts` never calls
  `setGlobalPrefix()`, so API routes are genuinely unprefixed (`/health`,
  not `/api/health`). Path-prefix splitting at the ingress layer would need
  either an app-code change or rewrite rules that risk breaking Socket.IO's
  fixed `/socket.io/` path.
