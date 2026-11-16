# Plan de Implementación — Fase 8: Control Físico IoT, Cerraduras, Casilleros y Garitas LPR

> **Objetivo:** Implementar el Dominio 12 (`@shac/mod-physical`) en `@shac/db-d1`, `@shac/node-worker` y `@shac/web-spa`, manteniendo el binario All-in-One `< 1024 KiB` gzip y todos los archivos `.ts`/`.tsx` `<= 300` líneas.

## Task 1: Esquema D1 Dominio 12 (`@shac/db-d1`)
- [x] **Step 1:** Crear `packages/db-d1/src/schema/physical.ts` (`phy_devices_and_locks`, `phy_access_passes`, `phy_smart_lockers`, `phy_locker_reservations`, `phy_lpr_gates`, `phy_lpr_plate_events`, `phy_media_clips`, `phy_tamper_alerts`), actualizar `src/scope.ts` y `src/index.ts`.
- [x] **Step 2:** Crear migración aditiva `packages/db-d1/migrations/0006_phase8_physical_iot.sql` (0 `DROP TABLE|DROP COLUMN`).
- [x] **Step 3:** Crear `packages/db-d1/test/phase8-schema.test.ts` en `workerd` y verificar `typecheck` + `test:run`.

## Task 2: Módulo `@shac/mod-physical` (`packages/modules/physical`)
- [x] **Step 1:** Implementar `modPhysicalManifest` (`id: 'physical'`):
  - `physical.passes.issue`: emisión de PINs temporales / QR al Check-In con hash `SHA-256`.
  - `physical.passes.validate`: validación de pase en **tiempo constante** y apertura de cerradura/casillero QR.
  - `physical.lpr.scan`: lectura LPR (`< 15 ms`) con lista blanca de placas y evento de portero WhatsApp/Telegram.
  - `physical.clips.record`: registro de clips de video con hash `SHA-256` en R2.
  - `physical.tamper.report`: alerta anti-sabotaje (`phy_tamper_alerts`).
- [x] **Step 2:** Verificar en `packages/modules/physical/test/physical.commands.test.ts` sobre `workerd`.

## Task 3: Integración en `@shac/node-worker`, `@shac/web-spa` y Despliegue
- [x] **Step 1:** Conectar `@shac/mod-physical` en `apps/node-worker` (REST + `/mcp`), añadir vista `/physical` en `apps/web-spa`, actualizar `knip.json` y añadir `apps/node-worker/src/__tests__/phase8.worker.test.ts`.
- [x] **Step 2:** Correr RDD completo (`typecheck`, `knip --strict`, `test:run`, `web-spa build`, `wrangler deploy --dry-run` `< 1024 KiB` gzip), marcar `- [x]`, actualizar `DECISIONS.md` (`ADR-014`), commit en `main`, aplicar `0006` en `shac-primary` D1 remoto, actualizar `CONFIG_KV` (`physical`) y desplegar a `PC911 IT Services Global`.
