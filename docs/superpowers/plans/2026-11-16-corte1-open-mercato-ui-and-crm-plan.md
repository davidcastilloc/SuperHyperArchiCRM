# Corte 1: Extracción `@open-mercato/ui` hacia `@shac/ui` + Suite CRM Real (`Parties`, `Deals` & `Conflict Checks`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar las primitivas empresariales MIT de `../base/open-mercato/packages/ui` (`KpiCard`, `EmptyState`, `SectionHeader`, `RowActions`, `FilterBar` y `DataTable`) hacia `@shac/ui` (desacopladas de Next.js, en React 19 + Tailwind v4 y `<= 300` líneas por archivo), agregar `GET /api/customers/deals` (`customers.deals.list` con pipeline por defecto) en `@shac/mod-customers` + `@shac/node-worker`, y reconstruir `/parties` como el **CRM Workbench completo de Open Mercato** (KPIs + Directorio `DataTable` con filtros por rol/tipo + Ficha lateral de cliente + Tablero de `Deals`/Oportunidades + Verificador de Conflictos de Interés y Vínculos).

**Architecture:** Siguiendo `AGENTS.md` §7.1, los componentes de `@open-mercato/ui` se extraen hacia `packages/ui/src/components/` eliminando `next/link`, `next/navigation`, `useT` e `InjectionSpot`, manteniendo `data-slot`, `ref` como prop de React 19 y clases semánticas de `DESIGN.md`. En el backend, `@shac/mod-customers` incorpora `customersDealsListCommand` (`<= 2` queries D1 con `db.batch()`) y asegura en `customersDealsCreateCommand` que si el pipeline solicitado (`pipe_default`) aún no existe para el tenant/org, se aprovisione en el mismo batch transaccional para que crear un Deal desde la UI nunca falle por falta de semilla previa.

**Tech Stack:** React 19, Tailwind CSS v4, TanStack Query (`offlineFirst`), Hono RPC (`hc<AppRouter>`), Drizzle ORM sobre Cloudflare D1 (`workerd`), Vitest 4.1+.

**Spec:** `SPEC.md`, `DESIGN.md` y `AGENTS.md` (§7 y §7.1)

## Global Constraints

- Máximo `300` líneas por archivo `.ts` o `.tsx` (`AGENTS.md` §3).
- Máximo `3` archivos de implementación por paso + su `.test.ts` (`AGENTS.md` §3).
- Presupuesto de consultas D1 en lecturas/listados: `expect(queryCount).toBeLessThanOrEqual(2)` usando `db.batch()` (`AGENTS.md` §6.3).
- Aislamiento multi-tenant obligatorio: toda consulta Drizzle incluye `eq(table.tenantId, ctx.tenantId)` + `buildOrgSubtreeFilter(ctx)` (`AGENTS.md` §5.1).
- Cero dependencias de `next/*`, `React.forwardRef` o punto flotante para dinero (`valueMinor`, `creditLimitMinor` en enteros) (`AGENTS.md` §4 y §7.1).
- Cero rutas absolutas de sistema operativo en código o planes (`AGENTS.md` §1.4).

## Review Focus

- `DataTable` con `items = []` debe renderizar `EmptyState` sin errores y soportar ordenamiento local por columna (`sortable: true`), búsqueda/chips en `FilterBar` y menú de acciones por fila (`RowActions`).
- `GET /api/customers/deals` debe cumplir `queryCount <= 2` en `db.batch()` y aislar estrictamente por `tenantId` y `orgPath` subtree (`403`/`0` registros ante otro tenant).
- `POST /api/customers/deals` desde la UI cuando `crm_pipelines_and_stages` aún no tiene filas en el tenant: debe auto-aprovisionar el pipeline estándar (`pipe_default` / `stage_qualified`) dentro de la misma organización para no devolver `404 PIPELINE_NOT_FOUND`.
- Ficha de cliente y pestañas CRM en `/parties`: debe permitir filtrar por rol (`customer`, `vendor`, `patient`, `legal_client`, etc.), abrir el panel de detalle de un cliente, crear un `Deal` vinculado, vincular dos `Parties` (`customers.links.create`) y ejecutar un `Conflict Check` (`customers.conflicts.check`) mostrando `clear` vs `potential_conflict`.
- `knip --strict`, `pnpm -r typecheck` y todas las suites Vitest deben terminar con código `0`.

