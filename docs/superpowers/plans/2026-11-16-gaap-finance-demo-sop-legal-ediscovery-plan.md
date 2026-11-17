# SHAC Full GAAP Accounting, Demo/SOP Center & Legal e-Discovery/Ethics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assimilate the full **Block 2** (`CRMWarehouse-Stores`: Complete GAAP Accounting Suite with Trial Balance, General Ledger, AP Vendor Bills, Bank Reconciliation, Fixed Assets + Interactive Demo Scenario Runner, Persona Switcher & Printable SOP Cheat-Sheets) and **Block 3** (`lawyerplatform`: Legal e-Discovery with Bates Stamping & Privilege Tags, AI Briefs & Pleadings Generator, Case-Law Citations Validator, and Bar License Renewals / CLE Ethics Compliance Tracker) into `SuperHyperArchiCRM` with high-craft Open Mercato DS v3 `Operate`-mode UI/UX.

**Architecture:**
1. **Full GAAP Accounting Engine (`apps/node-worker/src/finance-gaap-routes.ts` + `FinanceView.tsx` + `FinanceApAndReconPanel.tsx`):**
   - Backed by the existing D1 tables `fin_chart_of_accounts_and_periods`, `fin_journal_entries`, `fin_ap_bills_and_expenses`, `fin_bank_reconciliations`, `fin_fixed_assets_and_budgets`, and `fin_trust_escrow_ledgers`.
   - `GET /api/finance/overview` executes a single `c.env.DB.batch([...])` returning the Chart of Accounts / Trial Balance (computing total debits vs. credits in integer minor units), General Ledger journal entries, AP vendor bills/expenses, bank reconciliations, and Trust/IOLTA ledgers.
   - `POST /api/finance/coa` upserts GL accounts in `fin_chart_of_accounts_and_periods`.
   - `POST /api/finance/ap-bills` records vendor bills/expenses in `fin_ap_bills_and_expenses` with integer `balance_due_minor = Math.max(0, totalMinor - paidMinor)`.
   - `POST /api/finance/reconciliations` records bank statement reconciliations in `fin_bank_reconciliations` computing integer `difference_minor = statementBalanceMinor - bookBalanceMinor` and setting status `'RECONCILED'` when `difference_minor === 0` or `'DISCREPANCY'` otherwise.
2. **Legal e-Discovery, AI Briefs, Citations & Ethics/CLE Compliance (`apps/node-worker/src/legal-ediscovery-routes.ts` + `LegalEdiscoveryAndEthicsPanel.tsx` + `LegalPracticeView.tsx`):**
   - Backed by `doc_collaborative_pages` (`folder_id IN ('ediscovery_hold', 'legal_brief', 'legal_citation', 'ethics_license')`) + `env.AI` (`@cf/meta/llama-3.1-8b-instruct`).
   - `GET /api/legal/ediscovery-ethics` lists all 4 collections in `1` D1 query with filtering by `folder_id`.
   - `POST /api/legal/ediscovery-hold` assigns a sequential/deterministic Bates stamp (`BATES-2026-xxxx`), privilege tag (`PRIVILEGED`, `RESPONSIVE`, `HOT_DOC`, `REDACTED`), custodian, and SHA-256 evidence fingerprint.
   - `POST /api/legal/ai-brief` generates a structured court brief/motion using Workers AI `@cf/meta/llama-3.1-8b-instruct` (with deterministic legal brief fallback when `env.AI` is unbound) and saves it to `doc_collaborative_pages`.
   - `POST /api/legal/citations-and-ethics` saves either a verified case-law citation (`BINDING` / `PERSUASIVE` + `GOOD_LAW` / `QUESTIONED`) or an attorney Bar License / CLE Ethics record (`barNumber`, `jurisdiction`, `cleCompletedHours`, `cleRequiredHours`, `expiresAt`).
