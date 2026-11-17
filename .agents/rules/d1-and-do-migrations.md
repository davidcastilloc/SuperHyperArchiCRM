---
description: Inmutabilidad de migraciones SQL congeladas en D1 y Control Plane
globs: "**/migrations/*.sql"
---
1. **Migraciones Congeladas Intocables:** Prohibido modificar `0001_phase1_iam_core.sql` .. `0006_phase8_physical_iot.sql` en `packages/db-d1/migrations/`, ni las migraciones `0001_*` en `apps/control-plane` y `apps/federation-hub`.
2. **Evolución Ortogonal:** Cualquier tabla o índice nuevo se agrega en `packages/db-d1/migrations/0007_hardening_outbox_and_audit.sql` o `apps/federation-hub/migrations/0002_envelope_nonces.sql`.
