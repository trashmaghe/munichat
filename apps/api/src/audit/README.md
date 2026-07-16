# Audit Module

`audit.service.ts` — the first real writer to the `AuditLog` model (it has existed in the schema since Phase 1 with no code touching it). One method, `log(action, { userId?, metadata?, ip? })`, called best-effort: a logging failure is caught and logged via `Logger`, never thrown, so it can never block the action being audited.

First consumer: `RmmController.getRemoteControl` (`apps/api/src/rmm/rmm.controller.ts`) logs `rmm.remote_control.requested` every time a MeshCentral control URL is issued. This is the honest limit of what MuniChat can audit for that flow — it records that a session was *granted*, not what happened inside it (MeshCentral has its own session log, outside MuniChat's visibility).

No read/query endpoint exists yet — `docs/ideias-futuras.md` §2 calls that out as future work once there's more than one writer.