3. **Interactive Demo Scenario Runner, Persona Switcher & Printable SOP Guides (`apps/web-spa/src/views/DemoAndSopCenterView.tsx` at `/demo-sop`):**
   - Ported and elevated from `CRMWarehouse-Stores/components/demo/demo-scenario-runner.tsx`, `persona-switcher.tsx`, and `guide/sop-guide-viewer.tsx` + `printable-cheat-sheet.tsx`.
   - **Persona Switcher:** 6 industry personas (*Retail & Farmacia POS*, *Clínica EHR & AI Scribe*, *Bufete Legal & e-Discovery*, *Hotelería PMS & Condominio*, *Bodega WMS & Flota ePOD*, *Garita Helios IoT*) with 1-click navigation and live module preset switching.
   - **Interactive Demo Scenario Runner:** Multi-step guided playbooks that execute real API mutations against D1/DO step-by-step with progress bars, audio chimes (`PosAudio`), execution logs, and deep links.
   - **Printable SOP & Keyboard Cheat-Sheets:** Print-ready operational procedures and shortcut matrices (`F1`–`F9`, `⌘K`, ESC/POS, FEFO, IOLTA).

**Tech Stack:** Cloudflare Workers, D1 (`DB.batch`), Workers AI (`@cf/meta/llama-3.1-8b-instruct`), Hono RPC, React 19, TanStack Router, TanStack Query, Tailwind CSS v4 (`oklch` Open Mercato DS v3 tokens), Lucide React, Vitest (`@cloudflare/vitest-plugin`), Knip.

## Global Constraints

- **Maximum 300 lines per `.ts` or `.tsx` file:** Every created or modified source file must stay strictly `<= 300` lines (`Get-Content ... | Measure-Object -Line`).
- **Maximum 3 implementation files per step (plus `.test.ts`)**.
- **Zero Forbidden Imports or Anti-Patterns:** Zero `next/*` imports, zero `React.forwardRef`, zero Unicode/emoji icon stand-ins (`lucide-react` icons only), zero floating-point money math (integer minor units `*_minor` only), and zero OS-specific paths in repository files.
- **D1 Query Budget (`<= 2` queries per request):** Use `c.env.DB.batch([...])` to combine multi-table reads/writes.
- **Hono RPC Inference:** Never annotate sub-router factory return types as `: Hono<HonoEnv>`.
- **UI/UX Craft Floor (`Operate` Mode):**
  - Use `PageHeader`, `AiCopilotBanner`, `KpiCard`, `SegmentedTabs`, `DataTable`, `StatusBadge`, and `EmptyState` across all new/upgraded screens.
  - All account codes, Bates stamps, bar numbers, journal totals, and reconciliation differences use `font-mono tabular-nums`.

## Review Focus

- Verify that `POST /api/finance/reconciliations` computes `difference_minor = statementBalanceMinor - bookBalanceMinor` in exact integers and marks status `'RECONCILED'` only when `difference_minor === 0`.
- Verify that `POST /api/finance/ap-bills` computes `balance_due_minor = Math.max(0, totalMinor - paidMinor)` in exact integers.
- Verify that `POST /api/legal/ai-brief` works both when `env.AI` is bound and when `env.AI` is `undefined` in local Vitest runs.
- Verify that every file stays `<= 300` lines and `pnpm -r typecheck`, `pnpm -r test:run`, and `pnpm dlx knip --strict` exit `0`.

---

## Task 1: Full GAAP Accounting Backend & Upgraded Multi-Tab `FinanceView` (`CRMWarehouse-Stores` Block 2A)

**Files:**
- Create: `apps/node-worker/src/finance-gaap-routes.ts`
- Modify: `apps/node-worker/src/router.ts`
- Modify: `apps/node-worker/test/omni-verticals.worker.test.ts`
- Create: `apps/web-spa/src/views/FinanceApAndReconPanel.tsx`
- Modify: `apps/web-spa/src/views/FinanceView.tsx`

