# Open Mercato Complete Inventory & Full SHAC Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port 100% of Open Mercato's functional and UI surface (`@open-mercato/ui` chrome + `sales`, `customers`, `warranty_claims`, `custom-fields`, and remaining operational screens) onto SuperHyperArchiCRM's Cloudflare Edge architecture (`D1` + `BranchInventoryDO` + `CONFIG_KV` + React 19 SPA).

**Architecture:** Map every module in `base/open-mercato/packages/core/src/modules` and primitive in `base/open-mercato/packages/ui/src/backend` onto SHAC's existing canonical D1 schema (`0001..0006` migrations — zero destructive DDL), exposing typed `CommandSpec` endpoints (`<= 2` D1 queries via `db.batch()`, strict `tenantId` + `orgPath` isolation, MCP v2 metadata) and React 19 + TanStack Router/Query views (`<= 300` LOC per file).

**Tech Stack:** Cloudflare Workers (`Hono` RPC), Drizzle ORM (`D1`), Durable Objects (`BranchInventoryDO`), React 19, Vite, Tailwind v4 (`oklch` Open Mercato DS v3 tokens), `lucide-react`, Vitest 4.1+.

**Spec:** `SPEC.md`, `DATA_MODEL.md`, `DESIGN.md`

---

## Complete Inventory: `base/open-mercato` (47 Modules + 30 UI Primitives) -> `@shac/*`

### A. Core Domain Modules Mapping (`packages/core/src/modules/*`)

| Open Mercato Module(s) | Canonical SHAC Target (`@shac/*` + D1 Tables) | Status Before Plan | Action in This Plan |
| :--- | :--- | :--- | :--- |
| `auth`, `api_keys`, `directory`, `staff` | `@shac/mod-iam` (`iam_users`, `iam_organizations`, `iam_api_keys`, `SESSION_KV`) | Ready | Keep + expose quick navigation in `CommandPalette` |
| `configs`, `feature_toggles`, `perspectives`, `widgets`, `dashboards` | `system-routes.ts` (`CONFIG_KV` `0 ms` App Store) + `DashboardView` + `SavedViewsSelect` | Partial | Upgrade `AppStoreView` to DS v3 + add `SavedViewsSelect` & real Customer Tasks widget on `DashboardView` |
| `customers`, `customer_accounts`, `customer_groups`, `phone_calls`, `planner` | `@shac/mod-customers` (`crm_parties`, `crm_party_links`, `crm_deals`, `crm_interactions_and_tasks`, `crm_conflict_checks`) | Partial (Parties + Deals table) | Add `GET/POST /api/customers/interactions` + `POST /api/customers/deals/stage` + `DealsKanbanView` (`/deals`) + `CustomerTasksView` (`/tasks`) + Activity/Roles in `PartiesView` |
| `catalog`, `currencies`, `dictionaries`, `promotions` | `@shac/mod-catalog` (`cat_products`, `cat_exchange_rates`, 5-layer pricing engine) | Ready | Keep + connect CSV export & `SavedViewsSelect` |
| `sales`, `cart`, `ecommerce`, `payment_gateways` | `@shac/mod-pos` (`com_orders`, `com_order_lines`, `com_payments`, `com_returns_and_credit_memos`) | Partial (POS checkout + SmartCheck) | Add `GET /api/pos/orders` (`<= 2` D1 queries) + `SalesOrdersView` (`/orders` with Quotes/Orders/Fulfilled views, line-item detail & CSV export) |
| `wms`, `shipping_carriers`, `eudr` | `@shac/mod-wms` + `@shac/actor-branch` (`wms_pickings`, FEFO lots, GS1-128, e-POD) | Ready | Keep + link from `CommandPalette` |
| `resources`, `availability` | `@shac/mod-spaces` + `@shac/mod-leases` (`spc_units`, `spc_bookings`, `lse_leases`) | Backend ready, UI legacy | Upgrade `SpacesView` and `LeasesView` to Open Mercato DS v3 (`PageHeader`, `KpiCard`, `DataTable`, `StatusBadge`) |
| `warranty_claims`, `progress` | `@shac/mod-services` (`srv_warranty_claims_rma`, `srv_work_orders`, `evv_field_visits`) | Backend write-only, no UI | Add `GET /api/services/claims` & `GET /api/services/work-orders` + `ClaimsAndServicesView` (`/claims` with 5-step claim timeline) |
| `entities`, `forms` | `custom-fields-routes.ts` (`kernel_custom_field_defs`, `v_cf_*` virtual columns) | Schema ready, no API/UI | Add `GET/POST /api/system/custom-fields` + `CustomFieldsView` (`/custom-fields`) |
| `portal`, `messages`, `attachments`, `communication_channels` | `@shac/mod-portal` (`doc_attachments`, `msg_threads_and_messages` with `is_confidential = 0`) | Ready | Keep DS v3 `PortalView` |
| `workflows`, `business_rules`, `inbox_ops`, `notifications`, `push_notifications` | `@shac/mod-automation` (`aut_rules`, `aut_proposals`) + `@shac/ui` `NotificationCenter` | Partial | Upgrade `AutomationView` to DS v3 + add `NotificationCenter` bell popover in `ShacAppShell` |
| `devices`, `data_sync`, `sync_excel`, `integrations`, `api_docs`, `audit_logs`, `translations`, `design_system`, `seeds`, `query_index` | `@shac/mod-physical`, `@shac/mod-cases`, `@shac/mod-finance`, `/mcp`, offline IndexedDB queue, CSV export | Backend ready, UI legacy on 4 views | Upgrade `CasesView`, `FinanceView`, `PhysicalView` to Open Mercato DS v3 + add CSV export utility |

