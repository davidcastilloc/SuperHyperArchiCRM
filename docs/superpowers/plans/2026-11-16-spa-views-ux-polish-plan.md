# Pulido Integral de Vistas SPA (`@shac/web-spa`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pulir las 12 vistas de `@shac/web-spa` para eliminar IDs manuales (`prod_amox`, `pty_1`, `unit_101`), agregar las acciones operativas faltantes (cierre de turno POS, auto-recuperación de turno abierto `409 SHIFT_ALREADY_OPEN`, recepción de lotes FEFO y tasa BCV, selectores conectados a datos reales e invalidación instantánea del sidebar en App Store) y mostrar errores de API legibles.

**Architecture:** Se extiende `phase2-format.ts` con un extractor tipado de errores HTTP/SHAC (`readApiError`) que preserva `code`, `message` y `details` (como `openShiftId`). Cada grupo de vistas consume los listados reales ya disponibles en Hono RPC (`customers.parties`, `catalog.products`, `spaces.rack`) mediante selectores con fallback y mantiene todos los archivos bajo el límite duro de `<= 300` líneas de `AGENTS.md`.

**Tech Stack:** React 19, Vite, TanStack Query (`offlineFirst`), Hono RPC (`hc<AppRouter>`), Tailwind CSS v4.

**Spec:** `DESIGN.md` y `docs/superpowers/specs/2026-11-16-interactive-auth-session-design.md`

## Global Constraints

- Máximo `300` líneas por archivo `.ts` o `.tsx` (`AGENTS.md` §3).
- Máximo `3` archivos de implementación por tarea + su archivo `.test.ts` (`AGENTS.md` §3).
- Cero aritmética en punto flotante para montos o tasas: usar enteros `minor` y `BigInt` (`AGENTS.md` §4).
- Cero rutas absolutas de sistema operativo en código o documentación (`AGENTS.md` §1.4).
- `pnpm -r typecheck`, `pnpm dlx knip --strict` y `pnpm --filter @shac/web-spa test:run` deben salir con código `0` al cierre.

## Review Focus

- Respuesta `409 SHIFT_ALREADY_OPEN` al abrir turno en `PosView`: debe capturar `details.openShiftId` y asignarlo automáticamente al estado `shiftId` mostrando aviso claro al cajero.
- Selección de producto en `PosView`: cambiar producto o cantidad debe recalcular automáticamente `orderTotalMinor = unitPriceMinor * qty` en enteros sin `NaN`.
- Cierre de turno en `PosView`: debe enviar `actualCountedBalancesMinor: { USD, VES }` a `/api/pos/shifts/close` y limpiar `shiftId` al completarse.
- Cambio de preset o módulo en `AppStoreView`: debe invalidar tanto `['system', 'profile']` como `['auth', 'bootstrap']` para que el menú lateral de `ShacAppShell` se actualice en `0 ms` sin recargar el navegador.
- Errores de validación o negocio (`400`, `403`, `404`, `409`, `422`) en cualquier vista: `readApiError` debe mostrar `error.message` del Worker en lugar de un genérico `HTTP 4xx`.

---

### Task 1: Extractor de Errores API (`phase2-format.ts`) + Pulido Completo de `PosView.tsx` y `SmartCheckKioskView.tsx`

**Files:**
- Modify: `apps/web-spa/src/views/phase2-format.ts:1-28`
- Modify: `apps/web-spa/src/views/PosView.tsx:1-199`
- Modify: `apps/web-spa/src/views/SmartCheckKioskView.tsx:1-111`
- Test: `apps/web-spa/test/spa.offline.test.ts`

**Interfaces:**
- Produces:
  - `export class ShacApiError extends Error { readonly status: number; readonly code: string; readonly details?: Record<string, unknown>; }` in `apps/web-spa/src/views/phase2-format.ts`
  - `export async function readApiError(res: Response): Promise<ShacApiError>` in `apps/web-spa/src/views/phase2-format.ts`