- [ ] **Step 1: Append failing tests for GAAP Trial Balance (`coa`), AP Vendor Bills (`ap-bills`), Bank Reconciliation (`reconciliations`), and `GET /api/finance/overview` to `apps/node-worker/test/omni-verticals.worker.test.ts`**

Add test case to `apps/node-worker/test/omni-verticals.worker.test.ts`:
```ts
  it('manages GAAP Chart of Accounts, AP Vendor Bills, and Bank Reconciliations with exact integer balances', async () => {
    const testEnv = makeTestEnv();

    const coaRes = await workerApp.request(
      'http://localhost/api/finance/coa',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          accountCode: '1100-AR-TRADE',
          name: 'Cuentas por Cobrar Comerciales',
          classification: 'asset',
          normalBalance: 'debit',
          currentBalanceMinor: 450000,
        }),
      },
      testEnv,
    );
    expect(coaRes.status).toBe(201);

    const billRes = await workerApp.request(
      'http://localhost/api/finance/ap-bills',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          billOrExpenseNo: 'BILL-2026-088',
          category: 'INVENTORY_SUPPLY',
          totalMinor: 125000,
          paidMinor: 25000,
          currency: 'USD',
        }),
      },
      testEnv,
    );
    expect(billRes.status).toBe(201);
    const billBody = (await billRes.json()) as { balanceDueMinor: number; status: string };
    expect(billBody.balanceDueMinor).toBe(100000);
    expect(billBody.status).toBe('PARTIAL');

    const reconRes = await workerApp.request(
      'http://localhost/api/finance/reconciliations',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          financialAccountId: 'acc_usd_main',
          statementBalanceMinor: 890000,
          bookBalanceMinor: 890000,
        }),
      },
      testEnv,
    );
    expect(reconRes.status).toBe(201);
    const reconBody = (await reconRes.json()) as { differenceMinor: number; status: string };
    expect(reconBody.differenceMinor).toBe(0);
    expect(reconBody.status).toBe('RECONCILED');

    const ovRes = await workerApp.request(
      'http://localhost/api/finance/overview',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(ovRes.status).toBe(200);
    const ov = (await ovRes.json()) as {
      accounts: unknown[];
      apBills: unknown[];
      reconciliations: unknown[];
    };
    expect(ov.accounts.length).toBeGreaterThanOrEqual(1);
    expect(ov.apBills).toHaveLength(1);
    expect(ov.reconciliations).toHaveLength(1);
  });
```

- [ ] **Step 2: Run Vitest to confirm RED (`404` on `/api/finance/coa`)**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
```
Expected: FAIL (`expected 404 to be 201`).

- [ ] **Step 3: Implement `finance-gaap-routes.ts`, `FinanceApAndReconPanel.tsx`, and upgrade `FinanceView.tsx`**

1. Create `apps/node-worker/src/finance-gaap-routes.ts` (`<= 215` lines) implementing:
   - `GET /finance/overview` (`DB.batch` reading `fin_chart_of_accounts_and_periods`, `fin_journal_entries`, `fin_ap_bills_and_expenses`, `fin_bank_reconciliations`, and `fin_trust_escrow_ledgers`).
   - `POST /finance/coa` (upserts into `fin_chart_of_accounts_and_periods` on `CONFLICT(tenant_id, record_kind, account_code)`).
   - `POST /finance/ap-bills` (inserts into `fin_ap_bills_and_expenses` with `balance_due_minor = Math.max(0, totalMinor - paidMinor)` and `status = balance_due_minor === 0 ? 'PAID' : paidMinor > 0 ? 'PARTIAL' : 'OPEN'`).
   - `POST /finance/reconciliations` (inserts into `fin_bank_reconciliations` with `difference_minor = statementBalanceMinor - bookBalanceMinor` and `status = difference_minor === 0 ? 'RECONCILED' : 'DISCREPANCY'`).
   Mount `.route('/api', createFinanceGaapRoutes(profileLoader))` in `apps/node-worker/src/router.ts`.
2. Create `apps/web-spa/src/views/FinanceApAndReconPanel.tsx` (`<= 210` lines) rendering the **Balance de Comprobación (COA)**, **Cuentas por Pagar (AP Bills)**, and **Conciliación Bancaria** tabs with interactive creation forms and `DataTable`s.
3. Upgrade `apps/web-spa/src/views/FinanceView.tsx` (`<= 245` lines) with `AiCopilotBanner` ("CFO Copiloto IA"), 4 `KpiCard`s, and 5 `SegmentedTabs`: **Trust / IOLTA & Libro Diario**, **Balance de Comprobación (COA)**, **Libro Mayor (GL)**, **Cuentas por Pagar (AP Bills)**, and **Conciliación Bancaria**.

- [ ] **Step 4: Run Vitest and typecheck to verify Task 1 GREEN**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
pnpm --filter @shac/node-worker --filter @shac/web-spa typecheck
```
Expected: PASS (`6/6` tests in `omni-verticals.worker.test.ts`, `0` TypeScript errors).