### B. `@open-mercato/ui` Backend Chrome Mapping (`packages/ui/src/backend/*`)

| Open Mercato UI Primitive | `@shac/ui` Target | Action |
| :--- | :--- | :--- |
| `AppShell.tsx`, `CollapsibleNavSection.tsx`, `Page.tsx` | `ShacAppShell.tsx`, `ShacSidebar.tsx`, `PageHeader` | Completed in Corte 1; wire `⌘K` palette & `Bell` notification center |
| `DataTable.tsx`, `FilterBar.tsx`, `RowActions.tsx`, `EmptyState.tsx`, `SectionHeader.tsx` | `DataTable.tsx`, `FilterBar.tsx`, `SectionHeader.tsx`, `EmptyState.tsx` | Completed in Corte 1; add `SavedViewsBar` (`Views: All views` + CSV export) |
| `command-palette` (`AI ⌘K` search), `notifications` (`FlashMessages`), `FilterOverlay` / `PerspectiveSidebar` | `CommandPalette.tsx`, `SavedViewsBar.tsx` | Create in `@shac/ui` with keyboard shortcuts (`Ctrl+K`/`⌘K`, `Escape`) |
| `custom-fields` (`CrudForm` dynamic definitions) | `CustomFieldsView.tsx` | Create in `@shac/web-spa` backed by `kernel_custom_field_defs` |

---

## Global Constraints

- Max **300 lines** per `.ts` or `.tsx` file; max **3 implementation files** per step + `.test.ts`.
- Zero `next/*` imports, zero `React.forwardRef`, zero Unicode/emoji icon stand-ins, zero floating-point currency math, zero OS-specific paths.
- Every D1 list endpoint must execute in **`<= 2` SQL queries** via `db.batch()`, verified with `wrapD1WithCounter`, plus cross-tenant and `MODULE_NOT_ENABLED` (`403`) tests.
- Worker bundle must remain **`< 1024 KiB` gzip** (`wrangler deploy --dry-run`).

## Review Focus

