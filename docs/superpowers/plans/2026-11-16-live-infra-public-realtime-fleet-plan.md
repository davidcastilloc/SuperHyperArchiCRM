# SHAC Live Infrastructure, Public Portals, Real-Time WebSockets, Hardware POS & Multi-Worker Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining 5 infrastructure, public-access, real-time, hardware-POS, and multi-worker deployment fronts of `SuperHyperArchiCRM` so that 100% of the platform operates end-to-end on Cloudflare's edge with real R2/AI/WebSocket/ESC-POS execution and full fleet deployment readiness.

**Architecture:**
1. **Edge Storage, AI & Signed Webhooks (`@shac/node-worker`):** Extend `WorkerEnv` with optional `MEDIA_BUCKET?: R2Bucket` and `AI?: { run(model: string, input: unknown): Promise<unknown> }` bindings (preserving 100% compatibility with existing Vitest runs when unbound), expose `PUT/GET /api/media/:key` (backed by R2 with D1 metadata fallback), upgrade `POST /api/automation/ai-chat` to invoke `@cf/meta/llama-3.1-8b-instruct` when `env.AI` is bound while enriching responses with live D1 telemetry, and add `POST /api/system/connectors/:id/dispatch` with Web Crypto `HMAC-SHA256` (`X-SHAC-Signature-256`) signing and D1 delivery counter updates.
2. **Public Unauthenticated Routes (`@shac/node-worker` + `@shac/web-spa`):** Mount `GET/POST /api/public/forms/:slug` and `GET/POST /api/public/quotes/:orderNumber` before the staff session middleware in `apps/node-worker/src/router.ts`, and render public standalone views at `/f/$slug` and `/quote/$token` in `apps/web-spa/src/main.tsx` without requiring staff login.
3. **Real-Time WebSocket Broadcast (`@shac/actor-branch` + `@shac/web-spa`) & Hardware POS / SVG Charts (`@shac/ui`):** Add WebSocket hibernation upgrade (`GET /ws`) and mutation broadcasts (`receiveLot`, `allocateFefo`, `checkoutPosSale`, `closePosShift`) inside `BranchInventoryDO`, expose `GET /ws/branch` on `@shac/node-worker`, connect `@shac/web-spa` via `useBranchRealtimeSync` to auto-invalidate TanStack Query caches across open tabs/registers, and add `TimeSeriesChart` + `ThermalReceiptModal` (ESC/POS 58mm/80mm byte encoder + WebSerial/print bridge) to `@shac/ui`.
4. **Control Plane & Federation Hub Production Deployment (`apps/control-plane`, `apps/federation-hub`):** Author production `wrangler.jsonc` files for `shac-control-plane` and `shac-federation-hub`, validate bundle compilation with `wrangler deploy --dry-run` across all 3 Workers, and provide exact live Cloudflare provisioning commands.

**Tech Stack:** Cloudflare Workers, Durable Objects (`SQLite` + WebSocket Hibernation), Cloudflare D1, KV, R2, Workers AI, Hono (`hc` RPC), React 19, Vite 6, TanStack Router, TanStack Query, Tailwind CSS v4, Lucide React, Vitest (`@cloudflare/vitest-pool-workers`), Knip.

## Global Constraints

- **Maximum 300 lines per `.ts` or `.tsx` file:** Every created or modified source file must stay strictly `<= 300` lines (`wc -l`).
- **Maximum 3 implementation files per step (plus `.test.ts`):** Keep each TDD cycle surgical and self-contained.
- **Zero Forbidden Imports or Anti-Patterns:** Zero `next/*` imports, zero `React.forwardRef`, zero Unicode/emoji icon stand-ins (`lucide-react` icons only), zero floating-point currency math (all monetary values in integer minor units `*_minor: number` + ISO 4217 currency code), and zero OS-specific absolute paths in repository files.
- **D1 Query Budget:** Every Worker HTTP handler must execute at most `<= 2` D1 round-trips (using `c.env.DB.batch([...])` when combining statements).
- **Hono RPC Inference:** Never annotate sub-router factory return types as `: Hono<HonoEnv>`; always let TypeScript infer chained `.get(...)` / `.post(...)` routes.
- **Bundle Size Ceiling:** `apps/node-worker` gzip bundle must remain `< 1024 KiB`.

