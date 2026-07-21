# Auth Module

Implemented in Phase 2:

- Active Directory (LDAPS in production, OpenLDAP locally/in CI) authentication via `ldapts` (`ldap.service.ts`).
- JWT issuance/refresh as httpOnly cookies (`auth.service.ts`, `auth.controller.ts`), with refresh tokens tracked in Redis for revocation and a `User.tokenVersion` for global/forced revocation.
- Channel sync from the account's AD department (its immediate parent OU, e.g. "Tecnologia da Informacao") on login, including pruning the AD-linked channel membership when the department changes (`channel-sync.service.ts`). No AD group/GPO changes needed — it's read from where the account already sits in the OU tree.

Deferred:

- Channels CRUD/admin API — Phase 3 (see `channels/README.md`). `channel-sync.service.ts` may be relocated there once that module exists.
