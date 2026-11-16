# Phase 7 Implementation Plan: Taller/RMA, Salud/EHR/ABA, Legal/IOLTA, Finanzas GAAP, Portal y Automatización IA

> **For agentic workers:** Executed via Native Swarm (`shac-phase-7-vertical-packs`) using `model: "gemini-4-hydrogen-medium"` and `workspace: "inherit"`. Keep every `.ts`/`.tsx` `<= 300` lines, `"type": "module"`, `"sideEffects": false`, zero floats for money (`*Minor`/`*Bps`/`*Micros`), zero OS paths, additive SQL only (`0` `DROP TABLE`/`DROP COLUMN`).

**Goal:** Implementar Dominios 8, 9, 10 y 11: `@shac/db-d1` (`0005_phase7_services_cases_finance_portal.sql`), `@shac/mod-services` (RMA, taller, EVV geocercado), `@shac/mod-cases` (SOAP, co-firma, terapias ABA, `matters`/`dockets`), `@shac/mod-finance` (Trust/IOLTA con bloqueo estricto de sobregiro `422 TRUST_OVERDRAFT_BLOCKED` y libro diario GAAP balanceado), `@shac/mod-portal` (filtro SQL obligatorio `is_confidential = 0`) y `@shac/mod-automation` (`business_rules` + `InboxOps` *Proposal Cards* con aprobación humana en 1 clic), más integración en `@shac/node-worker` y `@shac/web-spa`.

---

## Task 1: `@shac/db-d1` — Dominios 8–11 & Migración `0005` (`db-author-5`)

- [x] **Step 1:** Crear `src/schema/{services.ts,cases-legal.ts,cases-med.ts,finance.ts,docs-automation.ts}` (`<= 300` lines/file), actualizar `src/scope.ts` & `src/index.ts`.
- [x] **Step 2:** Crear migración aditiva `migrations/0005_phase7_services_cases_finance_portal.sql` (incluyendo `CHECK (balance_minor >= 0)` en `fin_trust_escrow_ledgers` e `is_confidential` en `doc_attachments`/`comm_threads_and_messages`).
- [x] **Step 3:** Crear `test/phase7-schema.test.ts` en `workerd` y verificar `typecheck` + `test:run`.

## Task 2: `@shac/mod-services` (`packages/modules/services/**`) (`services-author`)

- [x] **Step 1:** Implementar `modServicesManifest` (`id: 'services'`): `services.work_orders.upsert`, `services.rma.claim`, `services.evv.record` (GPS + doble firma SVG).
- [x] **Step 2:** Verificar en `test/services.commands.test.ts` sobre `workerd`.

## Task 3: `@shac/mod-cases` (`packages/modules/cases/**`) (`cases-author`)

- [x] **Step 1:** Implementar `modCasesManifest` (`id: 'cases'`): `cases.med.soap_note` (con cola de co-firma `med_supervision_queue`), `cases.med.aba_trial`, `cases.legal.matter_docket`.
- [x] **Step 2:** Verificar en `test/cases.commands.test.ts` sobre `workerd`.

## Task 4: `@shac/mod-finance` (`packages/modules/finance/**`) (`finance-author`)

- [x] **Step 1:** Implementar `modFinanceManifest` (`id: 'finance'`): `finance.trust.transact` (bloqueo estricto de sobregiro `422 TRUST_OVERDRAFT_BLOCKED` en `fin_trust_escrow_ledgers` + `CHECK balance_minor >= 0`), `finance.journal.post` (exige `totalDebitMinor === totalCreditMinor` en `BigInt`).
- [x] **Step 2:** Verificar en `test/finance.commands.test.ts` sobre `workerd`.

## Task 5: `@shac/mod-portal` & `@shac/mod-automation` (`portal-auto-author`)

- [x] **Step 1:** Implementar `packages/modules/portal` (`modPortalManifest` `id: 'portal'`): `portal.records.list` aplicando filtro SQL estricto `eq(isConfidential, false)` (`is_confidential = 0`) en D1.
- [x] **Step 2:** Implementar `packages/modules/automation` (`modAutomationManifest` `id: 'automation'`): `automation.rules.evaluate` y `automation.proposals.decide` (*Proposal Cards* requiriendo aprobación humana explícita antes de ejecutar).
- [x] **Step 3:** Verificar en `test/portal.commands.test.ts` y `test/automation.commands.test.ts` sobre `workerd`.

## Task 6: Integración `@shac/node-worker`, `@shac/web-spa`, RDD Final & Deploy (`app-author-6`)

- [x] **Step 1:** Conectar los 5 módulos en `apps/node-worker`, añadir vistas `/cases`, `/finance`, `/portal`, `/automation` en `apps/web-spa`, y actualizar `knip.json`.
- [x] **Step 2:** Correr RDD completo (`typecheck`, `knip --strict`, `test:run`, `web-spa build`, `wrangler deploy --dry-run`), marcar `- [x]`, actualizar `DECISIONS.md` (`ADR-013`), commit en `main`, aplicar `0005` en `shac-primary` D1 remoto, actualizar `CONFIG_KV` y desplegar a `PC911 IT Services Global`.
