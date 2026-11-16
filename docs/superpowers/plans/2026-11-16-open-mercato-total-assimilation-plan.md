# Open Mercato Total Assimilation Plan (Parts A + B -> SuperHyperArchiCRM)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement each slice cleanly, keeping all files `<= 300` LOC, zero `next/*`, zero `forwardRef`, and verifying with `vitest`, `typecheck`, `knip --strict`, and `impeccable detect`.

**Goal:** Assimilate 100% of Open Mercato's remaining backend modules (`Part A`: IAM Admin, Audit Logs, Staff/HR/Timesheets/Projects, Categories/Variants/Promotions, Quotes/Printable Docs, Forms Builder, Visual Workflows, WMS Locations/ASNs, EUDR, Deals Map) and satellite packages (`Part B`: AI Assistant Drawer, Web Research, Payment Gateways, Messaging Channels, Carriers/Akeneo Sync, Webhooks) onto SuperHyperArchiCRM's Cloudflare Edge stack.

**Architecture:** Reuse SHAC's existing canonical D1 tables (`iam_*`, `hr_*`, `psa_*`, `cat_*`, `com_*`, `wms_*`, `doc_*`, `comm_*`, `auto_*`, `int_webhooks_and_sync_jobs`, `kernel_custom_records`, `kernel_action_logs`) — zero destructive SQL migrations. Group new endpoints cleanly under `@shac/mod-*` and `@shac/node-worker` routes, and render every screen in Open Mercato DS v3 (`@shac/ui` + `lucide-react`).

---

## Execution Slices

- [x] **Slice 1 — IAM Admin, API Keys, Audit Logs & Custom Records (`Part A`)**
  - Backend: `apps/node-worker/src/iam-admin-routes.ts` (`GET/POST /api/iam/users`, `GET /api/iam/api-keys`, `GET /api/system/audit-logs`, `GET/POST /api/system/custom-records`)
  - Frontend: `IamAdminView.tsx` (`/iam-admin`), `AuditLogsView.tsx` (`/audit-logs`)
- [x] **Slice 2 — Staff, Teams, Leave Requests, Timesheets & PSA Projects (`Part A`)**
  - Backend: `apps/node-worker/src/staff-routes.ts` (`GET/POST /api/staff/profiles`, `GET/POST /api/staff/timesheets`, `GET/POST /api/staff/projects`)
  - Frontend: `StaffHubView.tsx` (`/staff`), `ProjectsBoardView.tsx` (`/projects`)
- [x] **Slice 3 — Deep Catalog (Categories/Variants), Promotions/Coupons, Quotes & WMS Locations (`Part A`)**
  - Backend: `apps/node-worker/src/catalog-ext-routes.ts` (`GET/POST /api/catalog/categories`, `GET/POST /api/catalog/variants`, `GET/POST /api/catalog/promotions`, `GET/POST /api/pos/quotes`, `GET/POST /api/wms/locations`)
  - Frontend: `CatalogStructureView.tsx` (`/categories`), `PromotionsView.tsx` (`/promotions`), `QuotesView.tsx` (`/quotes`), `WmsLocationsView.tsx` (`/wms-locations`)
- [x] **Slice 4 — Forms Builder & Visual Workflows (`Part A`)**
  - Backend: `apps/node-worker/src/forms-workflows-routes.ts` (`GET/POST /api/automation/workflows`, `GET/POST /api/portal/forms`)
  - Frontend: `FormsBuilderView.tsx` (`/forms`), `WorkflowsVisualView.tsx` (`/workflows`)
- [x] **Slice 5 — Satellite Connectors (`Part B`: Gateways, Messaging, Carriers/PIM, Web Research, Webhooks), EUDR & AI Assistant Drawer**
  - Backend: `apps/node-worker/src/connectors-routes.ts` (`GET/POST /api/system/connectors`, `POST /api/automation/ai-chat`)
  - Frontend: `IntegrationsHubView.tsx` (`/integrations`), `EudrComplianceView.tsx` (`/eudr`), `AiAssistantDrawer.tsx` (wired into `ShacAppShell` / `main.tsx`)
- [x] **Slice 6 — Deals Map View, Navigation Wiring, Full RDD Verification & Live Cloudflare Deploy**
  - Update `DealsKanbanView.tsx` (add Map view), `nav.ts`, `main.tsx`
  - Run `pnpm -r typecheck`, `pnpm dlx knip --strict`, `pnpm -r test:run`, `impeccable detect --json`, `wrangler deploy --dry-run`