---

### Task 1: Portar Primitivas Base (`KpiCard`, `EmptyState`, `SectionHeader`, `RowActions`) de `@open-mercato/ui` a `@shac/ui`

**Files:**
- Create: `packages/ui/src/components/KpiCard.tsx`
- Create: `packages/ui/src/components/EmptyState.tsx`
- Create: `packages/ui/src/components/SectionHeader.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/test/ui.smoke.test.tsx`

**Interfaces:**
- Produces:
  - `export interface KpiTrend { value: number; direction: 'up' | 'down' | 'unchanged'; }`
  - `export interface KpiCardProps { title?: string; value: number | string | null; trend?: KpiTrend; comparisonLabel?: string; loading?: boolean; error?: string | null; prefix?: string; suffix?: string; footer?: ReactNode; className?: string; ref?: Ref<HTMLDivElement>; }`
  - `export function KpiCard(props: KpiCardProps): JSX.Element`
  - `export interface EmptyStateProps { title: string; description?: string; icon?: ReactNode; actionLabel?: string; onAction?: () => void; actions?: ReactNode; size?: 'sm' | 'default' | 'lg'; className?: string; ref?: Ref<HTMLDivElement>; }`
  - `export function EmptyState(props: EmptyStateProps): JSX.Element`
  - `export interface RowActionItem { id: string; label: string; onSelect: () => void; destructive?: boolean; }`
  - `export interface SectionHeaderProps { title: string; count?: number; action?: ReactNode; className?: string; }`
  - `export function SectionHeader(props: SectionHeaderProps): JSX.Element`
  - `export function RowActions(props: { items: RowActionItem[]; label?: string }): JSX.Element`

- [ ] **Step 1: Escribir el test fallido en `packages/ui/test/ui.smoke.test.tsx`**

Agregar un test en `packages/ui/test/ui.smoke.test.tsx` que importe `KpiCard`, `EmptyState`, `SectionHeader` y `RowActions` desde `../src/index.js`, los renderice y verifique sus `data-slot` (`kpi-card`, `empty-state`, `section-header`, `row-actions`).

- [ ] **Step 2: Ejecutar el test para verificar que falla (RED)**

Run: `pnpm --filter @shac/ui test:run`
Expected: FAIL (`KpiCard is not exported from ../src/index.js`)

- [ ] **Step 3: Implementar `KpiCard.tsx`, `EmptyState.tsx` y `SectionHeader.tsx` (incluyendo `RowActions`) y exportarlos en `packages/ui/src/index.ts`**

Portar desde `../base/open-mercato/packages/ui/src/backend/charts/KpiCard.tsx`, `primitives/empty-state.tsx`, `SectionHeader.tsx` y `RowActions.tsx` eliminando `"use client"` y `useT`, usando tokens Tailwind v4 de `@shac/ui` (`bg-card`, `text-ok`, `text-danger`, `border-border`) y manteniendo cada archivo `< 160` líneas.

- [ ] **Step 4: Ejecutar pruebas y typecheck para verificar que pasa (GREEN)**

Run: `pnpm --filter @shac/ui test:run && pnpm --filter @shac/ui typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/KpiCard.tsx packages/ui/src/components/EmptyState.tsx packages/ui/src/components/SectionHeader.tsx packages/ui/src/index.ts packages/ui/test/ui.smoke.test.tsx
git commit -m "feat(ui): port KpiCard, EmptyState, SectionHeader, and RowActions from open-mercato"
```

---

### Task 2: Portar `FilterBar` y `DataTable` de `@open-mercato/ui` a `@shac/ui`

**Files:**
- Create: `packages/ui/src/components/FilterBar.tsx`
- Create: `packages/ui/src/components/DataTable.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/test/ui.smoke.test.tsx`