---

## Task 2: Legal e-Discovery, AI Briefs Generator, Citations Validator & Bar License/CLE Ethics Tracker (`lawyerplatform` Block 3)

**Files:**
- Create: `apps/node-worker/src/legal-ediscovery-routes.ts`
- Modify: `apps/node-worker/src/router.ts`
- Modify: `apps/node-worker/test/omni-verticals.worker.test.ts`
- Create: `apps/web-spa/src/views/LegalEdiscoveryAndEthicsPanel.tsx`
- Modify: `apps/web-spa/src/views/LegalPracticeView.tsx`

- [ ] **Step 1: Append failing tests for Legal e-Discovery Bates Stamping, AI Brief Drafting, Citations Validation, and Attorney CLE/License Renewals to `apps/node-worker/test/omni-verticals.worker.test.ts`**

Add test case to `apps/node-worker/test/omni-verticals.worker.test.ts`:
```ts
  it('manages Legal e-Discovery Bates holds, AI briefs, citations, and attorney Bar/CLE ethics renewals', async () => {
    const testEnv = makeTestEnv();

    const holdRes = await workerApp.request(
      'http://localhost/api/legal/ediscovery-hold',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          matterId: 'EXP-2026-01',
          title: 'Correos Junta Directiva Q3',
          custodian: 'Carlos Mendoza (CFO)',
          privilegeTag: 'PRIVILEGED',
          snippetText: 'Acuerdo confidencial de precios y exclusividad territorial.',
        }),
      },
      testEnv,
    );
    expect(holdRes.status).toBe(201);
    const holdBody = (await holdRes.json()) as { batesNumber: string; sha256Hash: string };
    expect(holdBody.batesNumber).toMatch(/^BATES-2026-/);
    expect(holdBody.sha256Hash).toHaveLength(64);

    const briefRes = await workerApp.request(
      'http://localhost/api/legal/ai-brief',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          matterId: 'EXP-2026-01',
          title: 'Escrito de Medidas Cautelares',
          courtName: 'Juzgado Superior Mercantil',
          keyArguments: 'Fumus boni iuris y periculum in mora por incumplimiento de entrega.',
        }),
      },
      testEnv,
    );
    expect(briefRes.status).toBe(201);
    const briefBody = (await briefRes.json()) as { id: string; draftedBrief: string };
    expect(briefBody.draftedBrief).toContain('Juzgado Superior Mercantil');

    const ethRes = await workerApp.request(
      'http://localhost/api/legal/citations-and-ethics',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          recordKind: 'ethics_license',
          title: 'Dra. Elena Santander · Inpreabogado #94821',
          jurisdiction: 'Nacional / Sala Civil',
          statusTag: 'COMPLIANT',
          cleCompletedHours: 24,
          cleRequiredHours: 20,
        }),
      },
      testEnv,
    );
    expect(ethRes.status).toBe(201);

    const listRes = await workerApp.request(
      'http://localhost/api/legal/ediscovery-ethics',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      ediscoveryHolds: unknown[];
      briefs: unknown[];
      ethicsAndCitations: unknown[];
    };
    expect(listBody.ediscoveryHolds).toHaveLength(1);
    expect(listBody.briefs).toHaveLength(1);
    expect(listBody.ethicsAndCitations).toHaveLength(1);
  });
```

