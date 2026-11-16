# Phase 6 Implementation Plan: Espacios, Hotelería (PMS), Condominios y Agenda

> **For agentic workers:** Executed via Native Swarm (`shac-phase-6-spaces-pms-leases`) using `model: "gemini-4-hydrogen-medium"` and `workspace: "inherit"`. Keep every `.ts`/`.tsx` `<= 300` lines, `"type": "module"`, `"sideEffects": false`, zero floats for money (`*Minor`/`*Bps`/`*Micros`), zero OS paths, additive SQL only (`0` `DROP TABLE`/`DROP COLUMN`).

**Goal:** Implementar Dominio 7 completo: migración `0004_phase6_spaces_leases.sql` en `@shac/db-d1` (`10` tablas `spc_*`/`lease_*`/`condo_*`), `@shac/mod-spaces` (*Live Space Rack*, reservas OTA, *Quick Check-In*, Folios abiertos, *Housekeeping*, ADR/RevPAR, `WaitlistManager` y prueba de ráfaga de **30 reservas simultáneas contra la misma unidad en `hot_space_locks` con 0 dobles reservas**), `@shac/mod-leases` (`LeasingApplication`, contrato `Lease` + *escrow*, *Autopay*, **Split Rent**, renovaciones, `VacateNotice`, `condo_community_hub`), e integración en `@shac/node-worker` y `@shac/web-spa`.

---

## Task 1: `@shac/db-d1` — Dominio 7 (`10` Tablas) & Migración `0004` (`db-author-4`)

- [x] **Step 1:** Crear `packages/db-d1/src/schema/spaces.ts` (`spcUnitTypes`, `spcUnits`, `spcAvailabilityRules`, `spcBookingsAndAppointments`, `spcWaitlist`, `spcFolios`, `spcHousekeepingTasks`).
- [x] **Step 2:** Crear `packages/db-d1/src/schema/leases.ts` (`leaseApplications`, `leaseContractsAndRenewals`, `condoCommunityHub`).
- [x] **Step 3:** Actualizar `packages/db-d1/src/scope.ts` y `packages/db-d1/src/index.ts`, crear `migrations/0004_phase6_spaces_leases.sql` (10 tablas aditivas, 0 `DROP`) y `test/phase6-schema.test.ts` en `workerd`.

## Task 2: `@shac/mod-spaces` (`packages/modules/spaces/**`) (`spaces-author`)

- [x] **Step 1:** Crear `packages/modules/spaces/{package.json,tsconfig.json,vitest.config.ts,wrangler.test.jsonc}` (`"name": "@shac/mod-spaces"`, `"type": "module"`, `"sideEffects": false`).
- [x] **Step 2:** Implementar `src/pms-math.ts` (cálculo entero de **ADR** y **RevPAR** en `*Minor`/`*Bps` con `BigInt`) y comandos (`moduleId: 'spaces'`, `mcp.expose: true`):
  - `spaces.rack.list` (`GET /api/spaces/rack`, `db.batch()` `<= 2` queries con alias explícitos).
  - `spaces.bookings.reserve` (`POST /api/spaces/bookings/reserve`, bloquea en `BranchInventoryDO` `/space-lock` + persiste `spc_bookings_and_appointments` + `spc_folios`).
  - `spaces.bookings.checkin_checkout` (`POST /api/spaces/bookings/transition`, *Quick Check-In* y *Check-Out* creando automáticamente tarea en `spc_housekeeping_tasks`).
  - `spaces.waitlist.manage` (`POST /api/spaces/waitlist`).
- [x] **Step 3:** Implementar `test/spaces.concurrency.test.ts` en `workerd` (**Recibo Obligatorio de Fase 6**: `Promise.all` con **30 reservas simultáneas contra la misma habitación/unidad** en `BranchInventoryDO` `hot_space_locks` -> exactamente `1` exitosa `200` y `29` rechazadas `409 SPACE_ALREADY_LOCKED`, `0` dobles reservas, ADR/RevPAR, `<= 2` queries D1, idempotencia y aislamiento multi-tenant).

## Task 3: `@shac/mod-leases` (`packages/modules/leases/**`) (`leases-author`)

- [x] **Step 1:** Crear `packages/modules/leases/{package.json,tsconfig.json,vitest.config.ts,wrangler.test.jsonc}` (`"name": "@shac/mod-leases"`, `"type": "module"`, `"sideEffects": false`).
- [x] **Step 2:** Implementar `src/split-rent.ts` (calculadora **Split Rent** en `BigInt` por `shareBps` sumando `10_000` bps con asignación determinista de residuo para que la suma de cuotas iguale el total exacto).
- [x] **Step 3:** Implementar comandos (`moduleId: 'leases'`, `mcp.expose: true`): `leases.applications.submit`, `leases.contracts.activate` (contrato + depósito *escrow* + *Autopay* + Split Rent), `leases.contracts.renew_or_vacate` (`renewal_offer` / `vacate_notice`), `leases.community.post` (`condo_community_hub`).
- [x] **Step 4:** Implementar `test/leases.commands.test.ts` en `workerd` verificando Split Rent exacto, *escrow*, *Autopay*, renovaciones, `VacateNotice`, idempotencia y aislamiento multi-tenant.

## Task 4: Integración `@shac/node-worker` + `@shac/web-spa` + RDD Final & Deploy (`app-author-5`)

- [x] **Step 1:** Conectar `@shac/mod-spaces` y `@shac/mod-leases` en `apps/node-worker` (`spaces-leases-registry.ts`, rutas REST + MCP `/mcp`), añadir vistas `/spaces` (Live Rack + Waitlist) y `/leases` (Split Rent + Community Hub) en `apps/web-spa`, y actualizar `knip.json`.
- [x] **Step 2:** Correr RDD completo (`typecheck`, `knip --strict`, `test:run`, `web-spa build`, `wrangler deploy --dry-run` `gzip < 500 KiB`), marcar `- [x]`, agregar `ADR-012`, commit en `main`, aplicar `0004` en `shac-primary` D1 remoto, actualizar `CONFIG_KV` (`spaces`, `leases`) y desplegar a `PC911 IT Services Global`.