- [ ] **Step 1: Escribir el test fallido para `readApiError` (incluyendo extracción de `details.openShiftId` en `409 SHIFT_ALREADY_OPEN`)**

En `apps/web-spa/test/spa.offline.test.ts`, agregar un test que construya un `new Response(JSON.stringify({ error: { code: 'SHIFT_ALREADY_OPEN', message: 'Shift open', details: { openShiftId: 'sh_123' } } }), { status: 409 })`, invoque `await readApiError(res)` y afirme `err.code === 'SHIFT_ALREADY_OPEN'`, `err.message === 'Shift open'` y `err.details?.openShiftId === 'sh_123'`.

- [ ] **Step 2: Ejecutar el test para verificar que falla (RED)**

Run: `pnpm --filter @shac/web-spa test:run`
Expected: FAIL (`readApiError is not a function`)

- [ ] **Step 3: Implementar `ShacApiError` y `readApiError` en `phase2-format.ts` y actualizar `PosView.tsx` y `SmartCheckKioskView.tsx`**

1. En `apps/web-spa/src/views/phase2-format.ts`: exportar `ShacApiError` y `readApiError(res: Response): Promise<ShacApiError>`.
2. En `apps/web-spa/src/views/PosView.tsx` (`<= 280` líneas):
   - Consultar productos reales con `useQuery(['catalog', 'products'])` (`rpc.api.catalog.products.$get({ query: { limit: '50' } })`).
   - Reemplazar el input manual `prod_amox` por un selector `<select>` de productos del catálogo (más opción de escribir ID manual si se desea) que actualice automáticamente `orderTotalMinor = String(selectedProduct.basePriceMinor * qty)` y `usdAmountMinor`.
   - En `openShiftMutation`: si `res.status === 409`, usar `await readApiError(res)` y si `err.details?.openShiftId` existe, asignarlo a `setShiftId(String(err.details.openShiftId))` y mostrar `"Turno activo recuperado: <openShiftId>"`.
   - Agregar `closeShiftMutation` (`rpc.api.pos.shifts.close.$post`) con inputs para efectivo contado `USD` y `VES` (`actualCountedBalancesMinor`) y botón **"Cerrar Turno"** que limpia `shiftId` al cerrar.
3. En `apps/web-spa/src/views/SmartCheckKioskView.tsx` (`<= 160` líneas):
   - Consultar `rpc.api.catalog.products.$get({ query: { limit: '12' } })` y mostrar botones táctiles rápidos (`SKU · Nombre`) para probar cualquier producto en 1 clic sin teclear el SKU, usando `readApiError` en caso de error.

- [ ] **Step 4: Ejecutar pruebas y typecheck para verificar que pasa (GREEN)**

Run: `pnpm --filter @shac/web-spa test:run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/phase2-format.ts apps/web-spa/src/views/PosView.tsx apps/web-spa/src/views/SmartCheckKioskView.tsx apps/web-spa/test/spa.offline.test.ts
git commit -m "feat(web-spa): add POS shift close, catalog product selector, and SmartCheck quick chips"
```

---

### Task 2: Pulido de `CatalogView.tsx`, `WmsView.tsx` y `PartiesView.tsx`

**Files:**
- Modify: `apps/web-spa/src/views/CatalogView.tsx:1-209`
- Modify: `apps/web-spa/src/views/WmsView.tsx:1-168`
- Modify: `apps/web-spa/src/views/PartiesView.tsx:1-175`
- Test: `apps/web-spa/test/spa.offline.test.ts`

**Interfaces:**
- Consumes: `readApiError` from `apps/web-spa/src/views/phase2-format.ts`
- Produces:
  - Formulario de tasa BCV (`rpc.api.catalog.rates.$post`) y botón `+20 Stock` (`rpc.api.branch.inventory['receive-lot'].$post`) en `CatalogView.tsx`
  - Recepción de lotes FEFO y selector de productos reales en `WmsView.tsx`

- [ ] **Step 1: Escribir test en `apps/web-spa/test/spa.offline.test.ts` verificando rutas RPC de tasas (`catalog.rates`) y recepción de lotes (`branch.inventory['receive-lot']`)**