- [ ] **Step 2: Run Vitest to confirm RED (`404` on `/api/legal/ediscovery-hold`)**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
```
Expected: FAIL (`expected 404 to be 201`).

- [ ] **Step 3: Implement `legal-ediscovery-routes.ts`, `LegalEdiscoveryAndEthicsPanel.tsx`, and wire into `LegalPracticeView.tsx`**

1. Create `apps/node-worker/src/legal-ediscovery-routes.ts` (`<= 215` lines) using `doc_collaborative_pages` + `sha256Hex` + `c.env.AI` (`@cf/meta/llama-3.1-8b-instruct`), and mount `.route('/api', createLegalEdiscoveryRoutes(profileLoader))` in `apps/node-worker/src/router.ts`.
2. Create `apps/web-spa/src/views/LegalEdiscoveryAndEthicsPanel.tsx` (`<= 235` lines) rendering 3 specialized sub-views:
   - **e-Discovery & Evidencia Bates (`BATES-2026-xxxx`)** with privilege badges (`PRIVILEGED`, `HOT_DOC`, `RESPONSIVE`, `REDACTED`) and SHA-256 hash pill.
   - **Generador de Escritos (`Briefs`) con IA** with live court pleading preview.
   - **Citaciones, Licencias & Ética CLE** with progress bar of CLE credit hours and Bar compliance badges.
3. Add tabs `ediscovery`, `briefs`, and `ethics` to `apps/web-spa/src/views/LegalPracticeView.tsx` (`<= 260` lines).

- [ ] **Step 4: Run Vitest and typecheck to verify Task 2 GREEN**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
pnpm --filter @shac/node-worker --filter @shac/web-spa typecheck
```
Expected: PASS (`7/7` tests in `omni-verticals.worker.test.ts`, `0` TypeScript errors).

---

## Task 3: Interactive Demo Scenario Runner, Persona Switcher & Printable SOP Cheat-Sheets (`CRMWarehouse-Stores` Block 2B)

**Files:**
- Create: `apps/web-spa/src/lib/demoScenarios.ts`
- Create: `apps/web-spa/src/views/DemoAndSopCenterView.tsx`
- Modify: `apps/web-spa/test/pos.turbo.test.ts`

- [ ] **Step 1: Add failing unit tests for `DEMO_PERSONAS`, `DEMO_SCENARIOS`, and `SOP_CHEAT_SHEETS` in `apps/web-spa/test/pos.turbo.test.ts`**

Append to `apps/web-spa/test/pos.turbo.test.ts`:
```ts
  it('exposes 6 vertical demo personas, multi-step guided playbooks, and SOP cheat sheets', async () => {
    const { DEMO_PERSONAS, DEMO_SCENARIOS, SOP_CHEAT_SHEETS, advanceScenarioStep } = await import(
      '../src/lib/demoScenarios.js'
    );
    expect(DEMO_PERSONAS.length).toBeGreaterThanOrEqual(6);
    expect(DEMO_SCENARIOS.length).toBeGreaterThanOrEqual(4);
    expect(SOP_CHEAT_SHEETS.length).toBeGreaterThanOrEqual(4);

    const next = advanceScenarioStep({ currentStep: 0, logs: [] }, DEMO_SCENARIOS[0]!);
    expect(next.currentStep).toBe(1);
    expect(next.logs).toHaveLength(1);
  });
```

