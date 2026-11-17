# Omni-Vertical Usability & UI/UX Remediation (4 Waves) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar `SuperHyperArchiCRM` de una fachada de demostración (`14/40` Nielsen, `6/20` Audit Técnico) en un sistema operable en frío desde el Día 1 y sólido en demos comerciales a través de las 9 verticales canónicas y 38 rutas, haciendo cumplir `DESIGN.md` v2.2.0.

**Architecture:** Se ejecuta de adentro hacia afuera en 4 Olas sobre los motores reales ya existentes en `@shac/mod-*`, `@shac/actor-branch` y D1: **Ola 1** repara el arranque en frío (`/setup`), el aislamiento real de presets (`presetMode: 'replace'`), el sistema visual `DESIGN.md` v2.2.0, el shell responsivo/táctil (`360px` drawer, `1024x768` sin colisión, `<ExternalPortalShell>`) y las 5 Estaciones de Trabajo (`8–12` ítems por vertical con vocabulario reactivo y `React.lazy`); **Olas 2, 3 y 4** eliminan todos los IDs quemados, trampas de centavos crudos y formularios mudos en Comercio/POS/WMS/RMA, Clínica/Legal/Finanzas GAAP y Hotelería/Condominio/Garita Helios/Plataforma.

**Tech Stack:** TypeScript 5.8+, Cloudflare Workers (Hono + RPC `hc<AppRouter>` + D1 SQLite + `BranchInventoryDO` + `CONFIG_KV`/`SESSION_KV`), React 19, Vite 6, TanStack Router & Query (`offlineFirst`), Tailwind CSS v4 (`@theme inline`), Vitest 4.1 (`@cloudflare/vitest-plugin` + `@testing-library/react`).

**Spec:** `docs/superpowers/specs/2026-11-16-omni-vertical-usability-remediation-design.md` (junto con `DESIGN.md` v2.2.0 y `AGENTS.md` v2.2.0).

## Global Constraints

- Tamaño máximo por archivo fuente `.ts` o `.tsx`: `300` líneas duras; al acercarse a `260` líneas, extraer submódulos cohesivos (`AGENTS.md` §3).
- Alcance máximo por tarea: `3` archivos de implementación + sus archivos `.test.ts`/`.test.tsx`, entre `50` y `200` líneas netas por paso (`AGENTS.md` §3).
- Cero números decimales en punto flotante en contratos/almacenamiento: usar enteros `minor`, `bps` y `micros` con `BigInt`, pero convertir siempre en la frontera de UI a unidades decimales humanas con `<label>` visible (`parseMajorToMinor` / `formatMinorUnits`).
- Verdad visual única `DESIGN.md` v2.2.0: fuentes `Plus Jakarta Sans` y `JetBrains Mono` (`tabular-nums`), `:root` (`--background: #f6f7f9`, `--card: #ffffff`, `--primary: #2563eb`, `--checkout: #059669`, `--muted-foreground: #475569`, `--radius: 0.5rem`), `.dark` (`--background: #0c0e12`, `--card: #141820`, `--primary: #60a5fa`, `--checkout: #34d399`), contraste WCAG AA `>= 4.5:1`, cero gradientes neón.
- Aislamiento multi-tenant y jerárquico obligatorio (`eq(table.tenantId, ctx.tenantId)` + validación de subárbol `orgPath`) e idempotencia `clientMutationId` en mutaciones físicas/financieras (`AGENTS.md` §5).
- Migraciones D1 estrictamente aditivas (*Expand-Only*, prohibido `DROP TABLE` / `DROP COLUMN`) y cero rutas absolutas dependientes del sistema operativo (unidades locales o directorios de usuario) en código o docs (`AGENTS.md` §1.4, §5.4).
- Presupuesto de empaquetado: Worker All-in-One `< 1024 KiB` gzip en `wrangler deploy --dry-run`; chunk inicial JS de `@shac/web-spa` `< 250 kB` mediante `React.lazy` por ruta; `pnpm -r typecheck` y `pnpm dlx knip --strict` en `0` errores.

## Review Focus

1. **Aprovisionamiento previo del Control Plane vs. base D1 vacía (`Task 2`):** Si `iam_users` tiene `0` filas pero `CONFIG_KV` ya contiene `profile:current` con `tenantId: 'ten_cp_99'` y `entitlements.maxBranches: 2`, `POST /api/auth/setup` debe preservar `ten_cp_99` y `maxBranches: 2` sin permitir auto-escalamiento a `50` sucursales; y una vez `iam_users > 0`, si falta `profile:current`, `GET /api/auth/bootstrap` debe responder `503 PROFILE_UNAVAILABLE` (nunca `needsSetup: true`).
2. **Escalamiento horizontal/vertical de sucursal en `switch-branch` (`Task 2`):** Un operador sin comodín `'*'` cuyo `defaultOrgId` es `'org_2'` (`/org_1/sucursal-norte`) que invoque `POST /api/auth/switch-branch` o `POST /api/auth/login` hacia la matriz `'org_1'` (`/org_1`) debe recibir `403 FORBIDDEN_ORG_SCOPE`.
3. **Retrocompatibilidad de formularios públicos `string[]` vs `FormFieldSpec[]` (`Task 9`):** Tanto esquemas antiguos `{"fields":["nombre","correo"]}` como nuevos `{"fields":[{"name":"nombre","label":"Nombre","type":"text","required":true}]}` deben renderizar claves e inputs independientes en `PublicFormView` sin colisionar en `answers["undefined"]`.
4. **Descuento porcentual de línea POS + cobro mixto `USD`/`VES` (`Task 10`):** Un ítem de `1000` minor (`$10.00`) con `discountBps: 1000` (`-10%` -> neto `900` minor) pagado con `500` minor `USD` + `21900` minor `VES` a tasa `54_750_000` micros debe enviar `manualDiscountBps: 1000` y `exchangeRateMicros: 54_750_000` completando `200 OK` sin error `422 INSUFFICIENT_PAYMENT`.
5. **Re-ejecución idempotente de columnas virtuales `v_cf_*` en SQLite (`Task 24`):** Registrar dos veces `fieldKey: 'registro_sanitario'` con `isIndexed: true` en `POST /api/system/custom-fields` debe detectar columna existente y retornar `200`/`201` en vez de estallar con `500 duplicate column name`.

---

## File Structure Map

### Paquetes Compartidos (`editions/presets` & `packages/ui`)
- `editions/presets/src/presets-catalog.ts` — Tildes españolas canónicas y módulos corregidos por preset (`finance` en `hospitality-pms`, `services` en `retail-pos` y `distro-wms`).
- `editions/presets/src/app-store-merger.ts` — Soporte `presetMode: 'merge' | 'replace'` en `applyAppStoreToggle`.
- `packages/ui/src/styles/globals.css` — Tokens exactos `DESIGN.md` v2.2.0, variantes `touch:`, contraste AA y `@media print`.
- `packages/ui/src/components/PosVirtualKeypad.tsx` — Botones táctiles `56px` (`min-h-14`), tecla `C` (`Limpiar`) y `replaceOnFirstInput`.
- `packages/ui/src/components/TimeSeriesChart.tsx` — Separación de unidades sin sumar conteos con montos monetarios.
- `packages/ui/src/components/ExternalPortalShell.tsx` *(nuevo)* — Shell limpio sin navegación ERP para `/auth` anónimo, `/kiosk/price-check`, `/f/$slug` y `/quote/$orderNumber`.
- `packages/ui/src/components/ShacAppShell.tsx` & `ShacSidebar.tsx` — Drawer móvil `<1024px`, riel `64px` en escritorio, selector inline de sucursal, isotipo sólido `--primary` y filtrado por `allowedPresets`.

### Worker API (`apps/node-worker/src`)
- `auth-setup-routes.ts` *(nuevo)* & `auth-routes.ts` — Bootstrap con `needsSetup`, `POST /api/auth/setup` atómico y `POST /api/auth/switch-branch` con techo `orgPath`.
- `iam-admin-routes.ts` — Rotación de contraseña/PIN en `ON CONFLICT` y validación de roles acotados.
- `wms-vehicles-locations-routes.ts` *(nuevo)*, `catalog-ext-routes.ts` & `connectors-routes.ts` — Reparación SQL `wms_locations` + vehículos `wms_fleet_and_deliveries`, autorización B2B `orders`/`quotes` (`pos | wms | catalog`) y `ai-chat` por `aiCopilotEnabled`.
- `phase7-registry.ts`, `clinical-ehr-routes.ts`, `legal-practice-routes.ts`, `finance-gaap-routes.ts`, `staff-routes.ts`, `packages/modules/finance/src/commands/journal-post.ts` — Transiciones RMA, AI Scribe en `'DRAFT'` con JSON parseado, conflictos legales sobre `display_name`/`legal_name`/`tax_id_number`, dockets, actualización atómica de saldos COA, AP con proveedor/vencimiento y filtro `orgPath`.
- `hospitality-condo-routes.ts`, `physical-helios-routes.ts`, `custom-fields-routes.ts` — Unidades PMS, cargos/liquidación de folios, housekeeping real, preservación de batería + `lockdown` en Helios y ejecución segura de DDL `v_cf_*`.

### Aplicación SPA (`apps/web-spa/src`)
- `index.html` & `vite.config.ts` — Fuentes `Plus Jakarta Sans` + `JetBrains Mono` y proxy local `/api`, `/mcp`, `/ws`.
- `lib/marketProfile.tsx` *(nuevo)*, `nav.ts` & `main.tsx` — `MarketProfileContext` / `useMarketVocabulary()`, 5 Estaciones de Trabajo (`8–12` ítems/preset), `React.lazy`, `data-density="touch"`, tema persistente y atajos `F2/F4/F6`.
- Nuevos subcomponentes modulares (`<= 220` LOC c/u): `views/SetupOnboardingCard.tsx`, `views/GlJournalBuilder.tsx`, `views/SpaceBookingAndFolioModal.tsx`, `views/SplitRentLeaseModal.tsx`, `views/HeliosPassAndLprModal.tsx`, `views/CustomFieldsSection.tsx`.
- Vistas de dominio actualizadas (`<= 300` LOC c/u): todas las vistas de `apps/web-spa/src/views/` conectadas a selectores reales, decimales humanos con `<label>` y manejo explícito de errores.

---

## OLA 1: Cimientos Globales, Onboarding Día 1, Shell `DESIGN.md` y Aislamiento de las 9 Verticales

### Task 1: `presetMode: 'merge' | 'replace'`, Tildes y Módulos Canónicos en `@shac/editions` + `AppStoreView`

**Files:**
- Modify: `editions/presets/src/presets-catalog.ts:46-256`
- Modify: `editions/presets/src/app-store-merger.ts:49-187`
- Modify: `apps/web-spa/src/views/AppStoreView.tsx:33-147`
- Test: `editions/presets/test/editions.test.ts`

**Interfaces:**
- Produces in `@shac/editions`:
  - `AppStoreToggleSchema` extended with `presetMode: z.enum(['merge', 'replace']).optional()` (defaults to `'merge'` when omitted).
  - When `presetMode === 'replace'` and `switchPreset` is set: `activeModules` becomes `normalizeActiveModules([...preset.activeModules, ...(toggle.enableModules ?? [])]).filter(...)`, `vocabulary` becomes `{ ...preset.vocabulary, ...toggle.vocabularyOverride }`, and `entitlements` becomes `{ ...preset.entitlements }`.

- [ ] **Step 1: Write the failing test in `editions/presets/test/editions.test.ts`**