**Interfaces:**
- Consumes: `EmptyState`, `RowActions`, `RowActionItem` from Task 1
- Produces:
  - `export interface FilterChipOption { id: string; label: string; count?: number; }`
  - `export interface FilterBarProps { searchValue: string; onSearchChange: (value: string) => void; searchPlaceholder?: string; chips?: FilterChipOption[]; activeChipId?: string; onSelectChip?: (id: string) => void; trailingItems?: ReactNode; className?: string; }`
  - `export function FilterBar(props: FilterBarProps): JSX.Element`
  - `export interface DataTableColumn<TRow> { id: string; header: string; cell: (row: TRow) => ReactNode; sortValue?: (row: TRow) => string | number; align?: 'left' | 'right'; className?: string; }`
  - `export interface DataTableProps<TRow> { columns: DataTableColumn<TRow>[]; data: TRow[]; getRowId: (row: TRow) => string; loading?: boolean; emptyTitle?: string; emptyDescription?: string; emptyActionLabel?: string; onEmptyAction?: () => void; onRowClick?: (row: TRow) => void; selectedRowId?: string | null; rowActions?: (row: TRow) => RowActionItem[]; className?: string; }`
  - `export function DataTable<TRow>(props: DataTableProps<TRow>): JSX.Element`

- [ ] **Step 1: Escribir el test fallido en `packages/ui/test/ui.smoke.test.tsx` para `FilterBar` y `DataTable`**

Agregar un test que renderice `FilterBar` (con búsqueda + chips de filtro) y `DataTable` (con 2 filas, ordenamiento por columna al hacer clic en un header con `sortValue`, selección de fila con `onRowClick` y estado vacío con `data={[]}` mostrando `EmptyState`).

- [ ] **Step 2: Ejecutar el test para verificar que falla (RED)**

Run: `pnpm --filter @shac/ui test:run`
Expected: FAIL (`DataTable is not exported`)

- [ ] **Step 3: Implementar `FilterBar.tsx` y `DataTable.tsx` (`< 240` líneas cada uno) y exportarlos en `packages/ui/src/index.ts`**

Portar la estructura visual de `FilterBar` y `DataTable` de `@open-mercato/ui` sin `next/navigation`, con soporte para ordenamiento ascendente/descendente (`sortValue`), fila activa resaltada (`selectedRowId`), columna opcional de `RowActions`, esqueletos de carga y `EmptyState` integrado.

- [ ] **Step 4: Ejecutar pruebas y typecheck para verificar que pasa (GREEN)**

Run: `pnpm --filter @shac/ui test:run && pnpm --filter @shac/ui typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/FilterBar.tsx packages/ui/src/components/DataTable.tsx packages/ui/src/index.ts packages/ui/test/ui.smoke.test.tsx
git commit -m "feat(ui): port FilterBar and sortable DataTable from open-mercato"
```

---

### Task 3: Comando `customers.deals.list` (`GET /api/customers/deals`) + Auto-Bootstrap de Pipeline en `@shac/mod-customers` y `@shac/node-worker`

**Files:**
- Create: `packages/modules/customers/src/commands/deals-list.ts`
- Modify: `packages/modules/customers/src/commands/deals-create.ts:90-140`
- Modify: `packages/modules/customers/src/index.ts`
- Modify: `apps/node-worker/src/router.ts:90-112`
- Test: `apps/node-worker/test/phase2.worker.test.ts`

*(Nota: Para cumplir el límite de 3 archivos de implementación por paso, primero se implementan y verifican `deals-list.ts`, `deals-create.ts` e `index.ts` en `@shac/mod-customers`, y en el paso siguiente se conecta `router.ts` en `@shac/node-worker`.)*

**Interfaces:**
- Produces:
  - `export const customersDealsListCommand: CommandSpec<...>` (`GET /api/customers/deals`, permission `'customers.deals.read'`, query `{ partyId?: string; outcome?: 'open' | 'won' | 'lost'; limit?: number }`, output `{ items: Array<{ id, tenantId, orgId, pipelineId, stageId, partyId, partyName, title, valueMinor, currency, probabilityBps, expectedCloseDate, outcome, createdAt }>, summary: { totalCount: number; openValueMinor: number; wonValueMinor: number; weightedValueMinor: number } }`)

