# SDD ledger — plan: docs/superpowers/plans/2026-11-16-omni-vertical-usability-remediation-master-plan.md

Branch: `feat/omni-vertical-usability-remediation` (cut from `main` @ `c781ee508`)

## Pre-flight Interface Scan
- Task 1 -> Task 7, Task 25: `AppStoreToggleSchema.presetMode ('merge' | 'replace')` and updated `EDITION_PRESETS` (`Huésped`, `Habitación`, `finance` in `hospitality-pms`, `services` in `retail-pos`/`distro-wms`) — consistent.
- Task 2 -> Task 6, Task 7: `GET /api/auth/bootstrap` (`needsSetup`, `hasProvisionedProfile`), `POST /api/auth/setup`, `POST /api/auth/switch-branch` — consistent.
- Task 3 -> Task 14: `GET/POST /api/wms/locations` (`wms_locations`), `GET/POST /api/wms/vehicles` (`wms_fleet_and_deliveries`) — consistent.
- Task 4 -> Task 5, Task 8, Task 13: `PosVirtualKeypad.replaceOnFirstInput`, `TimeSeriesChart.showTotalBadge`, `globals.css` tokens — consistent.
- Task 5, 5B -> Task 7: `ExternalPortalShell`, `ShacNavItem.allowedPresets`, `ShacAppShellProps.{branches,activeBranchId,onSwitchBranch,defaultCollapsedGroups}` — consistent.
- Task 10 -> Task 11: `buildPosCheckoutPayload`, `loadPersistedPosState`, `savePersistedPosState` — consistent.
- Task 24 -> Task 26: `CustomFieldsSection` (`targetEntity="cat_products"`) — consistent.
- Task 1: complete (tests: `pnpm --filter @shac/editions test:run` -> 8/8 passed, `pnpm -r typecheck` -> 0 errors)
- Task 2: complete (tests: `vitest run test/auth.routes.worker.test.ts test/worker.integration.test.ts` -> 9/9 passed, `typecheck` -> 0 errors)
- Task 3: complete (tests: `vitest run test/omni-verticals.worker.test.ts` -> 8/8 passed, `typecheck` -> 0 errors)
- Task 4: complete (tests: `pnpm --filter @shac/ui test:run` -> 11/11 passed, `typecheck` -> 0 errors)
- Task 5: complete (tests: `pnpm --filter @shac/ui test:run` -> 12/12 passed, `typecheck` -> 0 errors)
- Task 5B: complete (tests: `pnpm --filter @shac/ui test:run` -> 13/13 passed, `typecheck` -> 0 errors)
- Task 6: complete (tests: `pnpm --filter @shac/web-spa test:run` -> 13/13 passed, `typecheck` -> 0 errors)

- **Task 7:** complete (`feat(web-spa): wire MarketProfileProvider, lazy routes, ExternalPortalShell, and preset-filtered nav`) — 16/16 vitest, tsc 0 errors, vite build 96.13 kB gzip
- **Task 8:** complete (`feat(web-spa): load Plus Jakarta/JetBrains fonts, add Vite API proxy, and make DashboardView preset-aware`) — 17/17 vitest, tsc 0 errors
- **Task 9:** complete (`fix(portal,forms): normalize FormFieldSpec schema, resolve dynamic tenantId, and lock decided quotes`) — 5/5 worker tests, 2/2 SPA tests, monorepo typecheck 0 errors
- **Task 10:** complete (`fix(pos): wire discountBps/FX/accounts checkout payload, shift persistence, Z-report and real PIN auth`) — 20/20 SPA tests, tsc 0 errors
- **Task 11:** complete (`feat(pos,kiosk): implement 62/38 zero-scroll tactile POS, coupon/FTS5 search, and locked SmartCheck kiosk`) — 21/21 SPA tests, tsc 0 errors
- **Task 12:** complete (`fix(catalog,promos): replace raw cents/micros/bps inputs with labeled decimal controls and product categories`) — 23/23 SPA tests, tsc 0 errors
- **Task 13:** complete (`feat(sales,quotes): refine PosTenderModal keypad/methods and add B2B quote-to-order creation flow`) — 24/24 SPA tests, tsc 0 errors
- **Task 14:** complete (`feat(wms,fleet): add 360px tabbed WMS collector UI, FEFO LotBadge table, vehicle/bin selectors and canvas e-POD`) — 25/25 SPA tests, tsc 0 errors
- **Task 15:** complete (`feat(services): wire live RMA and work-order status transitions, decimal labor, and unit/POS links`) — 26/26 SPA tests, monorepo typecheck 0 errors
- **Task 16:** complete (`fix(clinical): remove pty_pat_1 hardcodes, add DRAFT SOAP review/sign, Lab form, and orgPath isolation`) — 9/9 worker tests, web-spa tsc 0 errors
- **Task 17:** complete (`fix(legal): detect display_name conflicts, wire real client/matter selectors, dockets form, and persistent timer`) — 10/10 worker tests, web-spa tsc 0 errors
- **Task 18:** complete (`feat(finance,staff): update COA balances on GL post, add AP vendor/due date, and enforce orgPath isolation`) — 14/14 worker tests, monorepo typecheck 0 errors
- **Task 19:** complete (`feat(finance-ui): add multi-line GlJournalBuilder, visible Trust/Escrow table, AP vendors, and decimal inputs`) — 27/27 SPA tests, tsc 0 errors
- **Task 20:** complete (`feat(psa,deals): add Deal creation and backward Kanban transitions, staff/project selectors, and decimal rates`) — 28/28 SPA tests, tsc 0 errors
- **Task 21:** complete (`feat(hospitality): add room creation, Quick Check-In/Out, folio charge/settle, and real housekeeping workflow`) — 11/11 worker tests, web-spa tsc 0 errors
- **Task 22:** complete (`feat(condo,portal): fix authenticated poll voting, add Split Rent lease builder, and wire live PortalView`) — 29/29 SPA tests, tsc 0 errors
- **Task 23:** complete (`feat(helios): add 56px Pulso 5s and Lockdown controls, preserve lock battery, and display QR/PIN pass modal`) — 30/30 SPA tests, 3/3 phase8 worker tests, monorepo typecheck 0 errors
- [x] **Task 24**: `custom-fields-routes.ts` live `v_cf_*` DDL + `PRAGMA table_xinfo` idempotency, `CustomFieldsSection.tsx`, `PartiesView.tsx` mount & Spanish labels (`c1ece84`).
- [x] **Task 25**: `demoScenarios.ts` real RPC `executeLiveScenarioStep` + 7 presets + 6 SOPs, `DemoAndSopCenterView.tsx` preset switching, `phase7-registry.ts` `GET /api/automation/proposals` + `AutomationView.tsx` 1-click proposal list.
- [x] **Task 26**: `CatalogView.tsx` `<CustomFieldsSection targetEntity="cat_products" />`, `IntegrationsHubView.tsx` pre-fill + confirmation, `WorkflowsVisualView.tsx` interactive step builder (`serializeWorkflowSteps`).