Add tests asserting:
1. `applyAppStoreToggle(omniProfile, { switchPreset: 'clinic-practice', presetMode: 'replace' })` removes `'pos'`, `'wms'`, `'leases'`, `'physical'`, sets `vocabulary.partySingular === 'Paciente'` and `vocabulary.branchSingular === 'Sede Clínica'`, and sets `entitlements.maxBranches === 3`.
2. `getEditionPreset('hospitality-pms')` has `vocabulary.partySingular === 'Huésped'`, `vocabulary.spaceSingular === 'Habitación'`, and `activeModules` containing `'finance'`; `retail-pos` and `distro-wms` `activeModules` contain `'services'`.
3. Omitting `presetMode` still passes the existing additive merge test unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/editions test:run`
Expected: FAIL (`merged.activeModules` still contains `'pos'` and `'Huesped'` lacks accent).

- [ ] **Step 3: Implement `presetMode` in `app-store-merger.ts`, fix `presets-catalog.ts`, and wire `AppStoreView.tsx`**

1. Update Spanish diacritics (`Huésped`, `Huéspedes`, `Habitación`, `Sede Técnica`, `Garantía RMA`, `Sede Clínica`, `Historia Clínica`, `Operación`, `Andén`) and add `'finance'` to `hospitality-pms`, `'services'` to `retail-pos` and `distro-wms` in `editions/presets/src/presets-catalog.ts`.
2. Implement `presetMode: z.enum(['merge', 'replace']).optional()` in `editions/presets/src/app-store-merger.ts`.
3. In `apps/web-spa/src/views/AppStoreView.tsx`, add a checkbox `"Aislar vertical (apagar módulos de otras industrias)"` (default `true`) so clicking a preset sends `{ switchPreset: preset.id, presetMode: isolate ? 'replace' : 'merge' }`, and sync local vocabulary inputs when `activeProfile.vocabulary` changes.

- [ ] **Step 4: Run test and typecheck to verify they pass**

Run: `pnpm --filter @shac/editions test:run && pnpm -r typecheck`
Expected: PASS (exit code 0).

- [ ] **Step 5: Commit**

```bash
git add editions/presets/src/presets-catalog.ts editions/presets/src/app-store-merger.ts editions/presets/test/editions.test.ts apps/web-spa/src/views/AppStoreView.tsx
git commit -m "feat(editions,app-store): add replace presetMode, fix vocabulary accents and preset modules"
```

---

### Task 2: Onboarding Día 1 (`/api/auth/setup`), Cambio de Sucursal con Techo `orgPath` y Rotación IAM en Worker

**Files:**
- Create: `apps/node-worker/src/auth-setup-routes.ts`
- Modify: `apps/node-worker/src/auth-routes.ts:1-321`
- Modify: `apps/node-worker/src/iam-admin-routes.ts:12-95`
- Test: `apps/node-worker/test/auth.routes.worker.test.ts`

**Interfaces:**
- Produces on `/api/auth`:
  - `GET /api/auth/bootstrap` -> `{ needsSetup: boolean; hasProvisionedProfile: boolean; tenantId: string; editionPreset: EditionPresetId; activeModules: string[]; vocabulary: MarketVocabulary; branches: Array<{ id: string; name: string; orgPath: string }>; catalog?: EditionCatalogSummary }` (returns `200` with `needsSetup: true` when `iam_users` count is `0`; fails closed `503 PROFILE_UNAVAILABLE` if `iam_users > 0` and `CONFIG_KV` `profile:current` is missing).
  - `POST /api/auth/setup` -> body `{ companyName: string; branchName: string; editionPreset: EditionPresetId; regionPack: RegionPackId; adminName: string; email: string; password: string; floorPin?: string; initialUsdToLocalRate?: number }` -> returns `AuthSession` (`201`), or `409 ALREADY_INITIALIZED` when `iam_users > 0`. Preserves existing `tenantId`, `deploymentId`, `federation`, and `entitlements` if `profile:current` already exists in `CONFIG_KV`; seeds `iam_tenants`, `iam_organizations` (`org_1`), `iam_users` (`perms: ['*']`), default `fin_accounts` (`acc_usd_cash`, `acc_usd_digital`, plus local currency account e.g. `acc_ves_pm` when `operatingCurrencies` includes `VES`/`COP`/`MXN`/`EUR`), opening COA accounts (`1010-CASH-USD`, `4010-SALES`), and `cat_exchange_rates` when `initialUsdToLocalRate` is provided.
  - `POST /api/auth/switch-branch` (Bearer required) -> body `{ branchId: string }` -> validates `targetOrg.tree_path === rootOrg.tree_path || targetOrg.tree_path.startsWith(rootOrg.tree_path + '/')` (unless `perms.includes('*')` or `allowedOrgIds` includes `branchId`, else `403 FORBIDDEN_ORG_SCOPE`), issues updated `AuthSession` (`200`). Same `orgPath` ceiling enforced on `POST /api/auth/login` and `POST /api/auth/pin`.

- [ ] **Step 1: Write the failing tests in `apps/node-worker/test/auth.routes.worker.test.ts`**

Add tests pinning Review Focus #1 & #2:
1. With `0` users and empty `CONFIG_KV`, `GET /api/auth/bootstrap` returns `200` `{ needsSetup: true }`, and `POST /api/auth/setup` (`retail-pos`, `ve`, `floorPin: '1234'`, `initialUsdToLocalRate: 54.75`) returns `201` with `shac_sess_*` and seeds `acc_usd_cash` + `acc_ves_pm`; calling `/api/auth/setup` a second time returns `409 ALREADY_INITIALIZED`.
2. With `0` users and a pre-existing Control Plane `profile:current` (`tenantId: 'ten_cp_99'`, `entitlements.maxBranches: 2`), `POST /api/auth/setup` with `editionPreset: 'omni-enterprise'` preserves `tenantId === 'ten_cp_99'` and `maxBranches === 2`.
3. Once `iam_users > 0`, deleting `profile:current` makes `GET /api/auth/bootstrap` return `503` (`PROFILE_UNAVAILABLE`).
4. A cashier user with `defaultOrgId = 'org_branch_2'` (`/org_1/sucursal-2`) and `perms: ['pos.sales.write']` can log into `'org_branch_2'` (`200`) but receives `403 FORBIDDEN_ORG_SCOPE` when logging into or calling `/api/auth/switch-branch` with `'org_1'` (`/org_1`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/node-worker exec vitest run test/auth.routes.worker.test.ts`
Expected: FAIL (`404` on `/api/auth/setup` and `/api/auth/switch-branch`).

- [ ] **Step 3: Extract `auth-setup-routes.ts` and update `auth-routes.ts` & `iam-admin-routes.ts` (`<= 260` LOC per file)**

1. Create `apps/node-worker/src/auth-setup-routes.ts` exporting shared `issueSession`, `assertUserBranchScope`, `handleBootstrap`, `handleInitialSetup`, and `handleSwitchBranch`.
2. Slim `apps/node-worker/src/auth-routes.ts` (`<= 240` LOC) to mount `/bootstrap`, `/setup`, `/login`, `/pin`, `/switch-branch`, and `/logout`, enforcing `assertUserBranchScope` on `/login` and `/pin`.
3. Update `apps/node-worker/src/iam-admin-routes.ts` (`POST /iam/users`) to accept `defaultOrgId` and `allowedOrgIds`, default non-admin permissions to explicit role permissions instead of `['*']`, and update `password_hash_webcrypto = COALESCE(excluded.password_hash_webcrypto, iam_users.password_hash_webcrypto)` and `floor_pin_hash = COALESCE(excluded.floor_pin_hash, iam_users.floor_pin_hash)` in `ON CONFLICT`.

- [ ] **Step 4: Run Worker auth and integration tests to verify they pass**