- [ ] **Step 1: Escribir el test fallido en `apps/node-worker/test/phase2.worker.test.ts` para `GET /api/customers/deals` y auto-creación de pipeline `pipe_default`**

Agregar aserciones en `apps/node-worker/test/phase2.worker.test.ts` verificando:
1. Crear un deal con `pipelineId: 'pipe_default'` y `stageId: 'stage_qualified'` sin haber insertado antes la fila en `crm_pipelines_and_stages` responde `200 OK`.
2. `GET /api/customers/deals` devuelve el deal con `partyName`, `summary.openValueMinor` y `summary.weightedValueMinor` ejecutando `<= 2` sentencias D1 (`db.batch()`).
3. Otro tenant (`tokenTen2`) recibe `0` deals de `ten_1`.

- [ ] **Step 2: Ejecutar el test para verificar que falla (RED)**

Run: `pnpm --filter @shac/node-worker exec vitest run test/phase2.worker.test.ts`
Expected: FAIL (`404` en `GET /api/customers/deals` o `PIPELINE_NOT_FOUND` con `pipe_default`)

- [ ] **Step 3: Implementar `deals-list.ts`, actualizar `deals-create.ts` + `index.ts` en `@shac/mod-customers` y montar `GET /api/customers/deals` en `apps/node-worker/src/router.ts`**

1. En `deals-create.ts`: si `pipelineRows.length === 0` y `input.pipelineId === 'pipe_default'`, insertar de forma idempotente `pipe_default` en `crm_pipelines_and_stages` para `(ctx.tenantId, targetOrgId)` antes de insertar el deal.
2. En `deals-list.ts` (`< 150` líneas): consultar con `ctx.db.batch([itemsQuery, allDealsAggQuery])` (`<= 2` queries D1) uniendo `crmDeals` con `crmParties` (alias explícito `party_display_name` para evitar colisión de columnas en D1 `batch()`) y calcular `openValueMinor`, `wonValueMinor` y `weightedValueMinor` en `BigInt` (`(BigInt(valueMinor) * BigInt(probabilityBps)) / 10_000n`).
3. Registrar `customersDealsListCommand` en `packages/modules/customers/src/index.ts` y `.get('/api/customers/deals', queryCommandHandler(customersDealsListCommand, profileLoader))` en `apps/node-worker/src/router.ts`.

- [ ] **Step 4: Ejecutar el test en `workerd` para verificar que pasa (GREEN)**

Run: `pnpm --filter @shac/node-worker exec vitest run test/phase2.worker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/customers/src/commands/deals-list.ts packages/modules/customers/src/commands/deals-create.ts packages/modules/customers/src/index.ts apps/node-worker/src/router.ts apps/node-worker/test/phase2.worker.test.ts
git commit -m "feat(customers): add GET /api/customers/deals with KPI summary and default pipeline bootstrap"
```

---

### Task 4: Reconstruir `/parties` como Suite CRM Completa estilo Open Mercato (`PartiesView.tsx` + `CrmDealsAndConflictsPanel.tsx`) y Desplegar

**Files:**
- Create: `apps/web-spa/src/views/CrmDealsAndConflictsPanel.tsx`
- Modify: `apps/web-spa/src/views/PartiesView.tsx`
- Test: `apps/web-spa/test/spa.offline.test.ts`

**Interfaces:**
- Consumes:
  - `KpiCard`, `FilterBar`, `DataTable`, `SectionHeader`, `EmptyState`, `RowActions` from `@shac/ui` (Tasks 1 & 2)
  - `rpc.api.customers.parties`, `rpc.api.customers.deals`, `rpc.api.customers.links`, `rpc.api.customers['conflict-checks']` from `@shac/node-worker` (Task 3)

- [ ] **Step 1: Escribir el test en `apps/web-spa/test/spa.offline.test.ts` verificando las rutas RPC completas de CRM (`deals`, `links`, `conflict-checks`)**