- [ ] **Step 2: Run `@shac/web-spa` Vitest to confirm RED**

Run:
```bash
pnpm --filter @shac/web-spa test:run test/pos.turbo.test.ts
```
Expected: FAIL (`Cannot find module '../src/lib/demoScenarios.js'`).

- [ ] **Step 3: Implement `demoScenarios.ts` and `DemoAndSopCenterView.tsx`**

1. Create `apps/web-spa/src/lib/demoScenarios.ts` (`<= 145` lines):
   - Exports `DEMO_PERSONAS` (6 industry roles with target route, active preset, and description), `DEMO_SCENARIOS` (4 end-to-end interactive playbooks: *1. Flujo Retail POS + FEFO + ePOD*, *2. Flujo Clínica EHR + AI Scribe + RCM*, *3. Flujo Bufete Legal + e-Discovery + IOLTA*, *4. Flujo Hotel PMS + Condominio + Garita Helios*), `SOP_CHEAT_SHEETS` (keyboard shortcuts + step-by-step operational SOP checklists), and `advanceScenarioStep`.
2. Create `apps/web-spa/src/views/DemoAndSopCenterView.tsx` (`<= 255` lines):
   - 3 `SegmentedTabs`: **Simulador de Escenarios en Vivo** (progress bar, step execution button triggering real API calls + `PosAudio.playPaymentSuccess()`, live log console, and "Ir a Pantalla" deep-link button), **Selector de Persona / Industria** (6 cards switching edition preset via `rpc.api.system['app-store'].toggle.$post` or navigating directly), and **Guías SOP & Atajos Imprimibles** (`window.print()`).

- [ ] **Step 4: Run `@shac/web-spa` tests and typecheck to verify Task 3 GREEN**

Run:
```bash
pnpm --filter @shac/web-spa test:run test/pos.turbo.test.ts
pnpm --filter @shac/web-spa typecheck
```
Expected: PASS (`5/5` tests in `pos.turbo.test.ts`, `0` TypeScript errors).

---

## Task 4: Wire `/demo-sop` into Navigation & Router, Full Monorepo Verification Gates & Live Cloudflare Deploy

**Files:**
- Modify: `apps/web-spa/src/nav.ts`
- Modify: `apps/web-spa/src/main.tsx`

- [ ] **Step 1: Register `/demo-sop` (`Demo Runner & Guías SOP`) in `apps/web-spa/src/nav.ts` and `apps/web-spa/src/main.tsx`**

Add `{ id: 'demo-sop', label: 'Simulador Demo & SOP', href: '/demo-sop', group: 'GENERAL', icon: navIcon(BookOpenCheck) }` in `nav.ts` and `['/demo-sop', () => <DemoAndSopCenterView vocabulary={voc} rpc={rpcClient} onNavigate={(href) => void navigate({ to: href })} />]` in `main.tsx`.

- [ ] **Step 2: Verify `<= 300` line limit across all created/modified files, `pnpm -r typecheck`, `pnpm dlx knip --strict`, `pnpm -r test:run`, and `pnpm --filter @shac/web-spa build`**

Run:
```bash
pnpm -r typecheck
pnpm dlx knip --strict
pnpm -r test:run
pnpm --filter @shac/web-spa build
```
Expected:
- All created/modified files strictly `<= 300` lines.
- `pnpm -r typecheck` -> `24/24` projects `exit code 0`.
- `pnpm dlx knip --strict` -> `exit code 0`.
- `pnpm -r test:run` -> all test suites `exit code 0`.

- [ ] **Step 3: Deploy `shac-node-worker` live to Cloudflare**

Run:
```bash
wrangler deploy -c apps/node-worker/wrangler.jsonc
```
Expected: Live deployment `< 1024 KiB` gzip with HTTP `200`.