Agregar aserción en `spa.offline.test.ts` comprobando `rpc.api.catalog.rates.$url().toString()` y el formato de error de `readApiError` ante cuerpos no-JSON (`HTTP 502`).

- [ ] **Step 2: Ejecutar test para verificar que falla si el fallback no-JSON no está cubierto**

Run: `pnpm --filter @shac/web-spa test:run`
Expected: PASS/FAIL según cobertura de `readApiError`

- [ ] **Step 3: Actualizar `CatalogView.tsx`, `WmsView.tsx` y `PartiesView.tsx` (`<= 280` líneas cada uno)**

1. En `CatalogView.tsx`:
   - Añadir barra compacta para actualizar tasa de cambio `USD -> VES` (`rpc.api.catalog.rates.$post` con `fromCurrency: 'USD'`, `toCurrency: 'VES'`, `rateMicros`, `source: 'BCV'`).
   - En cada fila de producto, además de `Cotizar` y `Stock`, añadir botón **`+Recibir Lote (10u)`** que invoca `rpc.api.branch.inventory['receive-lot'].$post` y refresca el saldo FEFO en 1 clic.
   - Mostrar botón para copiar/ver el `SKU` y `ID` claramente y usar `readApiError`.
2. En `WmsView.tsx`:
   - Cargar productos del catálogo (`useQuery(['catalog', 'products'])`) para elegir el producto desde un `<select>` en vez de `'prod_amox'`.
   - Agregar formulario rápido de **Recepción de Lote FEFO en Sucursal (`receive-lot`)** (`productId`, `lotCode`, `qty`, `unitCostMinor`) arriba del formulario de Picking.
3. En `PartiesView.tsx`:
   - Mostrar mensajes de error detallados con `readApiError` en lugar de `HTTP 4xx`, y mostrar una columna con el `ID` abreviado / copiable para referencia cruzada.