1. Empty D1 tables (`com_orders`, `crm_interactions_and_tasks`, `srv_warranty_claims_rma`, `kernel_custom_field_defs`) must return `200` with `items: []` and zeroed integer summaries (`0`), never `NaN` or `500`.
2. Cross-tenant and out-of-subtree `orgId` queries on `/api/pos/orders`, `/api/customers/interactions`, `/api/services/claims`, and `/api/system/custom-fields` must return zero leaked rows or `403`/`404`.
3. `POST /api/customers/deals/stage` and `POST /api/customers/interactions` must enforce `clientMutationId` idempotency so retries return the cached result without duplicating history or tasks.
4. `POST /api/system/custom-fields` must validate `fieldKey` against `/^[a-z][a-z0-9_]{1,40}$/` via `buildVirtualColumnSql` when `isIndexed = true`, rejecting SQL injection attempts with `400 VALIDATION_ERROR`.
5. `CommandPalette` (`⌘K` / `Ctrl+K`) must close cleanly on `Escape` and route selection without trapping focus after navigation.

---

### Task 1: `@shac/ui` CommandPalette (`⌘K`), Notification Bell & SavedViews/Export Bar

**Files:**
- Create: `packages/ui/src/components/CommandPalette.tsx`
- Create: `packages/ui/src/components/SavedViewsBar.tsx`
- Modify: `packages/ui/src/components/ShacAppShell.tsx`, `packages/ui/src/index.ts`
- Test: `packages/ui/test/ui.smoke.test.tsx`

- [x] **Step 1:** Add failing tests in `packages/ui/test/ui.smoke.test.tsx` for `CommandPalette` (`Ctrl+K` / `⌘K` open, filter, select, `Escape`), `NotificationBell` popover in `ShacAppShell`, and `SavedViewsBar` (`onSelectView` + `exportRowsToCsv`).
- [x] **Step 2:** Implement `CommandPalette.tsx`, `SavedViewsBar.tsx` (with `NotificationBell` + `SavedViewsBar` + CSV serializer), wire into `ShacAppShell.tsx` (`<= 290` LOC), and export from `packages/ui/src/index.ts`.
- [x] **Step 3:** Run `pnpm --filter @shac/ui test:run` and `pnpm --filter @shac/ui typecheck` -> PASS, then commit.

---

### Task 2: Upgrade All 7 Remaining Views to Open Mercato DS v3

**Files:**
- Modify Batch 2A: `apps/web-spa/src/views/SpacesView.tsx`, `apps/web-spa/src/views/LeasesView.tsx`, `apps/web-spa/src/views/CasesView.tsx`
- Modify Batch 2B: `apps/web-spa/src/views/FinanceView.tsx`, `apps/web-spa/src/views/PhysicalView.tsx`, `apps/web-spa/src/views/AutomationView.tsx`, `apps/web-spa/src/views/AppStoreView.tsx`

- [x] **Step 1:** Upgrade Batch 2A (`SpacesView`, `LeasesView`, `CasesView`) to `PageHeader`, `KpiCard`, `DataTable`, `StatusBadge`, and `lucide-react` icons (`<= 280` LOC each).
- [x] **Step 2:** Upgrade Batch 2B (`FinanceView`, `PhysicalView`, `AutomationView`, `AppStoreView`) to Open Mercato DS v3 (`<= 280` LOC each).
- [x] **Step 3:** Run `pnpm --filter @shac/web-spa typecheck` and `pnpm --filter @shac/web-spa test:run` -> PASS, then commit.

---

### Task 3: Backend `GET /api/pos/orders` (`@shac/mod-pos`)

**Files:**
- Create: `packages/modules/pos/src/commands/pos-orders-list.ts`
- Modify: `packages/modules/pos/src/index.ts`, `apps/node-worker/src/pos-wms-registry.ts`
- Test: `packages/modules/pos/test/pos.commands.test.ts`

- [x] **Step 1:** Add failing tests in `packages/modules/pos/test/pos.commands.test.ts` verifying `posOrdersListCommand` returns checked-out orders + KPI summary in `<= 2` D1 queries (`wrapD1WithCounter`), enforces tenant isolation, and rejects disabled module with `403`.
- [x] **Step 2:** Implement `posOrdersListCommand` using `db.batch([rowsQuery, aggQuery])` on `com_orders` and wire `GET /orders` in `pos-wms-registry.ts`.
- [x] **Step 3:** Run `pnpm --filter @shac/mod-pos test:run` -> PASS, then commit.