Run: `pnpm --filter @shac/node-worker exec vitest run test/auth.routes.worker.test.ts test/worker.integration.test.ts`
Expected: PASS (all tests green, including existing `503` test in `worker.integration.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/node-worker/src/auth-setup-routes.ts apps/node-worker/src/auth-routes.ts apps/node-worker/src/iam-admin-routes.ts apps/node-worker/test/auth.routes.worker.test.ts
git commit -m "feat(auth,iam): add Day-1 /setup bootstrap, orgPath branch ceiling, and PIN credential rotation"
```

---

### Task 3: Reparación SQL `/api/wms/locations` + `/api/wms/vehicles` y Compuertas API Multi-Vertical (`orders`, `quotes`, `ai-chat`)

**Files:**
- Create: `apps/node-worker/src/wms-vehicles-locations-routes.ts`
- Modify: `apps/node-worker/src/catalog-ext-routes.ts:95-141`
- Modify: `apps/node-worker/src/connectors-routes.ts:60-85`
- Test: `apps/node-worker/test/omni-verticals.worker.test.ts`

**Interfaces:**
- Produces on `/api`:
  - `GET /api/wms/locations` -> `{ items: Array<{ id: string; warehouseId: string; code: string; name: string; locationKind: string; isActive: boolean; createdAt: number }> }` backed by real `wms_warehouses_and_zones` + `wms_locations` (`complete_name`, `barcode`, `location_kind`), auto-ensuring default warehouse `WH-MAIN` per `orgId` on first write.
  - `POST /api/wms/locations` -> body `{ locationCode: string; name: string; locationKind: 'internal' | 'vendor' | 'customer' | 'quarantine' }` -> `201`.
  - `GET /api/wms/vehicles` & `POST /api/wms/vehicles` -> body `{ vehicleCode: string; plateNumber: string; driverName?: string; isColdChain?: boolean }` -> upserts `record_kind = 'vehicle'` in `wms_fleet_and_deliveries` so `fleet-complete-epod` resolves real `vehicleId`s.
  - `GET /api/pos/orders`, `GET/POST /api/pos/quotes` -> authorized when actor tenant profile enables **any** of `'pos' | 'wms' | 'catalog'` (unblocking `distro-wms`).
  - `POST /api/automation/ai-chat` -> authorized under `'core'` when `profile.entitlements.aiCopilotEnabled === true` (unblocking AI Copilot across all 9 presets).

- [ ] **Step 1: Write the failing tests in `apps/node-worker/test/omni-verticals.worker.test.ts`**

Add tests verifying:
1. Under `distro-wms` preset (`pos` and `automation` disabled), `GET /api/wms/locations`, `POST /api/wms/locations`, `POST /api/wms/vehicles`, `GET /api/pos/orders`, `POST /api/pos/quotes`, and `POST /api/automation/ai-chat` all return `200`/`201` (instead of `500` or `403`).
2. When `entitlements.aiCopilotEnabled` is `false`, `POST /api/automation/ai-chat` returns `403`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/node-worker exec vitest run test/omni-verticals.worker.test.ts`
Expected: FAIL (`500` on `/api/wms/locations` and `403` on `/api/pos/orders` & `/api/automation/ai-chat`).

- [ ] **Step 3: Implement `wms-vehicles-locations-routes.ts` and update `catalog-ext-routes.ts` & `connectors-routes.ts`**

1. Create `apps/node-worker/src/wms-vehicles-locations-routes.ts` querying `wms_locations` (`id, warehouse_id, barcode AS code, complete_name AS name, location_kind, is_active, created_at`) scoped by `tenant_id` and `org_id`, auto-creating `wms_warehouses_and_zones` (`WH-MAIN`) on `POST /wms/locations` if none exists, plus `GET/POST /wms/vehicles` on `wms_fleet_and_deliveries` (`record_kind = 'vehicle'`).
2. Delegate `/wms/*` in `apps/node-worker/src/catalog-ext-routes.ts` and change `/pos/orders` + `/pos/quotes` module check to accept `'pos'`, `'wms'`, or `'catalog'`.
3. In `apps/node-worker/src/connectors-routes.ts`, authenticate `/automation/ai-chat` with `'core'` and verify `profile.entitlements.aiCopilotEnabled` (including hotel/condo space counts in its summary query).

- [ ] **Step 4: Run test and typecheck to verify they pass**

Run: `pnpm --filter @shac/node-worker exec vitest run test/omni-verticals.worker.test.ts && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/node-worker/src/wms-vehicles-locations-routes.ts apps/node-worker/src/catalog-ext-routes.ts apps/node-worker/src/connectors-routes.ts apps/node-worker/test/omni-verticals.worker.test.ts
git commit -m "fix(worker): wire wms_locations/vehicles SQL and unlock B2B orders, quotes and AI copilot per preset"
```

---

### Task 4: Tokens `DESIGN.md` v2.2.0, Reglas `@media print`, `PosVirtualKeypad` (`56px` + `C`) y `TimeSeriesChart` en `@shac/ui`

**Files:**
- Modify: `packages/ui/src/styles/globals.css:1-279`
- Modify: `packages/ui/src/components/PosVirtualKeypad.tsx:1-58`
- Modify: `packages/ui/src/components/TimeSeriesChart.tsx:1-96`
- Test: `packages/ui/test/ui.smoke.test.tsx`

**Interfaces:**
- Produces in `@shac/ui`:
  - `PosVirtualKeypadProps` extended with `replaceOnFirstInput?: boolean` (default `false`); renders `min-h-14` (`56px`) keys and a `C` (`aria-label="Limpiar"`) button calling `onChange('0.00')` or `''`.
  - `TimeSeriesChartProps` extended with `showTotalBadge?: boolean` (default `true`; when `false`, hides summed header pill so heterogeneous KPI counts are never added to dollars).

- [ ] **Step 1: Write the failing tests in `packages/ui/test/ui.smoke.test.tsx`**

Add assertions verifying:
1. `PosVirtualKeypad` keys carry `min-h-14` (`56px`), clicking `Limpiar` resets value to `''`, and with `replaceOnFirstInput={true}` on initial `value="10.00"`, clicking `'2'` emits `'2'` instead of `'10.002'` (while default `replaceOnFirstInput={false}` still appends `'12'` -> `'125'`).
2. `TimeSeriesChart` with `showTotalBadge={false}` omits `[data-slot="chart-total-badge"]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/ui test:run`
Expected: FAIL (`Limpiar` button not found and `min-h-11` instead of `min-h-14`).

- [ ] **Step 3: Update `globals.css`, `PosVirtualKeypad.tsx` and `TimeSeriesChart.tsx`**

1. Rewrite `packages/ui/src/styles/globals.css` with exact `DESIGN.md` v2.2.0 tokens (`--font-sans: "Plus Jakarta Sans", "Inter", system-ui, sans-serif`, `--font-mono: "JetBrains Mono", ui-monospace, monospace`, `--radius: 0.5rem`, `:root` `#f6f7f9` / `#ffffff` / `#2563eb` / `#059669` / `#475569`, `.dark` `#0c0e12` / `#141820` / `#60a5fa` / `#34d399` / `#94a3b8`, selection `bg-primary/15 text-foreground`, placeholder contrast `>= 4.6:1`, `@utility no-scrollbar`, and `@media print` hiding `[data-slot="app-shell-sidebar"]`, `[data-slot="app-shell-header"]`, and `.no-print`).
2. Update `PosVirtualKeypad.tsx` with `min-h-14`, `Limpiar` (`C`) key, and internal `pristine` ref tracking `replaceOnFirstInput`.
3. Update `TimeSeriesChart.tsx` to honor `showTotalBadge?: boolean`.

- [ ] **Step 4: Run `@shac/ui` tests and typecheck**

Run: `pnpm --filter @shac/ui test:run && pnpm --filter @shac/ui typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/styles/globals.css packages/ui/src/components/PosVirtualKeypad.tsx packages/ui/src/components/TimeSeriesChart.tsx packages/ui/test/ui.smoke.test.tsx
git commit -m "feat(ui): enforce DESIGN.md v2.2 tokens, 56px PosVirtualKeypad clear/overwrite, and print CSS"
```

---

### Task 5: `<ExternalPortalShell>`, `SegmentedTabs` Táctil sin Scrollbar Nativo y Exportaciones `@shac/ui`

**Files:**
- Create: `packages/ui/src/components/ExternalPortalShell.tsx`
- Modify: `packages/ui/src/components/SegmentedTabs.tsx:1-60`
- Modify: `packages/ui/src/index.ts:1-81`
- Test: `packages/ui/test/ui.smoke.test.tsx`

**Interfaces:**
- Produces in `@shac/ui`:
  - `ExternalPortalShell({ title, subtitle, theme, onToggleTheme, headerRight, maxWidthClass, density, children }: ExternalPortalShellProps)` rendering `data-slot="external-portal-shell"` with zero ERP sidebar or internal nav.
  - `SegmentedTabs` with `no-scrollbar` overflow container and `touch:min-h-12` tab triggers.

- [ ] **Step 1: Write the failing test in `packages/ui/test/ui.smoke.test.tsx`**

Add tests verifying `ExternalPortalShell` is exported from `@shac/ui`, renders `data-slot="external-portal-shell"` with `0` `[data-slot="app-shell-sidebar"]` elements, honors `density="touch"` and `theme="dark"`, and `SegmentedTabs` tablist includes `no-scrollbar`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/ui test:run`
Expected: FAIL (`ExternalPortalShell` is not exported from `../src/index.js`).

- [ ] **Step 3: Implement `ExternalPortalShell.tsx`, update `SegmentedTabs.tsx`, and export in `packages/ui/src/index.ts`**

1. Create `packages/ui/src/components/ExternalPortalShell.tsx` (`<= 110` LOC) with clean header (`SuperHyperArchi` solid `bg-primary text-primary-foreground` emblem + optional theme toggle + `headerRight`) and `data-density` support.
2. Update `SegmentedTabs.tsx` to apply `no-scrollbar overflow-x-auto` and `touch:min-h-12` on tab buttons.
3. Export `ExternalPortalShell`, `type ExternalPortalShellProps`, and `type ShacAppShellProps` additions from `packages/ui/src/index.ts`.

- [ ] **Step 4: Run `@shac/ui` tests and typecheck**

Run: `pnpm --filter @shac/ui test:run && pnpm --filter @shac/ui typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/ExternalPortalShell.tsx packages/ui/src/components/SegmentedTabs.tsx packages/ui/src/index.ts packages/ui/test/ui.smoke.test.tsx
git commit -m "feat(ui): add ExternalPortalShell and remove native scrollbar on touch SegmentedTabs"
```

---

### Task 5B: Drawer Móvil `<1024px`, Riel `64px`, Topbar sin Colisión y Selector Inline de Sucursal en `ShacAppShell`

**Files:**
- Modify: `packages/ui/src/components/ShacAppShell.tsx:1-296`
- Modify: `packages/ui/src/components/ShacSidebar.tsx:1-175`
- Test: `packages/ui/test/ui.smoke.test.tsx`

**Interfaces:**
- Produces in `@shac/ui`:
  - `ShacNavItem` extended with `allowedPresets?: readonly string[]`.
  - `ShacAppShellProps` extended with `branches?: BranchOption[]`, `activeBranchId?: string`, `onSwitchBranch?: (branchId: string) => void`, `defaultCollapsedGroups?: Record<string, boolean>`.

- [ ] **Step 1: Write the failing tests in `packages/ui/test/ui.smoke.test.tsx`**

Add tests verifying:
1. `ShacAppShell` filters out `ShacNavItem` entries whose `allowedPresets` does not include `profile.editionPreset`.
2. On desktop toggle click (`Alternar barra lateral`), `ShacSidebar` switches `data-collapsed="true"` (`lg:w-16` icon rail) instead of unmounting completely; when `branches` and `onSwitchBranch` are provided, clicking the branch button opens an inline menu and calls `onSwitchBranch('br_2')` without navigating to `/auth`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/ui test:run`
Expected: FAIL (`allowedPresets` ignored and sidebar unmounts on toggle).

- [ ] **Step 3: Refactor `ShacAppShell.tsx` & `ShacSidebar.tsx` (`<= 260` LOC each)**

1. Update `ShacSidebar.tsx`: replace the lime/yellow/violet gradient badge with `bg-primary text-primary-foreground`, support `collapsed?: boolean` (`lg:w-16` icon-only rail with `title={item.label}`), and support mobile overlay mode (`fixed inset-y-0 left-0 z-50 w-72 shadow-lg lg:static`) calling `onCloseMobile?.()` whenever a nav item is clicked.
2. Update `ShacAppShell.tsx`: filter `navItems` by both `moduleId` AND `!item.allowedPresets || item.allowedPresets.includes(profile.editionPreset)`; separate `mobileMenuOpen` (default `false`, closes on `Escape` and backdrop click) from `desktopRailCollapsed` (default `false`); fix `1024px` header spacing with `whitespace-nowrap shrink-0` on `SyncStatusPill`, rename `AI ⌘K` to `Buscar ⌘K`, and add inline branch switcher popover when `branches` / `onSwitchBranch` are passed.

- [ ] **Step 4: Run `@shac/ui` tests and typecheck**

Run: `pnpm --filter @shac/ui test:run && pnpm --filter @shac/ui typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/ShacAppShell.tsx packages/ui/src/components/ShacSidebar.tsx packages/ui/test/ui.smoke.test.tsx
git commit -m "feat(ui): add mobile off-canvas drawer, 64px desktop icon rail, preset nav filter, and branch popover"
```

---

### Task 6: Asistente Día 1 (`SetupOnboardingCard`), PIN de Piso/Delegación y Roles Mínimo-Privilegio en `IamAdminView`

**Files:**
- Create: `apps/web-spa/src/views/SetupOnboardingCard.tsx`
- Modify: `apps/web-spa/src/views/AuthPage.tsx:1-93`
- Modify: `apps/web-spa/src/views/IamAdminView.tsx:1-189`
- Test: `apps/web-spa/test/spa.offline.test.ts`

**Interfaces:**
- Produces:
  - `SetupOnboardingCard({ rpc, hasProvisionedProfile, onInitialized }: SetupOnboardingCardProps)` calling `rpc.api.auth.setup.$post` -> `setAuthSession(session)` -> `onInitialized()`.
  - `STAFF_ROLE_PRESETS` in `IamAdminView.tsx`: maps human roles (`cashier`, `warehouse`, `clinician`, `legal`, `frontdesk`, `guard`, `finance`, `admin`) to explicit permission arrays (only `admin` grants `['*']`).

- [ ] **Step 1: Write the failing test in `apps/web-spa/test/spa.offline.test.ts`**

Add assertions verifying:
1. `rpc.api.auth.setup.$url().toString()` equals `'https://edge.shac.local/api/auth/setup'` and `rpc.api.auth['switch-branch'].$url().toString()` equals `'https://edge.shac.local/api/auth/switch-branch'`.
2. Exported `STAFF_ROLE_PRESETS` from `IamAdminView.tsx` grants scoped permissions (not `['*']`) for `'cashier'`, `'warehouse'`, `'clinician'`, and `'guard'`, and `['*']` only for `'admin'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa test:run`
Expected: FAIL (`STAFF_ROLE_PRESETS` not exported).

- [ ] **Step 3: Implement `SetupOnboardingCard.tsx`, update `AuthPage.tsx` & `IamAdminView.tsx`**

1. Create `apps/web-spa/src/views/SetupOnboardingCard.tsx` (`<= 210` LOC) with labeled inputs for Empresa, Sede Matriz, Preset de Industria (`9` opciones), Región/Moneda (`ve`, `co`, `mx`, `us`, `global`), Tasa inicial USD->Local (cuando aplique), Nombre Admin, Email, Contraseña y PIN de Piso de 4 dígitos.
2. Update `AuthPage.tsx` to render `<SetupOnboardingCard>` when `bootstrapQuery.data?.needsSetup === true`.
3. Update `apps/web-spa/src/views/IamAdminView.tsx` (`<= 270` LOC): add explicit `<label>`s, `defaultOrgId` branch `<select>`, `STAFF_ROLE_PRESETS` `<select>` (default `'cashier'`), optional 4-digit `floorPin` input, error banner on failed mutations, and an `"Emitir PIN Delegación (6 dígitos)"` action calling `rpc.api.iam.delegation.pins.$post` and displaying the issued 6-digit PIN in a copyable callout.

- [ ] **Step 4: Run `@shac/web-spa` tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/SetupOnboardingCard.tsx apps/web-spa/src/views/AuthPage.tsx apps/web-spa/src/views/IamAdminView.tsx apps/web-spa/test/spa.offline.test.ts
git commit -m "feat(web-spa): add Day-1 SetupOnboardingCard, IAM floor/delegation PINs, and scoped role presets"
```

---

### Task 7: `MarketProfileContext` (`useMarketVocabulary`), 5 Estaciones (`8–12` Ítems/Preset), `React.lazy` y Densidad/Tema Reactivos

**Files:**
- Create: `apps/web-spa/src/lib/marketProfile.tsx`
- Modify: `apps/web-spa/src/nav.ts:1-73`
- Modify: `apps/web-spa/src/main.tsx:1-238`
- Test: `apps/web-spa/test/market-nav.test.ts`

**Interfaces:**
- Produces:
  - `MarketProfileProvider`, `useMarketProfile(): ActiveMarketProfile`, `useMarketVocabulary(): MarketVocabulary`, `resolveRouteDensity(pathname: string): 'touch' | 'compact'` in `apps/web-spa/src/lib/marketProfile.tsx`.
  - `buildNavItems(profile: Pick<TenantMarketProfile, 'editionPreset' | 'activeModules' | 'vocabulary'>): ShacNavItem[]` and `getDefaultCollapsedGroups(presetId: EditionPresetId): Record<string, boolean>` in `apps/web-spa/src/nav.ts`.

- [ ] **Step 1: Write the failing test `apps/web-spa/test/market-nav.test.ts`**

Create `apps/web-spa/test/market-nav.test.ts` asserting across **all 9 presets** from `@shac/editions`:
1. For each of the 8 specialized presets (`retail-pos`, `distro-wms`, `tech-service`, `hospitality-pms`, `property-condo`, `clinic-practice`, `legal-psa`, `industrial-gate`), filtering `buildNavItems(preset)` by `activeModules` + `allowedPresets` yields between **`6` and `12` items**.
2. `clinic-practice` includes `/clinical-ehr` and labels `/parties` as `'Pacientes'`, and **excludes** `/legal-hub`, `/spaces` (Hospitality Rack), `/leases`, `/pos`, and `/eudr`.
3. `legal-psa` includes `/legal-hub` and labels `/parties` as `'Representados'`, and **excludes** `/clinical-ehr`, `/spaces` (Hospitality Rack), `/pos`, and `/eudr`.
4. `property-condo` includes `/leases` and labels `/parties` as `'Residentes-Inquilinos'`, and **excludes** `/spaces` (Hospitality Rack) and `/pos`.
5. `distro-wms` includes `/orders` (`'Órdenes de Despacho'`), `/quotes`, and `/claims` (`'RMA'`).
6. `resolveRouteDensity('/pos') === 'touch'`, `resolveRouteDensity('/physical') === 'touch'`, `resolveRouteDensity('/kiosk/price-check') === 'touch'`, and `resolveRouteDensity('/finance') === 'compact'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/market-nav.test.ts`
Expected: FAIL (cannot find `../src/lib/marketProfile`).

- [ ] **Step 3: Implement `marketProfile.tsx`, rewrite `nav.ts` (5 Workstations) and refactor `main.tsx` (`React.lazy` + `<ExternalPortalShell>`)**

1. Create `apps/web-spa/src/lib/marketProfile.tsx` (`<= 120` LOC) with `MarketProfileContext`, `useMarketProfile()`, `useMarketVocabulary()`, `resolveRouteDensity(pathname)`, and persisted theme state (`shac.ui.theme.v1`, defaulting to `'dark'` when entering `/physical` if unset) + `window` `'online'`/`'offline'` listener hook `useNetworkOnline()`.
2. Rewrite `apps/web-spa/src/nav.ts` (`<= 190` LOC) exporting `buildNavItems(profile)` organized into 5 collapsible Workstations (`OPERACIÓN PRINCIPAL`, `DIRECTORIO & COMERCIAL`, `CATÁLOGO & LOGÍSTICA`, `FINANZAS & EQUIPO`, `PLATAFORMA`) with dynamic `vocabulary` labels and strict `allowedPresets` per route (`8–12` items per vertical; `/cases` legacy route retired from sidebar and redirected in `main.tsx` to `/clinical-ehr` or `/legal-hub` per preset; secondary groups collapsed by default in `omni-enterprise`).
3. Refactor `apps/web-spa/src/main.tsx` (`<= 260` LOC):
   - Convert all heavy route views to `lazy(() => import(...))` wrapped in `<Suspense>` skeleton.
   - Pass live `activeProfile.vocabulary` from `MarketProfileContext` into every route (deleting static `const voc = DEFAULT_PROFILE.vocabulary`!).
   - Render `/f/$slug`, `/quote/$orderNumber`, `/kiosk/price-check`, and unauthenticated `/auth` inside `<ExternalPortalShell>` (disabling `/ws/branch` when unauthenticated or on `/f/*` / `/quote/*`).
   - Wire inline branch switching (`rpcClient.api.auth['switch-branch'].$post` -> `setAuthSession`), real `navigator.onLine` sync state, and global `F2` (`/pos`), `F4` (`/kiosk/price-check`), `F6` (`/wms`) listeners when active profile has those modules and user is not inside `/pos`.

- [ ] **Step 4: Run tests, typecheck, and `vite build` to verify code-splitting**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck && pnpm --filter @shac/web-spa build`
Expected: PASS, and `vite build` produces separate lazy chunks with zero `> 500 kB` chunk warning!

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/lib/marketProfile.tsx apps/web-spa/src/nav.ts apps/web-spa/src/main.tsx apps/web-spa/test/market-nav.test.ts
git commit -m "feat(web-spa): add reactive MarketProfileContext, 5 role workstations, lazy routes, and touch density"
```

---

### Task 8: Fuentes `DESIGN.md`, Proxy Vite Local y `DashboardView` Camaleón por Vertical

**Files:**
- Modify: `apps/web-spa/index.html:1-18`
- Modify: `apps/web-spa/vite.config.ts:1-19`
- Modify: `apps/web-spa/src/views/DashboardView.tsx:1-267`
- Test: `apps/web-spa/test/market-nav.test.ts`

**Interfaces:**
- Produces:
  - `getPresetPrimaryAction(profile: Pick<TenantMarketProfile, 'editionPreset' | 'activeModules' | 'vocabulary'>): { label: string; href: string }` exported from `apps/web-spa/src/views/DashboardView.tsx`.

- [ ] **Step 1: Write the failing test in `apps/web-spa/test/market-nav.test.ts`**

Add tests asserting `getPresetPrimaryAction(profile)` returns:
- `{ label: 'Abrir POS (F2)', href: '/pos' }` for `retail-pos`
- `{ label: 'Órdenes de Despacho', href: '/orders' }` for `distro-wms`
- `{ label: 'Nueva Consulta EHR', href: '/clinical-ehr' }` for `clinic-practice`
- `{ label: 'Suite Legal & Expedientes', href: '/legal-hub' }` for `legal-psa`
- `{ label: 'Rack PMS & Reservas', href: '/spaces' }` for `hospitality-pms`
- `{ label: 'Condominio & Leases', href: '/leases' }` for `property-condo`
- `{ label: 'Consola Garita Helios', href: '/physical' }` for `industrial-gate`
(never pointing to a disabled module!).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/market-nav.test.ts`
Expected: FAIL (`getPresetPrimaryAction` is not exported).

- [ ] **Step 3: Update `index.html`, `vite.config.ts`, and `DashboardView.tsx`**

1. Replace `Geist` / `Geist Mono` Google Fonts link in `apps/web-spa/index.html` with `Plus+Jakarta+Sans:wght@400;500;600;700` and `JetBrains+Mono:wght@400;500;600;700`.
2. Add `server.proxy` in `apps/web-spa/vite.config.ts` forwarding `/api`, `/mcp`, and `/ws` (`ws: true`) to `http://127.0.0.1:8787`.
3. Update `apps/web-spa/src/views/DashboardView.tsx` (`<= 260` LOC): consume `useMarketProfile()`, wire `getPresetPrimaryAction` so non-POS presets never see `"Abrir POS (F2)"`, replace hardcoded `"Clientes"`/`"Ir a Clientes"` with `vocabulary.partyPlural`, remove the fake `trend={{ value: 100, direction: 'up' }}` badge on empty pipeline, and pass Counts-only series (`showTotalBadge={false}`) to `TimeSeriesChart` while displaying monetary pipeline solely in its formatted `KpiCard`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/index.html apps/web-spa/vite.config.ts apps/web-spa/src/views/DashboardView.tsx apps/web-spa/test/market-nav.test.ts
git commit -m "feat(web-spa): load Plus Jakarta/JetBrains fonts, add Vite API proxy, and make DashboardView preset-aware"
```

---

### Task 9: Formularios Públicos (`FormFieldSpec[]`), Cotización Pública Segura y Decisión Bloqueada

**Files:**
- Modify: `apps/node-worker/src/public-portal-routes.ts:20-160`
- Modify: `apps/web-spa/src/views/FormsBuilderView.tsx:1-125`
- Modify: `apps/web-spa/src/views/PublicFormAndQuoteView.tsx:1-226`
- Test: `apps/web-spa/test/public-portal-forms.test.ts`

**Interfaces:**
- Produces:
  - `normalizeFormFields(rawSchemaJson: string): Array<{ name: string; label: string; type: 'text' | 'email' | 'tel' | 'textarea'; required: boolean }>` exported from `apps/web-spa/src/views/PublicFormAndQuoteView.tsx`.
  - In `apps/node-worker/src/public-portal-routes.ts`: when `?tenantId=` query param is omitted, resolves active `tenantId` from `CONFIG_KV` `profile:current` instead of hardcoding `'ten_1'`, and rejects `POST /public/quotes/:orderNumber/decision` with `409 QUOTE_ALREADY_DECIDED` if `status` is already `'fulfilled'` or `'cancelled'`.

- [ ] **Step 1: Write the failing test `apps/web-spa/test/public-portal-forms.test.ts`**

Pin Review Focus #3:
1. `normalizeFormFields('{"fields":["Nombre Completo","Correo Electrónico","Teléfono","Mensaje"]}')` returns 4 distinct `FormFieldSpec` objects with unique `name` keys (`nombre_completo`, `correo_electronico`, `telefono`, `mensaje`) and inferred types (`email`, `tel`, `textarea`), never `undefined`.
2. `normalizeFormFields('{"fields":[{"name":"rif","label":"RIF","type":"text","required":true}]}')` preserves structured specs identically.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/public-portal-forms.test.ts`
Expected: FAIL (`normalizeFormFields` not found).

- [ ] **Step 3: Implement `public-portal-routes.ts`, `FormsBuilderView.tsx` and `PublicFormAndQuoteView.tsx`**

1. Update `apps/node-worker/src/public-portal-routes.ts`: resolve fallback `tenantId` from `CONFIG_KV` `profile:current` when query param `tenantId` is absent, and block overwriting decided quotes (`409 QUOTE_ALREADY_DECIDED`).
2. Update `apps/web-spa/src/views/FormsBuilderView.tsx`: serialize structured `FormFieldSpec[]`, separate the Definitions table from the Submissions table (fixing cognitive-load mixed rows), add explicit `<label>`s, `onError` alert, and a `"Copiar / Abrir enlace público (/f/slug)"` button.
3. Update `apps/web-spa/src/views/PublicFormAndQuoteView.tsx`: export and use `normalizeFormFields`, omit hardcoded `'ten_1'` (pass `?tenantId=` only if present in `window.location.search`), format quote totals with `formatMinorUnits`, add optional `comment` field + confirmation step before rejecting a quote, and hide Approve/Reject buttons once decided.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/node-worker exec vitest run test/media-webhooks-ai.worker.test.ts && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/node-worker/src/public-portal-routes.ts apps/web-spa/src/views/FormsBuilderView.tsx apps/web-spa/src/views/PublicFormAndQuoteView.tsx apps/web-spa/test/public-portal-forms.test.ts
git commit -m "fix(portal,forms): normalize FormFieldSpec schema, resolve dynamic tenantId, and lock decided quotes"
```

---

## OLA 2: Comercio, POS Táctil `1024x768`, WMS FEFO `360px` & Taller RMA (`retail-pos`, `distro-wms`, `tech-service`)

### Task 10: Integridad de Checkout POS Día 1, Persistencia de Turno/Carrito, Reporte Z y PIN Real

**Files:**
- Modify: `apps/web-spa/src/lib/usePosShiftAndCheckout.ts:1-155`
- Modify: `apps/web-spa/src/views/PosCashClosingModal.tsx:1-95`
- Modify: `apps/web-spa/src/views/PosProModals.tsx:1-125`
- Test: `apps/web-spa/test/pos.turbo.test.ts`

**Interfaces:**
- Produces in `apps/web-spa/src/lib/usePosShiftAndCheckout.ts`:
  - `buildPosCheckoutPayload(input: { shiftId: string; orderCurrency: string; cart: PosCartLine[]; usdMinor: number; vesMinor: number; rateMicros: number; usdAccountId: string; vesAccountId: string; usdMethod: 'USD_CASH' | 'ZELLE' | 'POS_DEBIT'; couponCode?: string })` — pure helper including `manualDiscountBps: line.discountBps ?? 0` on every item and `exchangeRateMicros: rateMicros` on secondary currency payments.
  - Session persistence helpers `loadPersistedPosState(scopeKey)` / `savePersistedPosState(scopeKey, state)` storing `{ shiftId, registerId, cart }`.
  - `lastClosedReport: { expectedBalancesMinor: Record<string, number>; discrepancyBalancesMinor: Record<string, number>; plainTextReport: string } | null` returned from `usePosShiftAndCheckout` so `PosCashClosingModal` renders the Z-report discrepancy table and print button before closing.

- [ ] **Step 1: Write the failing test in `apps/web-spa/test/pos.turbo.test.ts`**

Pin Review Focus #4:
1. `buildPosCheckoutPayload` with a `1000` minor item at `discountBps: 1000` (`-10%`), `usdMinor: 500`, `vesMinor: 21900`, `rateMicros: 54_750_000`, `usdMethod: 'ZELLE'`, `usdAccountId: 'acc_1'`, `vesAccountId: 'acc_2'` emits `items[0].manualDiscountBps === 1000`, `payments[0].methodCode === 'ZELLE'`, `payments[0].financialAccountId === 'acc_1'`, and `payments[1].exchangeRateMicros === 54_750_000`.
2. `savePersistedPosState` / `loadPersistedPosState` round-trips `{ shiftId, registerId, cart }` cleanly per `tenantId:orgId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/pos.turbo.test.ts`
Expected: FAIL (`buildPosCheckoutPayload` is not exported).

- [ ] **Step 3: Update `usePosShiftAndCheckout.ts`, `PosCashClosingModal.tsx` and `PosProModals.tsx`**

1. In `usePosShiftAndCheckout.ts`: export `buildPosCheckoutPayload` and `loadPersistedPosState`/`savePersistedPosState`; accept `openingUsdMinor`/`openingVesMinor` on shift open; query real `fin_accounts` from `/api/finance/overview` (falling back to `'acc_usd_cash'` / `'acc_ves_pm'` created by `/setup`, and auto-creating register accounts via `/api/finance/coa` if missing); keep modals open until `onSuccess` and capture `closeShiftMutation` response into `lastClosedReport`.
2. In `PosCashClosingModal.tsx`: keep modal open during `pending`, render `lastClosedReport` (`Esperado` vs `Contado` vs `Sobrante/Faltante` + `<pre>` Z-report + `window.print()`), and handle `Escape` key.
3. In `PosProModals.tsx`: wire Cashier PIN modal to `rpc.api.auth.pin.$post({ json: { pin, branchId, mode: 'cashier' } })` -> `setAuthSession(session)` (rejecting invalid PINs with real `401` error banner, removing `.` decimal button on PIN keypad, and handling `Escape`).

- [ ] **Step 4: Run POS tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/lib/usePosShiftAndCheckout.ts apps/web-spa/src/views/PosCashClosingModal.tsx apps/web-spa/src/views/PosProModals.tsx apps/web-spa/test/pos.turbo.test.ts
git commit -m "fix(pos): wire discountBps/FX/accounts checkout payload, shift persistence, Z-report and real PIN auth"
```

---

### Task 11: Layout Táctil POS `1024x768` (`62%/38%` Cero Scroll Global), FTS5/Cupones y Kiosco `SmartCheck` Bloqueado

**Files:**
- Modify: `apps/web-spa/src/views/PosView.tsx:1-296`
- Modify: `apps/web-spa/src/views/PosReceiptPanel.tsx:1-229`
- Modify: `apps/web-spa/src/views/SmartCheckKioskView.tsx:1-171`
- Test: `apps/web-spa/test/pos.turbo.test.ts`

**Interfaces:**
- Consumes: `buildPosCheckoutPayload`, `loadPersistedPosState`, `savePersistedPosState` from `Task 10`; `useMarketProfile` from `Task 7`.
- Produces:
  - `PosView` bounded `lg:h-[calc(100vh-5.5rem)] lg:overflow-hidden` `lg:grid-cols-[62fr_38fr]` layout with server-side `debouncedSearch` query (`rpc.api.catalog.products.$get({ query: { search: debouncedSearch, limit: '100' } })`), D1 exchange-rate hydration, non-blocking Hold Order modal (zero `window.prompt`), cart-overwrite confirmation on Leylan recall, and unified shortcuts (`F2` Search, `F4` Qty, `F8` Hold/Customer, `F9` Line `-10%`, `F10` Tender).
  - `SmartCheckKioskView` with `useGlobalBarcodeHid`, `autoFocus`, zero `catalog.products` (`costPriceMinor`) query, and `"Salir Kiosco (PIN)"` modal verifying 4-digit staff PIN before navigating to `/pos`.

- [ ] **Step 1: Write the failing test in `apps/web-spa/test/pos.turbo.test.ts`**

Add unit tests verifying:
1. `findProductByScanCode` matches `sku`, `gtin`, or `barcode` case-insensitively.
2. Applying a coupon (`discountBps`) + line discount computes exact integer `cartTotalMinor` used on both `PosReceiptPanel` Grand Total and `ThermalReceiptModal` receipt lines.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/pos.turbo.test.ts`
Expected: FAIL on `gtin`/`barcode` scan matching or coupon calculation.

- [ ] **Step 3: Update `PosView.tsx`, `PosReceiptPanel.tsx` and `SmartCheckKioskView.tsx` (`<= 285` LOC each)**

1. Update `PosView.tsx` (and `findProductByScanCode` in `usePosScanner.ts` if needed — or match `sku`/`gtin` in `PosView` server search): hydrate shift/cart from `loadPersistedPosState`, pass `debouncedSearch` to `/api/catalog/products`, lock BCV rate input as read-only badge unless unlocked, add opening cash float inputs on closed-register card, replace `window.prompt` on `F8` with inline label input inside `PosHoldOrdersModal` + confirm before overwriting non-empty cart, and enforce `lg:grid-cols-[62fr_38fr]` zero-global-scroll layout.
2. Update `PosReceiptPanel.tsx`: enlarge line `%`/`-`/`+` buttons to `min-h-11 min-w-11` (`44–48px`), render Grand Total in `text-4xl font-bold font-mono tabular-nums`, add promo coupon input validated against `/api/catalog/promotions`, and fix `ThermalReceiptModal` line totals to apply `discountBps`.
3. Update `SmartCheckKioskView.tsx`: remove `productsQuery` (preventing `costPriceMinor` exposure), bind `useGlobalBarcodeHid` + `autoFocus` input (`min-h-14 text-lg`), adapt secondary currency from `activeProfile.currency.operatingCurrencies[1]`, and add `"Salir Kiosco (PIN)"` verification modal.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/PosView.tsx apps/web-spa/src/views/PosReceiptPanel.tsx apps/web-spa/src/views/SmartCheckKioskView.tsx apps/web-spa/test/pos.turbo.test.ts
git commit -m "feat(pos,kiosk): implement 62/38 zero-scroll tactile POS, coupon/FTS5 search, and locked SmartCheck kiosk"
```

---

### Task 12: Inputs Decimales Humanos con `<label>` y Categorías Reales en Catálogo y Promociones

**Files:**
- Modify: `apps/web-spa/src/views/CatalogView.tsx:1-276`
- Modify: `apps/web-spa/src/views/CatalogStructureView.tsx:1-155`
- Modify: `apps/web-spa/src/views/PromotionsView.tsx:1-85`
- Test: `apps/web-spa/test/commerce-decimal-ux.test.ts`

**Interfaces:**
- Produces in `apps/web-spa/src/views/phase2-format.ts` (or local pure helpers re-exported for testing):
  - All product prices/costs entered as decimal major units (`'12.50'` -> `parseMajorToMinor` = `1250`), FX rates entered as decimal (`'54.75'` -> `parseRateToMicros('54.75') === 54_750_000`), and promo discounts entered as human `%` (`'15'` -> `1500` bps) or decimal `$` (`'5.00'` -> `500` minor).

- [ ] **Step 1: Write the failing test `apps/web-spa/test/commerce-decimal-ux.test.ts`**

Create `apps/web-spa/test/commerce-decimal-ux.test.ts` testing `parseRateToMicros('54.75') === 54_750_000`, `parsePercentToBps('15.5') === 1550`, and rejecting negative/NaN values cleanly (`0`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/commerce-decimal-ux.test.ts`
Expected: FAIL (helpers not found).

- [ ] **Step 3: Update `CatalogView.tsx`, `CatalogStructureView.tsx` and `PromotionsView.tsx` (`<= 280` LOC each)**

1. In `CatalogView.tsx`: replace raw `basePriceMinor` (`1000`), `costPriceMinor` (`700`), and `rateMicros` (`54750000`) inputs with labeled decimal inputs (`Precio Base (USD)`, `Costo Unitario (USD)`, `Tasa de Cambio (Bs/USD)` using `parseMajorToMinor` / `parseRateToMicros`), add a `<select>` for `Categoría` populated from `/api/catalog/categories`, and adapt headers to `useMarketVocabulary()`.
2. In `CatalogStructureView.tsx`: add explicit `<label>`s, convert variant override price to decimal `$0.00`, add `barcode` input, and resolve parent product `name` + `sku` instead of raw `v.productId` UUID in the variants table.
3. In `PromotionsView.tsx`: add explicit `<label>`s, convert `discountValue` to human `%` (`0–100`) or decimal `$`, display formatted discount column in `DataTable`, and add `onError` destructive alert banner.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/CatalogView.tsx apps/web-spa/src/views/CatalogStructureView.tsx apps/web-spa/src/views/PromotionsView.tsx apps/web-spa/test/commerce-decimal-ux.test.ts
git commit -m "fix(catalog,promos): replace raw cents/micros/bps inputs with labeled decimal controls and product categories"
```

---

### Task 13: `PosTenderModal` Preciso y Flujo Completo Cotizaciones -> Órdenes de Venta (`distro-wms` + `retail-pos`)

**Files:**
- Modify: `apps/web-spa/src/views/PosTenderModal.tsx:1-165`
- Modify: `apps/web-spa/src/views/QuotesView.tsx:1-95`
- Modify: `apps/web-spa/src/views/SalesOrdersView.tsx:1-230`
- Test: `apps/web-spa/test/commerce-decimal-ux.test.ts`

**Interfaces:**
- Produces:
  - `PosTenderModal` passing `replaceOnFirstInput={true}` to `PosVirtualKeypad`, propagating `usdMethod` (`USD_CASH` | `ZELLE` | `POS_DEBIT`) to `PosView`, keeping modal open while `checkoutPending`, and removing the duplicate submit button.
  - `QuotesView` with product `<select>` + qty line builder computing `totalMinor`, inline empty-party CTA (`Ir a crear Cuenta/Cliente`), `"Copiar Link Público (/quote/QT-...)"`, and 1-click `"Convertir en Orden"` action.
  - `SalesOrdersView` with dynamic `vocabulary.orderSingular` title (`Órdenes de Despacho` in `distro-wms`), localized Spanish status badges, and `"Crear Orden Directa"` modal/form for `distro-wms` B2B operators.

- [ ] **Step 1: Write the failing test in `apps/web-spa/test/commerce-decimal-ux.test.ts`**

Add tests for `formatOrderStatusEs(status)` ensuring `'fulfilled'` -> `'Despachada'`, `'confirmed'` -> `'Confirmada'`, `'pending'` -> `'Pendiente'`, `'cancelled'` -> `'Cancelada'` (zero English badge leaks), and quote line total aggregation in integer minor units.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/commerce-decimal-ux.test.ts`
Expected: FAIL (`formatOrderStatusEs` not exported).

- [ ] **Step 3: Update `PosTenderModal.tsx`, `QuotesView.tsx` and `SalesOrdersView.tsx` (`<= 270` LOC each)**

1. Update `PosTenderModal.tsx`: pass `replaceOnFirstInput={true}` to `PosVirtualKeypad`, lift `usdMethod` via `onChangeUsdMethod`, merge the duplicate `Aplicar` / `Confirmar y Cobrar` buttons into one clear `56px` `--checkout` CTA disabled during `pending`, and close on `Escape`.
2. Update `QuotesView.tsx`: add product line builder (`productId`, `qty` -> auto-calculates USD total), `"Copiar enlace (/quote/...)"` button, `"Convertir a Orden"` mutation, and `onError` alert.
3. Update `SalesOrdersView.tsx`: export `formatOrderStatusEs`, replace hardcoded `'Órdenes de Venta'` with `vocabulary.orderSingular`, and add a collapsible `"Nueva Orden B2B"` form (`partyId`, `productId`, `qty`) so `distro-wms` can originate dispatch orders on Day 1 without POS.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/PosTenderModal.tsx apps/web-spa/src/views/QuotesView.tsx apps/web-spa/src/views/SalesOrdersView.tsx apps/web-spa/test/commerce-decimal-ux.test.ts
git commit -m "feat(sales,quotes): refine PosTenderModal keypad/methods and add B2B quote-to-order creation flow"
```

---

### Task 14: Colector WMS `360px` por Pestañas, Semáforo FEFO `LotBadge`, Selectores de Ubicación/Vehículo y Firma `e-POD`

**Files:**
- Modify: `apps/web-spa/src/views/WmsLocationsView.tsx:1-85`
- Modify: `apps/web-spa/src/views/WmsView.tsx:1-238`
- Modify: `apps/web-spa/src/views/LabelsAndFleetView.tsx:1-230`
- Test: `apps/web-spa/test/wms-rma-ux.test.ts`

**Interfaces:**
- Produces:
  - `classifyFefoLotStatus(expiryEpochMs: number | null, quarantineStatus: string | undefined, nowMs: number): { label: string; tone: 'success' | 'warning' | 'error'; selectable: boolean }` (`BLOQUEADO · Vencido / Cuarentena` red when expired or quarantined, `FEFO · Vence Xd` amber when `<= 30` days, `Vigente` green otherwise — per `DESIGN.md` §6).

- [ ] **Step 1: Write the failing test `apps/web-spa/test/wms-rma-ux.test.ts`**

Create `apps/web-spa/test/wms-rma-ux.test.ts` asserting `classifyFefoLotStatus`:
- Expired lot (`nowMs - 86_400_000`) -> `{ tone: 'error', selectable: false }`
- Quarantined lot (`'QUARANTINE'`) -> `{ tone: 'error', selectable: false }`
- Expiring in 18 days -> `{ label: 'FEFO · Vence 18d', tone: 'warning', selectable: true }`
- Expiring in 120 days -> `{ label: 'Vigente', tone: 'success', selectable: true }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/wms-rma-ux.test.ts`
Expected: FAIL (`classifyFefoLotStatus` not found).

- [ ] **Step 3: Update `WmsLocationsView.tsx`, `WmsView.tsx` and `LabelsAndFleetView.tsx` (`<= 285` LOC each)**

1. Update `WmsLocationsView.tsx`: add `<label>`s, `onError` alert, copyable `code` + `id` badges, and quick `"Crear Bin Recepción + Despacho"` Day-1 starter action.
2. Refactor `WmsView.tsx` into 3 single-focus `SegmentedTabs` ergonomic on `360px` collectors (`1. Recibir Lote FEFO` with `binCode` `<select>` from `/api/wms/locations`, decimal `Costo USD`, and `Fecha Vencimiento`; `2. Existencias & Semáforo FEFO` rendering `balances.lots` sorted FEFO with `classifyFefoLotStatus` `StatusBadge`; `3. Picking Doble Partida` using `<select>`s for `Origen` and `Destino` locations) + `useGlobalBarcodeHid` for SKU scan.
3. Update `LabelsAndFleetView.tsx`: add `"Registrar Vehículo"` form wired to `POST /api/wms/vehicles`, `<select>` pickers for `vehicleId` and `orderId` (eliminating hardcoded `'veh_cold'`), real pointer `<canvas>` -> SVG path capture for driver e-POD signature, and visible `onError` banners on CSV/AI/e-POD mutations.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/WmsLocationsView.tsx apps/web-spa/src/views/WmsView.tsx apps/web-spa/src/views/LabelsAndFleetView.tsx apps/web-spa/test/wms-rma-ux.test.ts
git commit -m "feat(wms,fleet): add 360px tabbed WMS collector UI, FEFO LotBadge table, vehicle/bin selectors and canvas e-POD"
```

---

### Task 15: Ciclo Completo de Garantías RMA, Órdenes Técnicas y Tickets de Mantenimiento (`ClaimsAndServicesView`)

**Files:**
- Modify: `apps/node-worker/src/phase7-registry.ts:1-125`
- Modify: `apps/web-spa/src/views/ClaimsAndServicesView.tsx:1-261`
- Test: `apps/web-spa/test/wms-rma-ux.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/services/claims/:id/transition` in `apps/node-worker/src/phase7-registry.ts` -> body `{ nextStatus: 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED'; resolutionNote?: string }` updating `srv_warranty_claims` or `srv_work_orders` scoped by `tenant_id` and `org_id`.
  - `mapClaimStatusToStep(status: string): number` (`REQUESTED`/`OPEN` -> `1`, `APPROVED`/`IN_PROGRESS` -> `2`, `RECEIVED` -> `3`, `COMPLETED`/`REPLACED`/`CREDITED` -> `4`) in `ClaimsAndServicesView.tsx`.

- [ ] **Step 1: Write the failing test in `apps/web-spa/test/wms-rma-ux.test.ts`**

Add tests asserting `mapClaimStatusToStep('REQUESTED') === 1`, `mapClaimStatusToStep('APPROVED') === 2`, `mapClaimStatusToStep('COMPLETED') === 4` (replacing the frozen step-2 constant).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/wms-rma-ux.test.ts`
Expected: FAIL (`mapClaimStatusToStep` not exported).

- [ ] **Step 3: Add `/api/services/claims/:id/transition` and update `ClaimsAndServicesView.tsx` (`<= 285` LOC)**

1. Add `POST /api/services/claims/:id/transition` in `apps/node-worker/src/phase7-registry.ts`.
2. Update `ClaimsAndServicesView.tsx`: adapt title and CTAs to `vocabulary.caseSingular` (`Garantías & RMA` vs `Ticket Mant.` vs `Solicitudes`), convert `woLaborMinor` from raw centavos (`'4500'`) to labeled decimal `$0.00` (`parseMajorToMinor`), add optional `Unidad / Espacio` selector when `spaces` is active, show an `"Ir a crear Cliente/Residente"` CTA when `parties` is empty, wire dynamic `mapClaimStatusToStep`, and add status transition buttons (`Aprobar`, `En Proceso`, `Cerrar Resuelto`, plus `"Cobrar en POS"` shortcut when `pos` is enabled).

- [ ] **Step 4: Run Worker & SPA tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/node-worker exec vitest run src/__tests__/phase7.worker.test.ts && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/node-worker/src/phase7-registry.ts apps/web-spa/src/views/ClaimsAndServicesView.tsx apps/web-spa/test/wms-rma-ux.test.ts
git commit -m "feat(services): wire live RMA and work-order status transitions, decimal labor, and unit/POS links"
```


---

## OLA 3: Práctica Profesional & Finanzas Fiduciarias (`clinic-practice`, `legal-psa`)

### Task 16: Seguridad Clínica EHR (`DRAFT` AI Scribe JSON Parser, `orgPath` e Idempotencia) y Estación Centrada en el Paciente

**Files:**
- Modify: `apps/node-worker/src/clinical-ehr-routes.ts:1-170`
- Modify: `apps/web-spa/src/views/ClinicalEhrView.tsx:1-218`
- Modify: `apps/web-spa/src/views/ClinicalAiScribeModal.tsx:1-105`
- Test: `apps/node-worker/test/omni-verticals.worker.test.ts`

**Interfaces:**
- Produces in `apps/node-worker/src/clinical-ehr-routes.ts`:
  - `parseAiSoapDraft(rawAiText: string, fallbackDictation: string): { subjective: string; objective: string; assessment: string; plan: string; icd10: string[] }` — safely extracts JSON object if present instead of dumping raw JSON string into `assessment`, and inserts `med_clinical_notes` with `status = 'DRAFT'`.
  - `POST /api/clinical/notes/:id/sign` — transitions `DRAFT` -> `SIGNED` (with optional `subjective`/`assessment`/`plan` clinician edits) scoped to `tenant_id` and `orgPath`.
  - All `GET/POST /api/clinical/*` queries filter `org_id` within `auth.actor.orgPath` subtree and accept `clientMutationId`.

- [ ] **Step 1: Write the failing test in `apps/node-worker/test/omni-verticals.worker.test.ts`**

Add tests verifying:
1. `POST /api/clinical/encounters` saves `med_clinical_notes` as `'DRAFT'` (not `'SIGNED'`), parses JSON `{ subjective, objective, assessment, plan, icd10 }` cleanly without raw `{` braces in `assessment`, and `POST /api/clinical/notes/:id/sign` locks it as `'SIGNED'`.
2. Encounters created in child branch `org_2` are not leaked when querying `/api/clinical/overview` from sibling branch `org_3`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/node-worker exec vitest run test/omni-verticals.worker.test.ts`
Expected: FAIL (`status === 'SIGNED'` immediately and `/notes/:id/sign` returns `404`).

- [ ] **Step 3: Update `clinical-ehr-routes.ts`, `ClinicalEhrView.tsx` and `ClinicalAiScribeModal.tsx` (`<= 285` LOC each)**

1. Update `apps/node-worker/src/clinical-ehr-routes.ts`: implement `parseAiSoapDraft`, save notes as `'DRAFT'`, add `POST /clinical/notes/:id/sign`, enforce `orgPath` subtree filtering on `GET /clinical/overview`, and verify `clientMutationId`.
2. Update `ClinicalEhrView.tsx`: add top `<ActivePatientBar>` `<select>` populated from `crm_parties` (`roles_mask` containing `'patient'`, plus quick inline `"Registrar Paciente"` trigger) eliminating hardcoded `'pty_pat_1'` across Vitals, SOAP, eRx, Labs, and RCM; format `vitals_json` as readable badges (`PA 120/80 · FC 76 · 36.7°C · SpO2 98%`); add `"Revisar y Firmar"` button on `'DRAFT'` SOAP notes; add inline creation form on `Lab & Imagen` tab (`kind: 'lab_order'`); add CIE-10 input + visible `scrubber_warnings_json` badges + labeled `$0.00` inputs on RCM tab; wire `onError` destructive alerts.
3. Update `ClinicalAiScribeModal.tsx`: bind to selected `patientPartyId` (`<select>` of real patients), add `Escape` + backdrop close, and surface `onError`.

- [ ] **Step 4: Run Worker & SPA tests and typecheck**

Run: `pnpm --filter @shac/node-worker exec vitest run test/omni-verticals.worker.test.ts && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/node-worker/src/clinical-ehr-routes.ts apps/web-spa/src/views/ClinicalEhrView.tsx apps/web-spa/src/views/ClinicalAiScribeModal.tsx apps/node-worker/test/omni-verticals.worker.test.ts
git commit -m "fix(clinical): remove pty_pat_1 hardcodes, add DRAFT SOAP review/sign, Lab form, and orgPath isolation"
```

---

### Task 17: Reparación Malpraxis Chequeo de Conflictos (`display_name`), `Dockets`, Cronómetro Persistente y Estación Legal

**Files:**
- Modify: `apps/node-worker/src/legal-practice-routes.ts:1-130`
- Modify: `apps/web-spa/src/views/LegalPracticeView.tsx:1-220`
- Modify: `apps/web-spa/src/views/LegalEdiscoveryAndEthicsPanel.tsx:1-175`
- Test: `apps/node-worker/test/omni-verticals.worker.test.ts`

**Interfaces:**
- Produces in `apps/node-worker/src/legal-practice-routes.ts`:
  - Conflict check in `POST /api/legal/ai-contract-review` queries `(LOWER(display_name) LIKE ?2 OR LOWER(COALESCE(legal_name, '')) LIKE ?2 OR LOWER(COALESCE(tax_id_number, '')) LIKE ?2)` on `crm_parties` AND `LOWER(title) LIKE ?2` on `leg_matters`, inserting an audit record into `crm_conflict_checks`.
  - `POST /api/legal/dockets` -> body `{ matterId: string; courtName: string; docketNumber: string; fatalDueAt?: number; summary: string }` -> inserts into `leg_dockets_and_deadlines` (`201`).
  - `orgPath` subtree filtering on `GET /api/legal/overview` and `GET /api/legal/ediscovery-overview`.

- [ ] **Step 1: Write the failing test in `apps/node-worker/test/omni-verticals.worker.test.ts`**

Add tests verifying:
1. Creating a party via `POST /api/customers/parties` with `displayName: 'Inversiones Orinoco'` (`legalName` omitted/`NULL`) and then running `POST /api/legal/ai-contract-review` with `counterpartyName: 'Orinoco'` returns `conflictsCount >= 1` (never false `0`) and logs a row in `crm_conflict_checks`.
2. `POST /api/legal/dockets` creates a docket linked to a real `matterId` and returns it in `GET /api/legal/overview`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/node-worker exec vitest run test/omni-verticals.worker.test.ts`
Expected: FAIL (`conflictsCount === 0` because `legal_name` is `NULL`, and `/api/legal/dockets` returns `404`).

- [ ] **Step 3: Update `legal-practice-routes.ts`, `LegalPracticeView.tsx` and `LegalEdiscoveryAndEthicsPanel.tsx` (`<= 285` LOC each)**

1. Update `apps/node-worker/src/legal-practice-routes.ts`: fix conflict SQL across `display_name`/`legal_name`/`tax_id_number`, persist `crm_conflict_checks`, add `POST /legal/dockets`, and filter `org_id` within `orgPath`.
2. Update `LegalPracticeView.tsx`: add `<select>` of real `Representado` (`crm_parties`) on Matter creation (eliminating `'pty_cli_1'`), auto-increment `referenceNumber` (`EXP-2026-001` -> `002`) after submit so 2nd matter never crashes on unique index, add top `<ActiveMatterBar>` scoping all tabs, persist running billable stopwatch in `localStorage` (`shac.legal.timer.<tenant>.<org>`) with `Reiniciar` button + editable hourly `$0.00/h` rate, add inline creation form on `Dockets` tab (`POST /api/legal/dockets`), and wire `onError` alerts + `Escape` on `LegalAiContractModal` (via prop/keydown).
3. Update `LegalEdiscoveryAndEthicsPanel.tsx`: bind `matterId` from active Matter prop (eliminating `'EXP-2026-01'`), display `sha256_hash` column in e-Discovery table, and compute CLE `statusTag` dynamically (`cleCompletedHours >= cleRequiredHours ? 'COMPLIANT' : 'DEFICIENT'`).

- [ ] **Step 4: Run Worker & SPA tests and typecheck**

Run: `pnpm --filter @shac/node-worker exec vitest run test/omni-verticals.worker.test.ts && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/node-worker/src/legal-practice-routes.ts apps/web-spa/src/views/LegalPracticeView.tsx apps/web-spa/src/views/LegalEdiscoveryAndEthicsPanel.tsx apps/node-worker/test/omni-verticals.worker.test.ts
git commit -m "fix(legal): detect display_name conflicts, wire real client/matter selectors, dockets form, and persistent timer"
```

---

### Task 18: Integridad Backend GAAP (Actualización Atómica de Saldos COA, Proveedor/Vencimiento en AP y Filtro `orgPath`)

**Files:**
- Modify: `packages/modules/finance/src/commands/journal-post.ts:120-198`
- Modify: `apps/node-worker/src/finance-gaap-routes.ts:12-120`
- Modify: `apps/node-worker/src/staff-routes.ts:30-165`
- Test: `apps/node-worker/src/__tests__/phase7.worker.test.ts`

**Interfaces:**
- Produces:
  - `financeJournalPostCommand` (`journal-post.ts`): atomically updates `current_balance_minor` on matching `fin_chart_of_accounts_and_periods` rows (`debitMinor - creditMinor` for `asset`/`expense`, `creditMinor - debitMinor` for `liability`/`equity`/`revenue`).
  - `POST /api/finance/coa` (`finance-gaap-routes.ts`): creates new accounts with `current_balance_minor = 0` (rejects direct arbitrary balance overwrites on existing accounts; opening balances go through journal entries), and `GET /api/finance/overview` returns `trialBalanceTotals: { totalDebitMinor: number; totalCreditMinor: number; balanced: boolean }`.
  - `ApBillSchema` (`finance-gaap-routes.ts`): extended with `vendorPartyId: z.string().min(1).optional()` and `dueAt: z.number().int().optional()`, persisted to `fin_ap_bills_and_expenses`.
  - `orgPath` subtree isolation enforced across `finance-gaap-routes.ts` and `staff-routes.ts`.

- [ ] **Step 1: Write the failing test in `apps/node-worker/src/__tests__/phase7.worker.test.ts`**

Add tests verifying:
1. Creating COA accounts `1010-CASH` (`asset`) and `4010-REV` (`revenue`) and posting a balanced `$250.00` (`25000` minor) journal entry updates `1010-CASH.current_balance_minor === 25000` and `4010-REV.current_balance_minor === 25000`, with `trialBalanceTotals.balanced === true`.
2. `POST /api/finance/ap-bills` persists `vendorPartyId` and `dueAt` and joins `vendorName` in `GET /api/finance/overview`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/node-worker exec vitest run src/__tests__/phase7.worker.test.ts`
Expected: FAIL (`current_balance_minor` remains `0` after posting journal entry).

- [ ] **Step 3: Implement COA balance updates, AP vendor/due fields, and `orgPath` filters**

1. Update `packages/modules/finance/src/commands/journal-post.ts` to include atomic `UPDATE fin_chart_of_accounts_and_periods SET current_balance_minor = current_balance_minor + ? ...` statements inside the batch.
2. Update `apps/node-worker/src/finance-gaap-routes.ts`: remove direct `current_balance_minor` overwrite from `POST /finance/coa`, add `trialBalanceTotals` + `fin_accounts` list to `GET /finance/overview`, add `vendor_party_id` + `due_date` + `crm_parties` LEFT JOIN to AP Bills, and enforce `orgPath`.
3. Update `apps/node-worker/src/staff-routes.ts`: enforce `orgPath` subtree filter on staff, leaves, timesheets, and projects.

- [ ] **Step 4: Run Phase 7 Worker tests and typecheck**

Run: `pnpm --filter @shac/node-worker exec vitest run src/__tests__/phase7.worker.test.ts && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/finance/src/commands/journal-post.ts apps/node-worker/src/finance-gaap-routes.ts apps/node-worker/src/staff-routes.ts apps/node-worker/src/__tests__/phase7.worker.test.ts
git commit -m "feat(finance,staff): update COA balances on GL post, add AP vendor/due date, and enforce orgPath isolation"
```

---

### Task 19: Constructor Multilínea de Asientos GL (`∑ Débito = ∑ Crédito`), Cuentas `Trust/Escrow` Visibles y Decimales Unificados en `FinanceView`

**Files:**
- Create: `apps/web-spa/src/views/GlJournalBuilder.tsx`
- Modify: `apps/web-spa/src/views/FinanceView.tsx:1-204`
- Modify: `apps/web-spa/src/views/FinanceApAndReconPanel.tsx:1-175`
- Test: `apps/web-spa/test/finance-gaap-ux.test.ts`

**Interfaces:**
- Produces:
  - `validateBalancedJournalLines(lines: Array<{ accountCode: string; debitInput: string; creditInput: string }>): { valid: boolean; totalDebitMinor: number; totalCreditMinor: number; diffMinor: number }` in `apps/web-spa/src/views/GlJournalBuilder.tsx`.

- [ ] **Step 1: Write the failing test `apps/web-spa/test/finance-gaap-ux.test.ts`**

Create `apps/web-spa/test/finance-gaap-ux.test.ts` asserting `validateBalancedJournalLines`:
- Rejects `< 2` lines or unbalanced lines (`debit: '100.00'`, `credit: '90.00'` -> `valid: false, diffMinor: 1000`).
- Accepts balanced 3-line split entry (`debit: '100.00'`, `credit: '60.00'` + `'40.00'` -> `valid: true, totalDebitMinor: 10000, totalCreditMinor: 10000`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/finance-gaap-ux.test.ts`
Expected: FAIL (`GlJournalBuilder` missing).

- [ ] **Step 3: Implement `GlJournalBuilder.tsx` and update `FinanceView.tsx` & `FinanceApAndReconPanel.tsx` (`<= 270` LOC each)**

1. Create `apps/web-spa/src/views/GlJournalBuilder.tsx` (`<= 180` LOC) with dynamic line rows (`Cuenta COA` `<select>`, `Débito USD`, `Crédito USD`, `+ Agregar Línea`), live `∑ Débito vs ∑ Crédito` badge, auto-incremented `entryNumber`, and `onSubmit` wired to `rpc.api.finance.journal.post.$post`.
2. Update `FinanceView.tsx`: replace `parseNonNegInt` raw-centavo inputs with labeled `parseMajorToMinor` `$0.00` inputs (fixing the `100x` trap!), adapt fiduciary tab title by preset (`Trust IOLTA` on `legal-psa` vs `Custodia & Depósitos Escrow` on other presets), render the `overviewQuery.data.trustLedgers` `DataTable` with 1-click `"Depositar"` / `"Desembolsar"` row actions that bind `ledgerId`, replace `'mat_1'`/`'bank_iolta_1'` with real Matter/Lease & Bank `<select>`s, and style errors with `status-error` (not indigo `status-info`).
3. Update `FinanceApAndReconPanel.tsx`: add explicit `<label>`s everywhere, render the `Sumas Iguales (Débito / Crédito)` footer on `Balance Comprobación` (removing direct balance tampering input), add `Proveedor` `<select>` + `Fecha Vencimiento` on `Cuentas por Pagar`, and bind `Conciliación Bancaria` account `<select>` to auto-populate GL `Saldo en Libros`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/GlJournalBuilder.tsx apps/web-spa/src/views/FinanceView.tsx apps/web-spa/src/views/FinanceApAndReconPanel.tsx apps/web-spa/test/finance-gaap-ux.test.ts
git commit -m "feat(finance-ui): add multi-line GlJournalBuilder, visible Trust/Escrow table, AP vendors, and decimal inputs"
```

---

### Task 20: Pulido Operativo de `StaffHubView` (Tarifas Decimales), `ProjectsBoardView` y `DealsKanbanView` (Creación + Retroceso de Etapa)

**Files:**
- Modify: `apps/web-spa/src/views/StaffHubView.tsx:1-155`
- Modify: `apps/web-spa/src/views/ProjectsBoardView.tsx:1-95`
- Modify: `apps/web-spa/src/views/DealsKanbanView.tsx:1-287`
- Test: `apps/web-spa/test/finance-gaap-ux.test.ts`

**Interfaces:**
- Produces:
  - `getAdjacentDealStages(currentStage: string): { prev: string | null; next: string | null }` in `apps/web-spa/src/views/DealsKanbanView.tsx` enabling bidirectional Kanban movement (`Calificado <-> Propuesta <-> Negociación <-> Ganado / Perdido`).

- [ ] **Step 1: Write the failing test in `apps/web-spa/test/finance-gaap-ux.test.ts`**

Add assertions testing `getAdjacentDealStages('stage_proposal')` returns `{ prev: 'stage_qualified', next: 'stage_negotiation' }` and `getAdjacentDealStages('stage_qualified').prev === null`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/finance-gaap-ux.test.ts`
Expected: FAIL (`getAdjacentDealStages` not exported).

- [ ] **Step 3: Update `StaffHubView.tsx`, `ProjectsBoardView.tsx` and `DealsKanbanView.tsx` (`<= 285` LOC each)**

1. Update `StaffHubView.tsx`: add `<select>` of staff member (eliminating silent `profiles[0] ?? 'usr_admin'`), optional `<select>` of Project/Matter, convert `hourlyRate` from raw centavos to labeled decimal `$0.00/h`, and add `onError` alert.
2. Update `ProjectsBoardView.tsx`: add `<select>` of Client (`vocabulary.partySingular`), labeled decimal `Presupuesto USD` + `Tarifa/h USD`, neutral default placeholder (removing `'Implementación POS Sucursal'`), and `onError` alert.
3. Update `DealsKanbanView.tsx`: add `"Nueva Oportunidad"` inline modal/drawer (`partyId` `<select>`, title, decimal USD value, stage), add backward + forward stage buttons (`getAdjacentDealStages`) with `min-h-8` accessible labels, add `onError` banner, and render regional summary table by branch/zone instead of an empty dashed box on `Mapa`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/StaffHubView.tsx apps/web-spa/src/views/ProjectsBoardView.tsx apps/web-spa/src/views/DealsKanbanView.tsx apps/web-spa/test/finance-gaap-ux.test.ts
git commit -m "feat(psa,deals): add Deal creation and backward Kanban transitions, staff/project selectors, and decimal rates"
```

---

## OLA 4: Hotelería PMS, Condominios, Garita Helios IoT & Plataforma Viva (`hospitality-pms`, `property-condo`, `industrial-gate`, `omni-enterprise`)

### Task 21: Hotelería PMS Operativa (Creación de Habitaciones, *Quick Check-In* / *Check-Out*, Cargos a Folio y Housekeeping Real)

**Files:**
- Modify: `apps/node-worker/src/hospitality-condo-routes.ts:1-130`
- Create: `apps/web-spa/src/views/SpaceBookingAndFolioModal.tsx`
- Modify: `apps/web-spa/src/views/HospitalityPmsView.tsx:1-175`
- Test: `apps/node-worker/test/omni-verticals.worker.test.ts`

**Interfaces:**
- Produces on `/api/hospitality`:
  - `POST /api/hospitality/units` -> body `{ unitNumber: string; floorLabel?: string; typeName: string; baseRateMinor: number; capacity?: number }` -> upserts `spc_unit_types` + `spc_units` scoped to `auth.actor.orgId` (`201`).
  - `POST /api/hospitality/folios/:id/charge-or-settle` -> body `{ action: 'charge' | 'settle'; description?: string; amountMinor?: number }` -> appends charge or settles `balance_minor = 0` (`status = 'CLOSED'`) on `spc_folios`.
  - Fixes `POST /api/hospitality/housekeeping`: marking `DIRTY` inserts a `'PENDING'` turnover task, while marking `CLEAN` / `INSPECTED` marks pending tasks `'COMPLETED'` and updates `spc_units.housekeeping_status`; `GET /api/hospitality/overview` filters by `org_id` and LEFT JOINs `crm_parties.display_name` + `spc_units.unit_number`.

- [ ] **Step 1: Write the failing test in `apps/node-worker/test/omni-verticals.worker.test.ts`**

Add tests verifying:
1. `POST /api/hospitality/units` creates Room `101` (`$120.00` = `12000` minor); reserving & checking in via `/api/spaces/bookings/reserve` + `transition` (`CHECK_IN`), posting a minibar charge via `/api/hospitality/folios/:id/charge-or-settle`, settling the folio, and checking out (`CHECK_OUT`) transitions the room cleanly.
2. Posting housekeeping `DIRTY` creates a `PENDING` task (never `COMPLETED`), and `CLEAN` completes it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/node-worker exec vitest run test/omni-verticals.worker.test.ts`
Expected: FAIL (`/api/hospitality/units` `404` and `DIRTY` inserts `COMPLETED`).

- [ ] **Step 3: Update `hospitality-condo-routes.ts`, create `SpaceBookingAndFolioModal.tsx`, and wire `HospitalityPmsView.tsx`**

1. Implement `/hospitality/units`, `/hospitality/folios/:id/charge-or-settle`, fixed housekeeping task status logic, `org_id` scoping + guest/unit JOINs, and per-unit duplicate vote prevention on `/condo/hub-items/:id/vote` in `apps/node-worker/src/hospitality-condo-routes.ts`.
2. Create `apps/web-spa/src/views/SpaceBookingAndFolioModal.tsx` (`<= 210` LOC) providing `"Nueva Habitación"`, `"Reserva / Quick Check-In"` (`rpc.api.spaces.bookings.reserve.$post` + `transition.$post`), and `"Folio: Agregar Cargo / Liquidar & Check-Out"` modals.
3. Update `HospitalityPmsView.tsx` (`<= 240` LOC): query `rpc.api.spaces.rack.$get` alongside `/api/hospitality/overview` to display `Ocupación %`, `ADR` and `RevPAR`, wire `"Nueva Habitación"` + `"Quick Check-In"` CTAs (including on the empty state!), display guest names & room numbers in Bookings/Folios tables, fix `PENDING` vs `COMPLETED` badge tones in Housekeeping, and add `CHECK_IN` / `CHECK_OUT` row actions.

- [ ] **Step 4: Run Worker & SPA tests and typecheck**

Run: `pnpm --filter @shac/node-worker exec vitest run test/omni-verticals.worker.test.ts && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/node-worker/src/hospitality-condo-routes.ts apps/web-spa/src/views/SpaceBookingAndFolioModal.tsx apps/web-spa/src/views/HospitalityPmsView.tsx apps/node-worker/test/omni-verticals.worker.test.ts
git commit -m "feat(hospitality): add room creation, Quick Check-In/Out, folio charge/settle, and real housekeeping workflow"
```

---

### Task 22: Condominios (`200 OK` en Votaciones, Unidades Reales, Calculadora *Split Rent* y `PortalView` Completo)

**Files:**
- Create: `apps/web-spa/src/views/SplitRentLeaseModal.tsx`
- Modify: `apps/web-spa/src/views/CondoResidentHubView.tsx:1-199`
- Modify: `apps/web-spa/src/views/PortalView.tsx:1-165`
- Test: `apps/web-spa/test/condo-helios-demo.test.ts`

**Interfaces:**
- Produces:
  - `computeUiSplitPreview(monthlyRentMinor: number, shares: Array<{ partyId: string; percentInput: string }>): { valid: boolean; totalBps: number; allocations: Array<{ partyId: string; shareBps: number; amountMinor: number }> }` in `apps/web-spa/src/views/SplitRentLeaseModal.tsx` (`totalBps === 10_000` exact check).

- [ ] **Step 1: Write the failing test `apps/web-spa/test/condo-helios-demo.test.ts`**

Create `apps/web-spa/test/condo-helios-demo.test.ts` asserting `computeUiSplitPreview(100_000, [{ partyId: 'p1', percentInput: '60' }, { partyId: 'p2', percentInput: '40' }])` yields `valid: true, totalBps: 10_000` with `60_000` and `40_000` minor, while `50% + 40%` yields `valid: false, totalBps: 9_000`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/condo-helios-demo.test.ts`
Expected: FAIL (`SplitRentLeaseModal` missing).

- [ ] **Step 3: Implement `SplitRentLeaseModal.tsx` and update `CondoResidentHubView.tsx` & `PortalView.tsx` (`<= 260` LOC each)**

1. Create `apps/web-spa/src/views/SplitRentLeaseModal.tsx` (`<= 200` LOC) with `"Crear Unidad"` (`POST /api/hospitality/units`) and `"Activar Contrato Lease + Split Rent"` (`rpc.api.leases.contracts.activate.$post` with multi-tenant `%` rows validated to `100.00%`).
2. Update `CondoResidentHubView.tsx`: replace raw unauthenticated `fetch()` in `voteMutation` with typed `rpc.api.condo['hub-items'][':id'].vote.$post` (fixing the `401` bug!), add `announcement` (`Comunicado Vecinal`) option & tab, replace hardcoded `'APT-4B'` input with `spc_units` `<select>`, wire `Contratos Lease` tab to `<SplitRentLeaseModal>` + `renew-or-vacate` action, and display issued PIN/QR when creating a `visitor_pass` via `/api/physical/passes/issue`.
3. Update `PortalView.tsx`: remove the hardcoded fake 3-step `<ol>` tracker, adapt labels to `vocabulary.partySingular`, link attachments to `/api/media/${encodeURIComponent(r2Key)}`, and add a non-confidential message composer.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/SplitRentLeaseModal.tsx apps/web-spa/src/views/CondoResidentHubView.tsx apps/web-spa/src/views/PortalView.tsx apps/web-spa/test/condo-helios-demo.test.ts
git commit -m "feat(condo,portal): fix authenticated poll voting, add Split Rent lease builder, and wire live PortalView"
```

---

### Task 23: Consola Táctil de Garita Helios `56px` (`Pulso 5s`, `Lockdown`, Batería Real, Modal QR/PIN WhatsApp y Escaneo LPR)

**Files:**
- Modify: `apps/node-worker/src/physical-helios-routes.ts:1-125`
- Create: `apps/web-spa/src/views/HeliosPassAndLprModal.tsx`
- Modify: `apps/web-spa/src/views/HeliosSecurityView.tsx:1-231`
- Test: `apps/web-spa/test/condo-helios-demo.test.ts`

**Interfaces:**
- Produces:
  - In `apps/node-worker/src/physical-helios-routes.ts`: `POST /api/physical/devices/upsert-or-toggle` preserves existing `battery_pct` via `COALESCE(?6, phy_devices_and_locks.battery_pct, 100)` when `batteryPct` is omitted on lock toggles; adds `POST /api/physical/devices/lockdown` locking all active doors in `auth.actor.orgId` atomically (`200`).
  - `buildWhatsAppPassUrl(visitorName: string, secretPin: string, branchName: string): string` in `apps/web-spa/src/views/HeliosPassAndLprModal.tsx`.

- [ ] **Step 1: Write the failing test in `apps/web-spa/test/condo-helios-demo.test.ts`**

Add tests asserting `buildWhatsAppPassUrl('Juan Pérez', 'A9F3K2P1', 'Parque Norte')` returns an encoded `https://wa.me/?text=...` link containing `'A9F3K2P1'` and `'Parque Norte'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/condo-helios-demo.test.ts`
Expected: FAIL (`HeliosPassAndLprModal` not found).

- [ ] **Step 3: Update `physical-helios-routes.ts`, create `HeliosPassAndLprModal.tsx`, and refactor `HeliosSecurityView.tsx` (`<= 260` LOC each)**

1. Update `apps/node-worker/src/physical-helios-routes.ts`: make `batteryPct` optional (`COALESCE` preserving real sensor battery on toggle) and add `POST /physical/devices/lockdown`.
2. Create `apps/web-spa/src/views/HeliosPassAndLprModal.tsx` (`<= 190` LOC): displays newly issued `pinOrQrSecret` in `text-3xl font-mono` + `<BarcodeSvg />` + `"Compartir por WhatsApp"` button, hosts the secondary `"Registrar Dispositivo IoT"` modal (clearing sysadmin clutter off the live gate deck!), and provides `"Validar Pase QR/PIN"` (`POST /api/physical/passes/validate`).
3. Update `HeliosSecurityView.tsx`: add explicit `<label>`s, render `min-h-14` (`56px`) **`Pulso 5s`** (unlocks gate and schedules auto-relock after `5000ms` with live countdown) + `Abrir/Cerrar` + header emergency red **`Lockdown Perimetral`** button, render active `overviewQuery.data.passes`, and add manual LPR plate verification bar wired to `POST /api/physical/lpr/scan`.

- [ ] **Step 4: Run Worker & SPA tests and typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/node-worker exec vitest run src/__tests__/phase8.worker.test.ts && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/node-worker/src/physical-helios-routes.ts apps/web-spa/src/views/HeliosPassAndLprModal.tsx apps/web-spa/src/views/HeliosSecurityView.tsx apps/web-spa/test/condo-helios-demo.test.ts
git commit -m "feat(helios): add 56px Pulso 5s and Lockdown controls, preserve lock battery, and display QR/PIN pass modal"
```

---

### Task 24: Ejecución Idempotente DDL `v_cf_*` en D1, `<CustomFieldsSection />` Vivo y Pulido de `PartiesView`

**Files:**
- Modify: `apps/node-worker/src/custom-fields-routes.ts:75-145`
- Create: `apps/web-spa/src/views/CustomFieldsSection.tsx`
- Modify: `apps/web-spa/src/views/PartiesView.tsx:1-281`
- Test: `apps/node-worker/test/phase2-crm-labels.worker.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/system/custom-fields` (`custom-fields-routes.ts`): inspects `PRAGMA table_info(<targetEntity>)` before running `alterSql` + `indexSql` on `c.env.DB` so `v_cf_<fieldKey>` virtual column and B-Tree index are genuinely created on D1 and idempotent on repeat calls (`indexExecuted: boolean`).
  - `CustomFieldsSection({ rpc, targetEntity, values, onChange }: CustomFieldsSectionProps)` in `apps/web-spa/src/views/CustomFieldsSection.tsx` dynamically rendering `text`/`number`/`boolean`/`select` inputs from `GET /api/system/custom-fields`.

- [ ] **Step 1: Write the failing test in `apps/node-worker/test/phase2-crm-labels.worker.test.ts`**

Pin Review Focus #5:
1. Calling `POST /api/system/custom-fields` with `{ targetEntity: 'crm_parties', fieldKey: 'registro_sanitario', label: 'Registro Sanitario', fieldType: 'text', isIndexed: true }` executes DDL so `SELECT v_cf_registro_sanitario FROM crm_parties LIMIT 1` succeeds on D1 (`0` error!).
2. Calling the exact same `POST /api/system/custom-fields` payload a second time succeeds idempotently without `duplicate column name` `500`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/node-worker exec vitest run test/phase2-crm-labels.worker.test.ts`
Expected: FAIL (`no such column: v_cf_registro_sanitario` because `alterSql` was never executed).

- [ ] **Step 3: Execute safe `v_cf_*` DDL in `custom-fields-routes.ts`, create `CustomFieldsSection.tsx`, and mount in `PartiesView.tsx`**

1. Update `apps/node-worker/src/custom-fields-routes.ts`: strictly validate `targetEntity` against allowlist (`crm_parties`, `cat_products`, `com_orders`, `spc_units`, `leg_matters`) and `fieldKey` (`^[a-z][a-z0-9_]{1,40}$`), check `PRAGMA table_info`, execute `alterSql` (if column absent) and `indexSql` (`CREATE INDEX IF NOT EXISTS ...`) on `c.env.DB`.
2. Create `apps/web-spa/src/views/CustomFieldsSection.tsx` (`<= 110` LOC) fetching definitions for `targetEntity` and rendering labeled inputs bound to `customAttributes`.
3. Update `apps/web-spa/src/views/PartiesView.tsx` (`<= 290` LOC): mount `<CustomFieldsSection targetEntity="crm_parties" />` passing `customAttributes` to `POST /api/customers/parties`, default new party role to the active preset (`'patient'` in `clinic-practice`, `'guest'` in `hospitality-pms`, `'tenant_resident'` in `property-condo`, `'legal_client'` in `legal-psa`), translate filter chips to Spanish, adapt tax label (`Documento / ID Fiscal`), and show copyable short `id` badge.

- [ ] **Step 4: Run Worker & SPA tests and typecheck**

Run: `pnpm --filter @shac/node-worker exec vitest run test/phase2-crm-labels.worker.test.ts && pnpm --filter @shac/web-spa typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/node-worker/src/custom-fields-routes.ts apps/web-spa/src/views/CustomFieldsSection.tsx apps/web-spa/src/views/PartiesView.tsx apps/node-worker/test/phase2-crm-labels.worker.test.ts
git commit -m "feat(custom-fields,parties): execute live D1 v_cf_* DDL and mount dynamic CustomFieldsSection in PartiesView"
```

---

### Task 25: Simulador Demo Real Conectado a RPC + Cambio de Preset por Persona, SOPs Completos y Cierre de Batería `RDD`

**Files:**
- Modify: `apps/web-spa/src/lib/demoScenarios.ts:1-156`
- Modify: `apps/web-spa/src/views/DemoAndSopCenterView.tsx:1-187`
- Modify: `apps/web-spa/src/views/AutomationView.tsx:1-130`
- Test: `apps/web-spa/test/condo-helios-demo.test.ts`

**Interfaces:**
- Produces:
  - `DemoPersona` in `demoScenarios.ts` extended with `presetId: EditionPresetId` across all 6+ personas (adding `property-condo` and `distro-wms` personas + Hotel PMS & Condo SOP cheat-sheets).
  - `executeLiveScenarioStep(rpc: RpcClient, scenarioId: string, stepIndex: number): Promise<string>` in `demoScenarios.ts` executing real idempotent Hono RPC calls against D1/`BranchInventoryDO` and returning the server receipt line (zero fabricated client-only logs!).

- [ ] **Step 1: Write the failing test in `apps/web-spa/test/condo-helios-demo.test.ts`**

Add tests asserting:
1. Every `DemoPersona` in `DEMO_PERSONAS` specifies a valid `EditionPresetId`, and `SOP_CHEAT_SHEETS` covers Retail POS, GAAP/Legal, Clinical EHR, Helios Gatehouse, Hospitality PMS, and Condo Leases (`>= 6` cheat-sheets).
2. `executeLiveScenarioStep` invokes the mocked `rpc` endpoint and throws if the server returns `!ok` rather than fabricating a checkmark log.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/condo-helios-demo.test.ts`
Expected: FAIL (`executeLiveScenarioStep` and `presetId` missing).

- [ ] **Step 3: Implement live RPC `DemoAndSopCenterView`, update `AutomationView`, and run full monorepo verification**

1. Update `apps/web-spa/src/lib/demoScenarios.ts` & `DemoAndSopCenterView.tsx`: wire `"Ejecutar Paso"` to `executeLiveScenarioStep(rpc, activeScenario.id, state.currentStep)` with loading spinner + real error handling, and wire `"Entrar como [Persona]"` to call `rpc.api.system['app-store'].toggle.$post({ json: { switchPreset: p.presetId, presetMode: 'replace' } })`, invalidate `['auth', 'bootstrap']`, and then navigate to `p.route`.
2. Update `AutomationView.tsx`: render pending AI `proposals` list with 1-click `"Aprobar"` / `"Rechazar"` buttons instead of requiring operators to type `'prop_demo_1'` from memory, plus `onError` alerts.
3. Verify every `.ts` and `.tsx` file modified across Waves 1–4 is `<= 300` lines.

- [ ] **Step 4: Run Full Receipt-Driven Development (`RDD`) Verification Gate (`AGENTS.md` §6)**

Run:
1. `pnpm -r typecheck`
2. `pnpm dlx knip --strict`
3. `pnpm -r test:run`
4. `pnpm --filter @shac/web-spa build`
5. `pnpm --filter @shac/node-worker exec wrangler deploy --dry-run --outdir .wrangler/dist`
6. Verificar cero rutas absolutas de sistema operativo en `docs/`, `apps/`, `packages/` y `editions/` (`0` coincidencias)
7. `rg -i "DROP TABLE|DROP COLUMN" packages/db-d1/migrations/` (must return `0` matches)

Expected: All tests green (`exit code 0`), `0` `knip` issues, SPA entry chunk `< 250 kB`, Worker bundle `< 1024 KiB` gzip (`~240–270 KiB` gzip).

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/lib/demoScenarios.ts apps/web-spa/src/views/DemoAndSopCenterView.tsx apps/web-spa/src/views/AutomationView.tsx apps/web-spa/test/condo-helios-demo.test.ts
git commit -m "feat(demo,automation): wire real RPC scenario execution, persona preset switching, and proposal list actions"
```

---

### Task 26: `<CustomFieldsSection targetEntity="cat_products" />` en Catálogo, Confirmación de Conectores y Cierre Final `RDD`

**Files:**
- Modify: `apps/web-spa/src/views/CatalogView.tsx:1-280`
- Modify: `apps/web-spa/src/views/IntegrationsHubView.tsx:1-130`
- Modify: `apps/web-spa/src/views/WorkflowsVisualView.tsx:1-115`
- Test: `apps/web-spa/test/condo-helios-demo.test.ts`

**Interfaces:**
- Consumes: `CustomFieldsSection` (`targetEntity="cat_products"`) from `Task 24`.
- Produces:
  - `CatalogView` passing `customAttributes` to `POST /api/catalog/products` (`<= 290` LOC).
  - `IntegrationsHubView` opening an endpoint/credential configuration modal before inserting a connector (preventing 1-click accidental `stripe://live-checkout` insertion) + `onError` alert.
  - `WorkflowsVisualView` editable step list (`Agregar / Quitar Paso`) serialized into `definitionJson` (eliminating static `DEFAULT_NODES`) + `onError` alert.

- [ ] **Step 1: Write the failing test in `apps/web-spa/test/condo-helios-demo.test.ts`**

Add unit test verifying `serializeWorkflowSteps([{ id: 's1', label: 'Validar Stock', kind: 'check' }])` produces valid schema JSON and rejects empty step lists.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @shac/web-spa exec vitest run test/condo-helios-demo.test.ts`
Expected: FAIL (`serializeWorkflowSteps` not exported).

- [ ] **Step 3: Update `CatalogView.tsx`, `IntegrationsHubView.tsx` and `WorkflowsVisualView.tsx` (`<= 290` LOC each)**

1. Mount `<CustomFieldsSection rpc={rpc} targetEntity="cat_products" values={customAttrs} onChange={setCustomAttrs} />` inside `CatalogView.tsx` and pass `customAttributes` on product creation.
2. Replace 1-click preset card auto-insert in `IntegrationsHubView.tsx` with pre-filling the labeled connector configuration form + confirmation submit and `onError` banner.
3. Add interactive step builder (`serializeWorkflowSteps`) and `onError` banner in `WorkflowsVisualView.tsx`.

- [ ] **Step 4: Run Full Receipt-Driven Development (`RDD`) Final Verification Gate (`AGENTS.md` §6)**

Run:
1. `pnpm -r typecheck`
2. `pnpm dlx knip --strict`
3. `pnpm -r test:run`
4. `pnpm --filter @shac/web-spa build`
5. `pnpm --filter @shac/node-worker exec wrangler deploy --dry-run --outdir .wrangler/dist`
6. Verificar cero rutas absolutas de sistema operativo en `docs/`, `apps/`, `packages/` y `editions/` (`0` coincidencias)
7. `rg -i "DROP TABLE|DROP COLUMN" packages/db-d1/migrations/` (0 matches)

Expected: Exit code `0` across all checks, `0` `knip` issues, SPA entry chunk `< 250 kB`, Worker gzip `< 1024 KiB`, and every `.ts`/`.tsx` source file `<= 300` LOC.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/CatalogView.tsx apps/web-spa/src/views/IntegrationsHubView.tsx apps/web-spa/src/views/WorkflowsVisualView.tsx apps/web-spa/test/condo-helios-demo.test.ts
git commit -m "feat(catalog,workflows,integrations): mount product CustomFieldsSection, editable workflow steps, and connector confirmation"
```