Agregar aserción en `apps/web-spa/test/spa.offline.test.ts` comprobando `rpc.api.customers.deals.$url().toString()`, `rpc.api.customers.links.$url().toString()` y `rpc.api.customers['conflict-checks'].$url().toString()`.

- [ ] **Step 2: Ejecutar el test para verificar que pasa/falla según tipos**

Run: `pnpm --filter @shac/web-spa test:run`
Expected: PASS

- [ ] **Step 3: Implementar `CrmDealsAndConflictsPanel.tsx` (`<= 240` líneas) y reconstruir `PartiesView.tsx` (`<= 250` líneas)**

1. En `PartiesView.tsx`:
   - **Fila de 4 `KpiCard`s superiores** (estilo `DealsKpiStrip` de Open Mercato):
     1. Total de `{vocabulary.partyPlural}` activos.
     2. Oportunidades (`Deals`) Abiertas (`formatMinorUnits(openValueMinor, 'USD')`).
     3. Pipeline Ponderado (`formatMinorUnits(weightedValueMinor, 'USD')`).
     4. Crédito Comercial Total Asignado.
   - **Barra `FilterBar`** con buscador instantáneo (nombre, RIF/NIT, correo) + chips de filtro por rol (`Todos`, `customer`, `vendor`, `patient`, `guest`, `tenant_resident`, `legal_client`, `carrier`).
   - **Layout de 2 paneles**:
     - **Izquierda:** `DataTable` ordenable de `{vocabulary.partyPlural}` (con columnas Nombre/Razón Social, Roles con badges, ID Fiscal, Límite de Crédito y `RowActions` para `"Ver Ficha 360°"`, `"Crear Oportunidad (Deal)"` y `"Verificar Conflicto"`), más formulario colapsable/limpio con etiquetas para dar de alta o editar un registro en decimales humanos (`parseMajorToMinor`).
     - **Derecha:** `<CrmDealsAndConflictsPanel>` sincronizado con el cliente seleccionado.
2. En `CrmDealsAndConflictsPanel.tsx`:
   - Tres pestañas inspiradas en Open Mercato CRM:
     - **Tab 1 — Oportunidades (`Deals` & Pipeline):** Lista en `DataTable` las oportunidades abiertas/ganadas (`GET /api/customers/deals`) con etapa (`Calificación`, `Propuesta`, `Negociación`, `Cierre`), probabilidad `%` y valor en `USD`, más formulario etiquetado para crear un nuevo Deal (`POST /api/customers/deals` sobre `pipe_default`).
     - **Tab 2 — Relaciones (`Party Links`):** Permite vincular el cliente seleccionado con otro `Party` (`company_contact`, `parent_guardian`, `roommate_occupant`, `distributor_store`, etc. vía `POST /api/customers/links`).
     - **Tab 3 — Conflictos de Interés (`Conflict Checks`):** Ejecuta `POST /api/customers/conflict-checks` por nombre/RIF/expediente y muestra badge semántico `CLEAR` (`text-ok`) o `POTENTIAL_CONFLICT` (`text-danger`) con las contrapartes coincidentes.

- [ ] **Step 4: Ejecutar batería RDD completa (`test:run`, `typecheck`, `knip --strict`, `build`, `wrangler deploy`)**

Run:
```bash
pnpm --filter @shac/ui test:run
pnpm --filter @shac/web-spa test:run
pnpm -r typecheck
pnpm dlx knip --strict
pnpm --filter @shac/web-spa build
pnpm --filter @shac/node-worker exec wrangler deploy
```
Expected: Exit code `0` en todos los comandos y nueva versión desplegada en `https://shac-node-worker.pc911itservices.workers.dev`.

- [ ] **Step 5: Commit**

```bash
git add apps/web-spa/src/views/CrmDealsAndConflictsPanel.tsx apps/web-spa/src/views/PartiesView.tsx apps/web-spa/test/spa.offline.test.ts
git commit -m "feat(web-spa): rebuild CRM PartiesView with Open Mercato DataTable, KPI strip, Deals pipeline, and Conflict Checks"
```
