# RMM Module (Tactical RMM)

- `rmm.module.ts` — leaf module exporting `RmmService`, the Tactical RMM REST client (`X-API-KEY` auth), plus `RmmController` which exposes `GET /rmm/agents` and `GET /rmm/agents/:agentId` (read-only device inventory) to members of the configured alert channel.
- `rmm-webhook.module.ts` — top-level module exposing `POST /webhooks/rmm/alerts`, which receives Tactical RMM's outbound Alert Template webhook, posts a `SYSTEM` message into the configured channel (or opens a GLPI ticket via the existing `/ticket` flow for alerts at or above `RMM_AUTO_TICKET_SEVERITY`), and broadcasts it over the existing chat socket — mirroring `glpi-webhook.module.ts`.

Tactical RMM's webhook body is a JSON template you author yourself in its Alert Template UI (using `{{ }}` variables like `{{agent.hostname}}`, `{{alert.message}}`), so the receiving contract here — `alertId`, `hostname`, `client`, `site`, `severity`, `message`, `resolved` (`packages/shared/src/rmm.dto.ts`) — is one MuniChat defines; the Alert Template must be configured to emit exactly that shape. Unlike GLPI's HMAC-signed webhook, Tactical RMM can't sign the body, so `RMM_WEBHOOK_SECRET` is checked as a static `Authorization: Bearer <token>` header instead.

Alert-authored messages are posted by a fixed, seeded system user (`username: rmm-bot`, migration `20260716140000_add_rmm_alert_ref_and_system_user`) rather than any real person — `MessagesService.createSystemMessage()` is generic enough for future bot integrations to reuse the same account.

Resolved/unresolved state is tracked in `RmmAlertRef` (keyed on Tactical RMM's `alertId`, mirroring how `TicketRef` tracks GLPI ticket status) so a later "resolved" webhook can find and update the original chat message instead of posting a new one.

Configured via `RMM_URL`, `RMM_API_KEY`, `RMM_WEBHOOK_SECRET` (optional), `RMM_ALERT_CHANNEL_NAME`, `RMM_AUTO_TICKET_SEVERITY` — see `.env.example`.

**Scope note:** this module is inbound/read-only by design — receiving alerts and listing agents, nothing that runs code on a managed device. Tactical RMM's script/command endpoints (`POST /agents/{id}/runscript/`, `POST /agents/{id}/cmd/`) are intentionally not wired up; MuniChat has no global-admin concept yet to gate that kind of remote-execution surface behind.