## Review Focus

- Verify that `MEDIA_BUCKET` and `AI` are optional on `WorkerEnv` so all existing Vitest suites in `apps/node-worker/test/` pass without requiring live R2/AI bindings in `wrangler.test.jsonc`, while exercising both the bound and fallback paths in `apps/node-worker/test/media-webhooks-ai.worker.test.ts`.
- Verify that `/api/public/forms/:slug` and `/api/public/quotes/:orderNumber` do not leak cross-tenant records and require an explicit `tenantId` query parameter (defaulting to `ten_1` for public links) while enforcing strict Zod input validation.
- Verify that `BranchInventoryDO` WebSocket upgrade and broadcast calls never throw when zero WebSocket clients are connected.
- Verify that `pnpm -r typecheck`, `pnpm -r test`, `pnpm dlx knip --strict`, and `impeccable.cmd detect --json apps/web-spa/src packages/ui/src` all exit `0`.

---

## Task 1: Cloudflare R2 Media Storage, Workers AI & HMAC-SHA256 Webhook Dispatcher (`@shac/node-worker`)

**Files:**
- Modify: `apps/node-worker/src/command-registry.ts`
- Create: `apps/node-worker/src/media-and-webhooks-routes.ts`
- Modify: `apps/node-worker/src/forms-workflows-routes.ts`
- Modify: `apps/node-worker/src/router.ts`
- Create: `apps/node-worker/test/media-webhooks-ai.worker.test.ts`

- [ ] **Step 1: Write failing worker tests for R2 media upload/download, HMAC-SHA256 webhook dispatch, and Workers AI chat enrichment**

