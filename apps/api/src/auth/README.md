# Auth Module

Implemented in Phase 2:

- Active Directory (LDAPS in production, OpenLDAP locally/in CI) authentication via `ldapts` (`ldap.service.ts`).
- JWT issuance/refresh as httpOnly cookies (`auth.service.ts`, `auth.controller.ts`), with refresh tokens tracked in Redis for revocation and a `User.tokenVersion` for global/forced revocation.
- Channel sync from `memberOf` on login, including pruning memberships for AD groups the user has left (`channel-sync.service.ts`).

Deferred:

- Channels CRUD/admin API — Phase 3 (see `channels/README.md`). `channel-sync.service.ts` may be relocated there once that module exists.