---

### Task 4: Backend CRM Interactions/Tasks & Kanban Stage Transitions (`@shac/mod-customers`)

**Files:**
- Create: `packages/modules/customers/src/commands/interactions.ts`
- Create: `packages/modules/customers/src/commands/deals-stage.ts`
- Modify: `packages/modules/customers/src/index.ts`, `apps/node-worker/src/router.ts`
- Test: `packages/modules/customers/test/customers.commands.test.ts`

- [x] **Step 1:** Add failing tests for `customersInteractionsListCommand` (`<= 2` D1 queries), `customersInteractionsUpsertCommand` (idempotent via `clientMutationId`), and `customersDealsStageCommand` (stage & outcome update + history append).
- [x] **Step 2:** Implement `interactions.ts` and `deals-stage.ts`, export in `@shac/mod-customers`, and mount `/api/customers/interactions` (`GET`/`POST`) and `/api/customers/deals/stage` (`POST`) in `router.ts`.
- [x] **Step 3:** Run `pnpm --filter @shac/mod-customers test:run` -> PASS, then commit.

---

### Task 5: Backend Warranty Claims, Work Orders & Custom Fields (`@shac/mod-services` + `node-worker`)

**Files:**
- Create: `packages/modules/services/src/commands/services-lists.ts`
- Create: `apps/node-worker/src/custom-fields-routes.ts`
- Modify: `packages/modules/services/src/index.ts`, `apps/node-worker/src/phase7-registry.ts`, `apps/node-worker/src/router.ts`
- Test: `packages/modules/services/test/services.commands.test.ts`

- [x] **Step 1:** Add failing tests in `services.commands.test.ts` for `servicesClaimsListCommand` and `servicesWorkOrdersListCommand` (`<= 2` D1 queries, tenant isolation).
- [x] **Step 2:** Implement `services-lists.ts` (`GET /api/services/claims`, `GET /api/services/work-orders`) and `custom-fields-routes.ts` (`GET/POST /api/system/custom-fields` on `kernel_custom_field_defs` using `buildVirtualColumnSql` validation), and mount in `phase7-registry.ts` / `router.ts`.
- [x] **Step 3:** Run `pnpm --filter @shac/mod-services test:run` and `pnpm --filter @shac/node-worker typecheck` -> PASS, then commit.

---

### Task 6: New Open Mercato Frontend Views (`SalesOrdersView`, `DealsKanbanView`, `CustomerTasksView`, `ClaimsAndServicesView`, `CustomFieldsView`)

**Files:**
- Create: `apps/web-spa/src/views/SalesOrdersView.tsx`
- Create: `apps/web-spa/src/views/DealsKanbanView.tsx`
- Create: `apps/web-spa/src/views/CustomerTasksView.tsx`
- Create: `apps/web-spa/src/views/ClaimsAndServicesView.tsx`
- Create: `apps/web-spa/src/views/CustomFieldsView.tsx`
- Modify: `apps/web-spa/src/views/DashboardView.tsx`, `apps/web-spa/src/nav.ts`, `apps/web-spa/src/main.tsx`

- [x] **Step 1:** Build `SalesOrdersView.tsx` (`/orders`), `DealsKanbanView.tsx` (`/deals`), and `CustomerTasksView.tsx` (`/tasks`) + connect `DashboardView`'s 1st column to live Customer Tasks (`<= 280` LOC each).
- [x] **Step 2:** Build `ClaimsAndServicesView.tsx` (`/claims` with 5-step Open Mercato warranty timeline + RMA/WorkOrder forms) and `CustomFieldsView.tsx` (`/custom-fields` with live `v_cf_*` DDL preview & field creator), and register all 5 routes in `nav.ts` and `main.tsx` (`<= 280` LOC each).
- [x] **Step 3:** Run `pnpm -r typecheck`, `pnpm dlx knip --strict`, `impeccable.cmd detect --json`, `wrangler deploy --dry-run` (`< 1024 KiB` gzip), seed demo tasks/claims in remote `shac-primary`, deploy live, and verify `HTTP 200`.