Create `apps/node-worker/test/media-webhooks-ai.worker.test.ts`:
```ts
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRouter } from '../src/router.js';
import { applyCoreD1Migrations } from './helpers/apply-migrations.js';

describe('Media R2/D1 storage, HMAC-SHA256 webhook dispatcher, and Workers AI fallback', () => {
  const app = createRouter();

  beforeAll(async () => {
    await applyCoreD1Migrations(env.DB);
  });

  it('stores and retrieves media assets via /api/media/:key and lists them by tenant', async () => {
    const putRes = await app.request(
      'http://localhost/api/media/coa-lot-2026-01.pdf?tenantId=ten_1&entityType=LOT&entityId=LOT-2026-01',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/pdf',
          'x-shac-staff-id': 'usr_admin',
        },
        body: 'PDF-COA-SAMPLE-BYTES',
      },
      env,
    );
    expect(putRes.status).toBe(201);
    const putBody = (await putRes.json()) as {
      ok: boolean;
      key: string;
      sizeBytes: number;
      storageBackend: 'R2' | 'D1_META';
    };
    expect(putBody.ok).toBe(true);
    expect(putBody.key).toBe('coa-lot-2026-01.pdf');
    expect(putBody.sizeBytes).toBe(20);

    const getRes = await app.request(
      'http://localhost/api/media/coa-lot-2026-01.pdf?tenantId=ten_1',
      { method: 'GET' },
      env,
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.text()).toBe('PDF-COA-SAMPLE-BYTES');
  });

  it('signs outbound webhook payloads with HMAC-SHA256 X-SHAC-Signature-256 and records delivery status', async () => {
    const createRes = await app.request(
      'http://localhost/api/system/connectors',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'ten_1',
          recordKind: 'WEBHOOK',
          name: 'ERP Order Hook',
          providerOrUrl: 'https://hooks.example.internal/shac',
          hmacSecretEnc: 'whsec_test_secret_key_2026',
          subscribedEvents: ['order.created', 'pos.checkout'],
        }),
      },
      env,
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const dispatchRes = await app.request(
      `http://localhost/api/system/connectors/${created.id}/dispatch`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'ten_1',
          eventType: 'order.created',
          payload: { orderId: 'ord_900', totalMinor: 125000 },
          dryRun: true,
        }),
      },
      env,
    );
    expect(dispatchRes.status).toBe(200);
    const dispatchBody = (await dispatchRes.json()) as {
      ok: boolean;
      signatureHeader: string;
      eventType: string;
      processedCount: number;
    };
    expect(dispatchBody.ok).toBe(true);
    expect(dispatchBody.signatureHeader).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(dispatchBody.processedCount).toBe(1);
  });

  it('invokes Workers AI binding when present on env.AI and falls back to D1 telemetry otherwise', async () => {
    const mockEnv = {
      ...env,
      AI: {
        async run(_model: string, _input: unknown) {
          return { response: 'Respuesta generada por Workers AI Llama 3.1 con telemetría D1.' };
        },
      },
    };
    const aiRes = await app.request(
      'http://localhost/api/automation/ai-chat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'ten_1',
          prompt: 'Resume las órdenes y reclamos activos',
        }),
      },
      mockEnv,
    );
    expect(aiRes.status).toBe(200);
    const aiBody = (await aiRes.json()) as {
      ok: boolean;
      engine: string;
      reply: string;
    };
    expect(aiBody.ok).toBe(true);
    expect(aiBody.engine).toBe('workers-ai:@cf/meta/llama-3.1-8b-instruct');
    expect(aiBody.reply).toContain('Workers AI Llama 3.1');
  });
});
```

- [ ] **Step 2: Run Vitest to confirm the new test fails (`404` on `/api/media/...` and `/api/system/connectors/:id/dispatch`)**

Run:
```bash
pnpm --filter @shac/node-worker test test/media-webhooks-ai.worker.test.ts
```
Expected: FAIL with `expected 404 to be 201`.

- [ ] **Step 3: Implement `MEDIA_BUCKET` & `AI` optional bindings on `WorkerEnv`, create `media-and-webhooks-routes.ts`, and upgrade `forms-workflows-routes.ts`**

1. In `apps/node-worker/src/command-registry.ts`, update `WorkerEnv`:
```ts
export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface WorkerEnv {
  DB: D1Database;
  BRANCH_DO: DurableObjectNamespace;
  CONFIG_KV: KVNamespace;
  SESSION_KV: KVNamespace;
  MEDIA_BUCKET?: R2Bucket;
  AI?: WorkersAiBinding;
}
```
2. Create `apps/node-worker/src/media-and-webhooks-routes.ts` (`<= 220` lines) implementing:
   - `GET /api/media` (lists media records from `sys_saved_views_and_dictionaries` where `record_kind = 'MEDIA_OBJECT'` for `tenantId`)
   - `PUT /api/media/:key` (stores binary/text body in `c.env.MEDIA_BUCKET?.put(...)` when R2 is bound AND persists metadata + inline small-payload preview in `sys_saved_views_and_dictionaries` with `record_kind = 'MEDIA_OBJECT'` so both R2 and local D1 test environments serve `GET /api/media/:key`)
   - `GET /api/media/:key` (reads from `c.env.MEDIA_BUCKET?.get(...)` first, falling back to `sys_saved_views_and_dictionaries.payload_json` in local/test mode)
   - `POST /api/system/connectors/:id/dispatch` (computes Web Crypto `HMAC-SHA256` signature `sha256=<hex>` using `hmac_secret_enc`, performs `fetch(provider_or_url)` when `dryRun !== true`, updates `processed_count` / `failed_count` / `last_run_at` in `int_webhooks_and_sync_jobs`, and returns `{ ok, signatureHeader, eventType, processedCount }`).
3. In `apps/node-worker/src/forms-workflows-routes.ts`, update `POST /api/automation/ai-chat` so that after fetching the D1 telemetry batch (`orders`, `deals`, `claims`, `lots`), if `c.env.AI` is defined, it calls `c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: [...] })` and returns `engine: 'workers-ai:@cf/meta/llama-3.1-8b-instruct'`, or `engine: 'd1-deterministic-copilot'` when `c.env.AI` is unbound.
4. Mount `.route('/api', createMediaAndWebhooksRoutes())` in `apps/node-worker/src/router.ts`.

- [ ] **Step 4: Run Vitest and typecheck to verify Task 1 passes**

Run:
```bash
pnpm --filter @shac/node-worker test test/media-webhooks-ai.worker.test.ts
pnpm --filter @shac/node-worker typecheck
```
Expected: PASS (`3/3` tests in `media-webhooks-ai.worker.test.ts`, `0` TypeScript errors).

---

## Task 2: Public Unauthenticated Routes (`/api/public/forms/:slug`, `/api/public/quotes/:orderNumber` & SPA `/f/$slug`, `/quote/$token`)

**Files:**
- Create: `apps/node-worker/src/public-portal-routes.ts`
- Modify: `apps/node-worker/src/router.ts`
- Create: `apps/web-spa/src/views/PublicFormAndQuoteView.tsx`
- Modify: `apps/web-spa/src/main.tsx`
- Modify: `apps/node-worker/test/media-webhooks-ai.worker.test.ts`

- [ ] **Step 1: Add failing tests for public form submission and public quote acceptance without staff headers**

Append to `apps/node-worker/test/media-webhooks-ai.worker.test.ts`:
```ts
  it('serves and submits public forms at /api/public/forms/:slug without staff session headers', async () => {
    await app.request(
      'http://localhost/api/automation/forms-workflows',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'ten_1',
          recordKind: 'PUBLIC_FORM',
          slug: 'registro-distribuidor-2026',
          title: 'Registro de Distribuidor Mayorista',
          status: 'ACTIVE',
          schemaOrSteps: [
            { name: 'companyName', label: 'Empresa', type: 'text', required: true },
            { name: 'taxId', label: 'RIF / NIT', type: 'text', required: true },
          ],
        }),
      },
      env,
    );

    const getFormRes = await app.request(
      'http://localhost/api/public/forms/registro-distribuidor-2026?tenantId=ten_1',
      { method: 'GET' },
      env,
    );
    expect(getFormRes.status).toBe(200);
    const formMeta = (await getFormRes.json()) as {
      slug: string;
      title: string;
    };
    expect(formMeta.title).toBe('Registro de Distribuidor Mayorista');

    const submitRes = await app.request(
      'http://localhost/api/public/forms/registro-distribuidor-2026',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'ten_1',
          answers: {
            companyName: 'Importadora Los Andes C.A.',
            taxId: 'J-40998877-1',
          },
        }),
      },
      env,
    );
    expect(submitRes.status).toBe(201);
    const submitBody = (await submitRes.json()) as {
      ok: boolean;
      submissionId: string;
      submissionsCount: number;
    };
    expect(submitBody.ok).toBe(true);
    expect(submitBody.submissionsCount).toBe(1);
  });

  it('retrieves and accepts public quotes at /api/public/quotes/:orderNumber without staff session', async () => {
    const createQuoteRes = await app.request(
      'http://localhost/api/catalog/quotes',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'ten_1',
          branchId: 'br_main',
          customerPartyId: 'pty_cust_1',
          currencyCode: 'USD',
          subtotalMinor: 85000,
          taxMinor: 13600,
          grandTotalMinor: 98600,
          notes: 'Cotización corporativa Q4',
        }),
      },
      env,
    );
    expect(createQuoteRes.status).toBe(201);
    const createdQuote = (await createQuoteRes.json()) as { orderNumber: string };

    const getQuoteRes = await app.request(
      `http://localhost/api/public/quotes/${createdQuote.orderNumber}?tenantId=ten_1`,
      { method: 'GET' },
      env,
    );
    expect(getQuoteRes.status).toBe(200);

    const acceptRes = await app.request(
      `http://localhost/api/public/quotes/${createdQuote.orderNumber}/decision`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'ten_1',
          decision: 'ACCEPTED',
          acceptedByName: 'María Fernanda Rojas',
          acceptedByEmail: 'mrojas@losandes.example',
        }),
      },
      env,
    );
    expect(acceptRes.status).toBe(200);
    const acceptBody = (await acceptRes.json()) as {
      ok: boolean;
      status: string;
    };
    expect(acceptBody.ok).toBe(true);
    expect(acceptBody.status).toBe('CONFIRMED');
  });
