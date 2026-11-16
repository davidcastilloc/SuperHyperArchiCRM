# Phase 4 Implementation Plan: Control Plane, App Store KV, `@shac/editions` y Licencias Híbridas HMAC

> **For agentic workers:** Executed via Native Swarm (`shac-phase-4-control-plane-app-store`) using `model: "gemini-4-hydrogen-medium"` and `workspace: "inherit"`. Keep every `.ts`/`.tsx` `<= 300` lines, `"type": "module"`, `"sideEffects": false`, zero floats for money, zero OS paths, additive SQL only (`0` `DROP TABLE`/`DROP COLUMN`).

**Goal:** Implementar el Control Plane multi-tenant (`@shac/control-plane`), los 4 Family Packs + 9 Presets del App Store (`@shac/editions`), licencias híbridas `HMAC-SHA256`, telemetría preventiva (`WARN_75` sobre `BYOC_FREE`), rollouts por anillos y conmutación de módulos en `0 ms` sobre `CONFIG_KV` en `@shac/node-worker` y `@shac/web-spa`.

---

## Task 1: `@shac/editions` (`editions/presets/**`) (`editions-author`)

- [x] **Step 1:** Crear `editions/presets/{package.json,tsconfig.json,vitest.config.ts}` (`"name": "@shac/editions"`, `"type": "module"`, `"sideEffects": false`, deps `@shac/kernel`, `zod`).
- [x] **Step 2:** Implementar `src/family-packs.ts` (los 4 Family Packs: `commerce-wms`, `spaces-stays`, `cases-practice`, `physical-iot`).
- [x] **Step 3:** Implementar `src/presets-catalog.ts` (los 9 Presets de `SPEC.md` §5: `retail-pos`, `distro-wms`, `tech-service`, `hospitality-pms`, `property-condo`, `clinic-practice`, `legal-psa`, `industrial-gate`, `omni-enterprise`).
- [x] **Step 4:** Implementar `src/app-store-merger.ts` (`buildMarketProfileFromPreset`, `applyAppStoreToggle` preservando `core`/`iam`, `tenantId`, `deploymentId`, monedas/vocabulario en `0 ms`) e `index.ts`.
- [x] **Step 5:** Implementar `test/editions.test.ts` y correr `pnpm --filter @shac/editions typecheck && test:run`.

## Task 2: `@shac/control-plane` (`apps/control-plane/**`) (`cp-author`)

- [x] **Step 1:** Crear `apps/control-plane/{package.json,tsconfig.json,vitest.config.ts,wrangler.test.jsonc}` con D1 `CP_DB` + KV `CP_KV`.
- [x] **Step 2:** Crear `migrations/0001_control_plane_core.sql` y `src/schema.ts` con las 5 tablas (`cp_deployments`, `cp_market_profiles`, `cp_appliance_licenses`, `cp_telemetry_daily`, `cp_rollout_jobs`).
- [x] **Step 3:** Implementar `src/license-hmac.ts` (`signApplianceLicense`, `verifyApplianceLicense` WebCrypto `HMAC-SHA256`), `src/telemetry-and-rollout.ts` (`evaluateQuotaTelemetry` con `WARN_75` en `BYOC_FREE`, `planRingRolloutBatches` respetando `1200 req / 5 min`).
- [x] **Step 4:** Implementar `src/provisioning.ts`, `src/router.ts`, `src/index.ts` (`/api/cp/deployments`, `/api/cp/deployments/:id/app-store`, `/api/cp/licenses/{issue,verify}`, `/api/cp/telemetry/ingest`, `/api/cp/rollouts/plan`).
- [x] **Step 5:** Implementar `test/control-plane.worker.test.ts` en `workerd` y verificar `typecheck` + `test:run`.

## Task 3: Integración App Store `0 ms` en `@shac/node-worker`, Vista `/app-store` en `@shac/web-spa` y `knip.json` (`app-author-3`)

- [x] **Step 1:** Añadir `@shac/editions` y `@shac/control-plane` a `apps/node-worker/package.json`; crear `src/system-routes.ts` (`GET /api/system/profile`, `POST /api/system/app-store/toggle` + `/api/system/reload-profile`, `POST /api/system/license/verify`) y registrar tools MCP `system.app_store.{get_profile,toggle_modules}`.
- [x] **Step 2:** Implementar `apps/node-worker/test/phase4.hot-switch.worker.test.ts` en `workerd` (**Recibo de Fuego de Fase 4**: iniciar `retail-pos`, crear datos en D1 y `BranchInventoryDO`, conmutar módulos en caliente `0 ms`, confirmar `403 MODULE_NOT_ENABLED` al apagar y `200 OK` + datos intactos al encender nuevos mercados).
- [x] **Step 3:** Crear `apps/web-spa/src/views/AppStoreView.tsx` y ruta `/app-store` en `apps/web-spa/src/main.tsx`; actualizar `knip.json`.

## Task 4: RDD Final, Commit, Despliegue en Vivo (`PC911 IT Services Global`) y Prueba de Hot-Switch (`verifier-4` + `coordinator`)

- [x] **Step 1:** Verificar `pnpm -r typecheck`, `pnpm dlx knip --strict`, `pnpm -r --workspace-concurrency=1 test:run`, `pnpm --filter @shac/web-spa build`, `wrangler deploy --dry-run` (`gzip < 500 KiB`), 0 `DROP TABLE|DROP COLUMN`, 0 OS paths, all `.ts`/`.tsx` `<= 300` lines.
- [x] **Step 2:** Marcar `- [x]`, agregar `ADR-010` en `docs/superpowers/DECISIONS.md` y crear commit atómico en `main`.
- [x] **Step 3:** Desplegar a Cloudflare `PC911 IT Services Global` (`https://shac-node-worker.pc911itservices.workers.dev`) y probar en vivo `/api/system/profile`, `/api/system/app-store/toggle` (`0 ms` sobre `CONFIG_KV` conservando datos en D1/DO) y `/api/system/license/verify`.
