---
description: Inmutabilidad de migraciones SQL congeladas en D1 y Control Plane
globs: "**/migrations/*.sql"
---
1. **Migraciones Congeladas Intocables:** Prohibido modificar `0001_phase1_iam_core.sql` .. `0007_hardening_outbox_and_audit.sql` en `packages/db-d1/migrations/`, ni las migraciones `0001_*` .. `0002_*` en `apps/control-plane` y `apps/federation-hub`.
2. **Evolución Ortogonal:** La evolución de Fase 2 entra exclusivamente en `packages/db-d1/migrations/0008_hash_chain_audit_and_cf_indexes.sql`.