```

- [ ] **Step 2: Run Vitest to confirm the new public route tests fail (`404` / `401`)**

Run:
```bash
pnpm --filter @shac/node-worker test test/media-webhooks-ai.worker.test.ts
```
Expected: FAIL on `/api/public/forms/...` and `/api/public/quotes/...`.

- [ ] **Step 3: Implement `public-portal-routes.ts` in `@shac/node-worker` and `PublicFormAndQuoteView.tsx` in `@shac/web-spa`**

1. Create `apps/node-worker/src/public-portal-routes.ts` (`<= 210` lines) with:
   - `GET /public/forms/:slug` (fetches active `PUBLIC_FORM` by `tenant_id` and `slug` from `wf_forms_and_workflows`)
   - `POST /public/forms/:slug` (increments `submissions_count` in `wf_forms_and_workflows` and records submission payload in `sys_audit_logs` in a single `c.env.DB.batch([...])`)
   - `GET /public/quotes/:orderNumber` (fetches quote summary from `pos_orders` by `tenant_id` and `order_number`)
   - `POST /public/quotes/:orderNumber/decision` (updates `pos_orders.status` to `'CONFIRMED'` or `'CANCELLED'` and writes audit log entry in `c.env.DB.batch([...])`).
2. In `apps/node-worker/src/router.ts`:
   - Allow `/api/public/*` in the session middleware (alongside `/api/auth/` and `/api/pos/price-check`) so anonymous customers can access `/api/public/*` even when `ENFORCE_STAFF_SESSION=true`.
   - Mount `.route('/api', createPublicPortalRoutes())`.
3. Create `apps/web-spa/src/views/PublicFormAndQuoteView.tsx` (`<= 240` lines) exporting `PublicFormView` and `PublicQuoteView` with clean Open Mercato DS v3 cards, interactive form fields, and one-click quote approval/rejection buttons. Also add direct "Abrir enlace público" links in `FormsBuilderView.tsx` and `QuotesView.tsx` so operators can preview/share `/f/$slug` and `/quote/$orderNumber`.
4. Register `/f/$slug` and `/quote/$orderNumber` in `apps/web-spa/src/main.tsx` and bypass `<AuthPage />` when `pathname.startsWith('/f/') || pathname.startsWith('/quote/')`.

- [ ] **Step 4: Run Vitest and typecheck across `@shac/node-worker` and `@shac/web-spa`**

Run:
```bash
pnpm --filter @shac/node-worker test test/media-webhooks-ai.worker.test.ts
pnpm --filter @shac/web-spa typecheck
```
Expected: PASS (`5/5` tests in `media-webhooks-ai.worker.test.ts`, `0` TypeScript errors).

---

## Task 3: Real-Time WebSocket Hibernation (`/ws/branch`), Interactive SVG Charts & ESC/POS Thermal Receipt Bridge (`@shac/actor-branch`, `@shac/ui`, `@shac/web-spa`)

**Files:**
- Modify: `packages/actor-branch/src/index.ts`
- Modify: `packages/actor-branch/src/http-router.ts`
- Modify: `apps/node-worker/src/branch-routes.ts`
- Create: `packages/ui/src/components/TimeSeriesChart.tsx`
- Create: `packages/ui/src/components/ThermalReceiptModal.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/test/ui.smoke.test.tsx`
- Create: `apps/web-spa/src/lib/useBranchRealtimeSync.ts`
- Modify: `apps/web-spa/src/views/DashboardView.tsx`
- Modify: `apps/web-spa/src/views/PosView.tsx`

- [ ] **Step 1: Write failing tests in `packages/ui/test/ui.smoke.test.tsx` for `TimeSeriesChart` and `ThermalReceiptModal` (including ESC/POS byte encoding)**

Add test cases to `packages/ui/test/ui.smoke.test.tsx`:
```tsx
  it('renders TimeSeriesChart with SVG bars and accessible labels', () => {
    const html = renderToStaticMarkup(
      <TimeSeriesChart
        title="Ingresos por Canal (Últimos 7 días)"
        subtitle="Importes netos en USD"
        series={[
          { label: 'Lun', value: 1240, secondaryValue: 980 },
          { label: 'Mar', value: 1890, secondaryValue: 1120 },
          { label: 'Mié', value: 1560, secondaryValue: 1340 },
        ]}
        valuePrefix="$"
      />,
    );
    expect(html).toContain('Ingresos por Canal');
    expect(html).toContain('<svg');
    expect(html).toContain('Lun');
  });

  it('encodes ESC/POS receipt bytes and renders ThermalReceiptModal', () => {
    const bytes = encodeEscPosReceipt({
      storeName: 'SHAC Casa Matriz',
      orderNumber: 'POS-2026-0099',
      cashierName: 'Georgina',
      currencyCode: 'USD',
      lines: [{ title: 'Café Molido 500g', qty: 2, lineTotalMinor: 1500 }],
      grandTotalMinor: 1500,
      kickCashDrawer: true,
    });
    // ESC @ (0x1b, 0x40) initialization header + cash drawer pulse (0x1b, 0x70)
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
    expect(bytes.includes(0x70)).toBe(true);

    const html = renderToStaticMarkup(
      <ThermalReceiptModal
        open={true}
        onClose={() => {}}
        receipt={{
          storeName: 'SHAC Casa Matriz',
          orderNumber: 'POS-2026-0099',
          cashierName: 'Georgina',
          currencyCode: 'USD',
          lines: [{ title: 'Café Molido 500g', qty: 2, lineTotalMinor: 1500 }],
          grandTotalMinor: 1500,
        }}
      />,
    );
    expect(html).toContain('POS-2026-0099');
    expect(html).toContain('ESC/POS 80mm');
  });
```

- [ ] **Step 2: Run `@shac/ui` tests to confirm failure before implementation**

Run:
```bash
pnpm --filter @shac/ui test
```
Expected: FAIL (`TimeSeriesChart` and `ThermalReceiptModal` not exported from `@shac/ui`).

- [ ] **Step 3: Implement `TimeSeriesChart.tsx`, `ThermalReceiptModal.tsx`, WebSocket broadcast in `BranchInventoryDO`, and wire into `DashboardView.tsx` & `PosView.tsx`**

1. Create `packages/ui/src/components/TimeSeriesChart.tsx` (`<= 140` lines):
   - Pure deterministic SVG bar + trendline chart with Open Mercato DS v3 styling, hover/focus tooltips, legend badges, and summary delta KPI pill.
2. Create `packages/ui/src/components/ThermalReceiptModal.tsx` (`<= 210` lines):
   - Exports `encodeEscPosReceipt(input: EscPosReceiptInput): Uint8Array` (generates standard ESC/POS `0x1B 0x40` init, centered header, itemized rows, bold grand total, paper cut `0x1D 0x56 0x41 0x10`, and optional RJ11 cash-drawer kick `0x1B 0x70 0x00 0x19 0xFA`) and `ThermalReceiptModal` (shows 80mm monospace thermal preview, browser `window.print()`, WebSerial USB/COM direct send via `navigator.serial`, and `.bin` ESC/POS download).
3. Export `TimeSeriesChart`, `ThermalReceiptModal`, `encodeEscPosReceipt`, and their prop types from `packages/ui/src/index.ts`.
4. In `packages/actor-branch/src/index.ts` and `packages/actor-branch/src/http-router.ts`:
   - Add `broadcastBranchEvent(eventType: string, summary: Record<string, unknown>): void` on `BranchInventoryDO` using `this.ctx.getWebSockets()` to broadcast JSON invalidation frames after `receiveLot`, `allocateFefo`, `checkoutPosSale`, and `closePosShift`.
   - Handle `GET /ws` with `Upgrade: websocket` in `handleBranchHttpRequest` via `new WebSocketPair()` and `actor.acceptBranchWebSocket(server)`.
   - Add `GET /api/branch/:branchId/ws` in `apps/node-worker/src/branch-routes.ts` forwarding the WebSocket upgrade to `BranchInventoryDO`.
5. Create `apps/web-spa/src/lib/useBranchRealtimeSync.ts` (`<= 85` lines) connecting to `/api/branch/${branchId}/ws` (when running in a browser with `WebSocket`) and invalidating `['branch-balances']`, `['pos-orders']`, and `['dashboard-summary']` on incoming mutation events, and wire `TimeSeriesChart` into `DashboardView.tsx` and `ThermalReceiptModal` into `PosView.tsx`.

- [ ] **Step 4: Run tests across `@shac/ui`, `@shac/actor-branch`, and `@shac/node-worker`**

Run:
```bash
pnpm --filter @shac/ui test
pnpm --filter @shac/actor-branch test
pnpm --filter @shac/node-worker test
```
Expected: PASS on all test suites.

---

## Task 4: Control Plane & Federation Hub Production `wrangler.jsonc`, Full Fleet Verification & Live Deployment

**Files:**
- Create: `apps/control-plane/wrangler.jsonc`
- Create: `apps/federation-hub/wrangler.jsonc`
- Modify: `apps/node-worker/wrangler.jsonc`

- [ ] **Step 1: Create production `wrangler.jsonc` configs for `apps/control-plane` and `apps/federation-hub`, and enable Workers AI binding in `apps/node-worker/wrangler.jsonc`**

1. Create `apps/control-plane/wrangler.jsonc`:
```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "shac-control-plane",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-01",
  "d1_databases": [
    {
      "binding": "CP_DB",
      "database_name": "shac-primary",
      "database_id": "2c8ba29f-dc38-4cb5-ab43-f96efaa9d54d",
      "migrations_dir": "migrations"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "CP_KV",
      "id": "e46b3e96126f41dcaf96b67ff2f5a98b"
    }
  ]
}
```
2. Create `apps/federation-hub/wrangler.jsonc`:
```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "shac-federation-hub",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-01",
  "d1_databases": [
    {
      "binding": "HUB_DB",
      "database_name": "shac-primary",
      "database_id": "2c8ba29f-dc38-4cb5-ab43-f96efaa9d54d",
      "migrations_dir": "migrations"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "HUB_KV",
      "id": "e46b3e96126f41dcaf96b67ff2f5a98b"
    }
  ]
}
```
3. Add `"ai": { "binding": "AI" }` to `apps/node-worker/wrangler.jsonc`.

- [ ] **Step 2: Run dry-run bundle verification across all 3 Cloudflare Workers (`node-worker`, `control-plane`, `federation-hub`)**

Run:
```bash
pnpm --filter @shac/web-spa build
pnpm --filter @shac/node-worker exec wrangler deploy --dry-run
pnpm --filter @shac/control-plane exec wrangler deploy --dry-run
pnpm --filter @shac/federation-hub exec wrangler deploy --dry-run
```
Expected: All 3 Workers compile cleanly (`exit code 0`), with `shac-node-worker` gzip bundle `< 1024 KiB`.

- [ ] **Step 3: Run full monorepo verification gates (`typecheck`, `test`, `knip`, `impeccable`, line-count guard)**

Run:
```bash
pnpm -r typecheck
pnpm -r test
pnpm dlx knip --strict
impeccable.cmd detect --json apps/web-spa/src packages/ui/src
```
Expected:
- `pnpm -r typecheck` -> `24/24` packages `exit code 0`
- `pnpm -r test` -> all package and worker test suites `exit code 0`
- `pnpm dlx knip --strict` -> `exit code 0`
- `impeccable.cmd detect --json apps/web-spa/src packages/ui/src` -> `[]`

- [ ] **Step 4: Deploy all 3 Workers (`shac-node-worker`, `shac-control-plane`, `shac-federation-hub`) to Cloudflare**

Run:
```bash
pnpm --filter @shac/control-plane exec wrangler d1 migrations apply shac-primary --remote
pnpm --filter @shac/federation-hub exec wrangler d1 migrations apply shac-primary --remote
pnpm --filter @shac/node-worker exec wrangler deploy
pnpm --filter @shac/control-plane exec wrangler deploy
pnpm --filter @shac/federation-hub exec wrangler deploy
```
Expected: Live URLs returned for `shac-node-worker`, `shac-control-plane`, and `shac-federation-hub` with `HTTP 200` health/smoke checks.