- [ ] **Step 4: Ejecutar pruebas y typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS (exit code 0)

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/CatalogView.tsx apps/web-spa/src/views/WmsView.tsx apps/web-spa/src/views/PartiesView.tsx apps/web-spa/test/spa.offline.test.ts
git commit -m "feat(web-spa): add BCV rate form, 1-click lot receipt, and product selectors in Catalog and WMS"
```

---

### Task 3: Pulido de `SpacesView.tsx`, `LeasesView.tsx` y `CasesView.tsx`

**Files:**
- Modify: `apps/web-spa/src/views/SpacesView.tsx:1-199`
- Modify: `apps/web-spa/src/views/LeasesView.tsx:1-143`
- Modify: `apps/web-spa/src/views/CasesView.tsx:1-134`

**Interfaces:**
- Consumes: `readApiError` from `apps/web-spa/src/views/phase2-format.ts`, `rpc.api.customers.parties.$get`, `rpc.api.spaces.rack.$get`

- [ ] **Step 1: Conectar selectores reales de Unidades y Clientes en `SpacesView.tsx`, `LeasesView.tsx` y `CasesView.tsx`**

1. En `SpacesView.tsx` (`<= 260` líneas):
   - Consultar `parties` (`rpc.api.customers.parties.$get({ query: { limit: '50' } })`) para poblar `<select>` de huésped/cliente en Reserva y Waitlist (con fallback si aún no hay registros).
   - Poblar selector de `unitId` desde `rackQuery.data?.units` y permitir clic en `"Seleccionar"` en cualquier fila de la tabla del rack para llenar `unitId`.
   - Usar `readApiError` en todas las mutaciones.
2. En `LeasesView.tsx` (`<= 220` líneas):
   - Consultar `parties` y `spaces.rack` para ofrecer `<select>` de unidad, inquilino titular y co-inquilino en lugar de `'unit_101'`, `'party_1'`, `'party_2'`.
   - Mostrar vista previa en vivo del prorrateo (`Titular %` vs `Co-inquilino %`) y usar `readApiError`.
3. En `CasesView.tsx` (`<= 200` líneas):
   - Consultar `parties` para seleccionar el paciente/cliente real desde `<select>` en Notas SOAP, Ensayos ABA y Expedientes Legales, y usar `readApiError`.

- [ ] **Step 2: Verificar pruebas y typecheck**

Run: `pnpm --filter @shac/web-spa test:run && pnpm --filter @shac/web-spa typecheck`
Expected: PASS (exit code 0)

- [ ] **Step 3: Commit**

```bash
git add apps/web-spa/src/views/SpacesView.tsx apps/web-spa/src/views/LeasesView.tsx apps/web-spa/src/views/CasesView.tsx
git commit -m "feat(web-spa): wire live party and unit selectors in Spaces, Leases, and Cases views"
```

---

### Task 4: Pulido de `FinanceView.tsx`, `PortalView.tsx`, `AutomationView.tsx`, `PhysicalView.tsx` y `AppStoreView.tsx` + Despliegue

**Files:**
- Modify: `apps/web-spa/src/views/FinanceView.tsx:1-128`
- Modify: `apps/web-spa/src/views/PortalView.tsx:1-81`
- Modify: `apps/web-spa/src/views/AppStoreView.tsx:1-182`

*(Nota: si `AutomationView.tsx` o `PhysicalView.tsx` requieren ajuste de `readApiError`, se hace en un segundo paso dentro de la misma tarea para respetar el tope de 3 archivos por paso de `AGENTS.md`.)*

**Interfaces:**
- Consumes: `readApiError` from `apps/web-spa/src/views/phase2-format.ts`

- [ ] **Step 1: Actualizar `FinanceView.tsx`, `PortalView.tsx` y `AppStoreView.tsx`**

1. En `FinanceView.tsx`:
   - Conectar selector de cliente (`rpc.api.customers.parties.$get`) para cuentas Trust/IOLTA y usar `readApiError` para mostrar claramente el código `TRUST_OVERDRAFT_BLOCKED` cuando se intenta sobregirar.
2. En `PortalView.tsx`:
   - Añadir selector `<select>` de cliente (`parties`) además del filtro libre para consultar adjuntos y mensajes públicos (`is_confidential = 0`).
3. En `AppStoreView.tsx`:
   - Al completar `toggleMutation`, invalidar tanto `['system', 'profile']` como `['auth', 'bootstrap']` para que el sidebar de `ShacAppShell` refleje al instante el nuevo preset, módulos y vocabulario sin recargar la página.

- [ ] **Step 2: Actualizar `AutomationView.tsx` y `PhysicalView.tsx` con `readApiError` y selectores de eventos/alertas**

1. En `AutomationView.tsx`: selector `<select>` para `entityType` (`work_order`, `pos_order`, `lease_contract`, `clinical_note`) y `lifecycleEvent` (`on_create`, `on_status_change`, `on_overdue`), más `readApiError`.
2. En `PhysicalView.tsx`: usar `readApiError` en las 5 mutaciones y sincronizar automáticamente el `pinSecret` emitido con el validador constant-time.

- [ ] **Step 3: Ejecutar batería RDD completa (`typecheck`, `knip --strict`, `test:run`, `build`, `wrangler deploy`)**

Run:
```bash
pnpm -r typecheck
pnpm dlx knip --strict
pnpm --filter @shac/web-spa test:run
pnpm --filter @shac/web-spa build
pnpm --filter @shac/node-worker exec wrangler deploy
```
Expected: Exit code `0` en todos los comandos y nueva versión publicada en `https://shac-node-worker.pc911itservices.workers.dev`.

- [ ] **Step 4: Commit y Push**

```bash
git add apps/web-spa/src/views/FinanceView.tsx apps/web-spa/src/views/PortalView.tsx apps/web-spa/src/views/AppStoreView.tsx apps/web-spa/src/views/AutomationView.tsx apps/web-spa/src/views/PhysicalView.tsx
git commit -m "feat(web-spa): polish Finance, Portal, AppStore, Automation, and Physical views"
```
