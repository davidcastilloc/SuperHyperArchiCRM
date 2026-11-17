# SHAC Omni-Vertical AI-Powered SuperCRM Assimilation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assimilate the remaining high-value domain capabilities from all 8 sibling repositories (`CRMWarehouse-Stores`, `GeorginaPOS`, `open-pos`, `Doctors-EHR-New`, `lawyerplatform`, `apartment-property-management`, `hotel-project-turpial`, and `helios`) into `SuperHyperArchiCRM`, delivering an AI-powered, multi-vertical SuperCRM with refined Open Mercato DS v3 `Operate`-mode UI/UX across Retail/WMS/Fleet, Clinical EHR, Legal Practice/IOLTA, Hospitality PMS/Housekeeping, Condo Resident Hub, and Helios Physical Security/Garita.

**Architecture:**
1. **Zero New D1 Migrations Required:** Leverage the existing 108 universal + vertical D1 tables already migrated in `shac-primary` (`wms_fleet_and_deliveries`, `wms_qc_and_cycle_counts`, `com_returns_and_credit_memos`, `med_encounters_and_vitals`, `med_clinical_notes`, `med_prescriptions_and_erx`, `med_labs_and_imaging`, `med_rcm_claims_and_era`, `leg_matters`, `leg_dockets_and_events`, `leg_time_entries`, `fin_trust_escrow_ledgers`, `spc_units`, `spc_bookings_and_appointments`, `spc_housekeeping_tasks`, `spc_folios`, `lease_applications`, `lease_contracts_and_renewals`, `condo_community_hub`, `phy_devices_and_locks`, `phy_access_passes`, `phy_smart_lockers`, `phy_lpr_plate_events`, `phy_media_clips`, `phy_tamper_alerts`).
2. **Domain-Contextual Workers AI (`env.AI`):** Every vertical cockpit embeds a domain-tuned AI workflow backed by `@cf/meta/llama-3.1-8b-instruct` (with deterministic D1 fallback when `env.AI` is unbound in local Vitest runs): Clinical **AI Scribe** (dictation to structured SOAP + ICD-10), Legal **AI Contract & Conflict Reviewer**, Hospitality/Condo **AI Occupancy & Community Copilot**, WMS **AI Cycle-Count & Fleet Optimizer**, and Helios **AI Security Anomaly Summarizer**.
3. **High-Craft `Operate` UI/UX (`@shac/ui`):** Introduce 3 shared primitives (`BarcodeSvg` deterministic Code-128B SVG renderer, `SegmentedTabs` with live counters and keyboard navigation, and `AiCopilotBanner` with 1-click domain prompt chips) so every vertical screen shares visual rhythm, scannability, `tabular-nums` alignment, semantic `StatusBadge` tones, and actionable `EmptyState`s.
4. **Fast Initial Load via Route Code-Splitting:** Configure Vite chunking/lazy boundaries in `@shac/web-spa` so adding vertical workspaces keeps initial JS load fast and eliminates chunk-size warnings.

**Tech Stack:** Cloudflare Workers, D1 (`DB.batch`), Durable Objects, Workers AI (`@cf/meta/llama-3.1-8b-instruct`), Hono RPC, React 19, TanStack Router, TanStack Query, Tailwind CSS v4 (`oklch` Open Mercato DS v3 tokens), Lucide React, Vitest (`@cloudflare/vitest-plugin`), Knip.

## Global Constraints

- **Maximum 300 lines per `.ts` or `.tsx` file:** Every created or modified source file must stay strictly `<= 300` lines. Split complex vertical workspaces into a focused container view + 1–2 sub-panels/modals.
- **Maximum 3 implementation files per step (plus `.test.ts`)**.
- **Zero Forbidden Imports or Anti-Patterns:** Zero `next/*` imports, zero `React.forwardRef`, zero Unicode/emoji icon stand-ins (`lucide-react` icons only), zero floating-point money math (integer minor units `*_minor` + basis points `*_bps` only), and zero OS-specific paths in repository files.
- **D1 Query Budget (`<= 2` queries per request):** Every `GET .../overview` or mutation endpoint in `apps/node-worker` must batch multiple reads/writes inside a single `c.env.DB.batch([...])` call.
- **Hono RPC Type Inference:** Never annotate sub-router factory return types as `: Hono<HonoEnv>`; let TypeScript infer chained `.get(...)` / `.post(...)` routes so `rpcClient` stays end-to-end typed.
- **UI/UX Craft Floor (`Operate` Mode):**
  - Every vertical view opens with `PageHeader` -> `AiCopilotBanner` (collapsible/1-click prompt pills) -> 3–4 `KpiCard` metrics -> `SegmentedTabs` -> clean `DataTable` or visual board (`Room Rack`, `Housekeeping Grid`, `Video Wall`, `Barcode Sheet`).
  - All identifiers, SKUs, barcodes, license plates, ICD-10 codes, vital signs, timers, and currency amounts use `font-mono tabular-nums`.
  - Every empty collection renders `<EmptyState />` with a concrete creation CTA; every interactive icon-only button includes `aria-label` and `title`.

## Review Focus

- Verify tenant isolation (`WHERE tenant_id = ?1 AND deleted_at IS NULL`) across every query in `wms-fleet-labels-routes.ts`, `clinical-ehr-routes.ts`, `legal-practice-routes.ts`, `hospitality-condo-routes.ts`, and `physical-helios-routes.ts`.
- Verify `c.env.DB.batch([...])` keeps every new endpoint within `<= 2` D1 round-trips.
- Verify AI endpoints (`ai-scribe`, `ai-contract-review`, `/api/automation/ai-chat`) succeed both when `env.AI` is mocked/bound and when `env.AI` is `undefined`.
- Verify `fin_trust_escrow_ledgers` never violates `CHECK (balance_minor >= 0)` on disbursements (returning `400 INSUFFICIENT_TRUST_FUNDS` cleanly before SQL error).
- Verify all files stay `<= 300` lines, `pnpm -r typecheck`, `pnpm -r test:run`, and `pnpm dlx knip --strict` exit `0`, and `shac-node-worker` gzip bundle stays `< 1024 KiB`.

---

## Task 1: Shared High-Craft UI Primitives (`BarcodeSvg`, `SegmentedTabs`, `AiCopilotBanner`) in `@shac/ui`

**Files:**
- Create: `packages/ui/src/components/BarcodeSvg.tsx`
- Create: `packages/ui/src/components/SegmentedTabs.tsx`
- Create: `packages/ui/src/components/AiCopilotBanner.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/test/ui.smoke.test.tsx`

- [ ] **Step 1: Write failing smoke tests in `packages/ui/test/ui.smoke.test.tsx` for `BarcodeSvg`, `SegmentedTabs`, and `AiCopilotBanner`**

Append to `packages/ui/test/ui.smoke.test.tsx`:
```tsx
  it('renders deterministic Code-128B BarcodeSvg, SegmentedTabs with counts, and AiCopilotBanner prompt chips', async () => {
    const { BarcodeSvg, SegmentedTabs, AiCopilotBanner } = await import('../src/index.js');
    const onSelectTab = vi.fn();
    const onRunPrompt = vi.fn();

    render(
      <div>
        <BarcodeSvg value="AMOX-500" label="Amoxicilina 500mg" priceLabel="$12.50 · Bs 684.38" />
        <SegmentedTabs
          activeId="vitals"
          onSelect={onSelectTab}
          tabs={[
            { id: 'vitals', label: 'Signos Vitales', count: 4 },
            { id: 'soap', label: 'Notas SOAP', count: 12 },
          ]}
        />
        <AiCopilotBanner
          title="Copiloto Clínico IA"
          summary="Transcribe consulta a SOAP y sugiere códigos CIE-10."
          prompts={['Resumir signos vitales críticos', 'Auditar glosas RCM']}
          onRunPrompt={onRunPrompt}
        />
      </div>,
    );

    expect(screen.getByText('AMOX-500')).toBeInTheDocument();
    expect(screen.getByText('$12.50 · Bs 684.38')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Notas SOAP/i }));
    expect(onSelectTab).toHaveBeenCalledWith('soap');
    fireEvent.click(screen.getByRole('button', { name: 'Auditar glosas RCM' }));
    expect(onRunPrompt).toHaveBeenCalledWith('Auditar glosas RCM');
  });
```

- [ ] **Step 2: Run `@shac/ui` Vitest to confirm RED**

Run:
```bash
pnpm --filter @shac/ui test:run
```
Expected: FAIL (`BarcodeSvg`, `SegmentedTabs`, `AiCopilotBanner` are `undefined`).

- [ ] **Step 3: Implement `BarcodeSvg.tsx`, `SegmentedTabs.tsx`, `AiCopilotBanner.tsx` and export from `packages/ui/src/index.ts`**

1. Create `packages/ui/src/components/BarcodeSvg.tsx` (`<= 125` lines):
   - Exports `encodeCode128Bars(value: string): string` (deterministic binary bar-pattern encoder supporting ASCII printable characters with start/checksum/stop framing) and `BarcodeSvg` (`value`, `label?`, `priceLabel?`, `height?: number`, `className?`) rendering crisp `<svg>` `<rect>` bars + `font-mono` human-readable SKU and dual-currency price footer for thermal/sheet printing.
2. Create `packages/ui/src/components/SegmentedTabs.tsx` (`<= 80` lines):
   - Accessible `role="tablist"` / `role="tab"` (`aria-selected`) horizontal pill bar with optional icon and count badge (`tabular-nums`), horizontal scroll on mobile, and Open Mercato DS v3 active shadow/surface tokens.
3. Create `packages/ui/src/components/AiCopilotBanner.tsx` (`<= 115` lines):
   - Compact `Operate`-mode AI strip with `Sparkles` icon, domain `title`, `summary`, clickable `prompts: readonly string[]` chips, inline `reply?: string | null` result drawer, and `loading?: boolean` spinner state.
4. Export `BarcodeSvg`, `encodeCode128Bars`, `SegmentedTabs`, `AiCopilotBanner`, and their TypeScript prop interfaces from `packages/ui/src/index.ts`.

- [ ] **Step 4: Run `@shac/ui` tests and typecheck to verify GREEN**

Run:
```bash
pnpm --filter @shac/ui test:run
pnpm --filter @shac/ui typecheck
```
Expected: PASS (`11/11` tests in `packages/ui`, `0` TypeScript errors).

---

## Task 2: Retail, Barcode Label Studio, Bulk CSV Import, Cycle Counts, Fleet/ePOD & POS Pro (`CRMWarehouse-Stores` + `GeorginaPOS` + `open-pos`)

**Files:**
- Create: `apps/node-worker/src/wms-fleet-labels-routes.ts`
- Modify: `apps/node-worker/src/router.ts`
- Create: `apps/node-worker/test/omni-verticals.worker.test.ts`
- Create: `apps/web-spa/src/views/LabelsAndFleetView.tsx`
- Create: `apps/web-spa/src/views/PosProModals.tsx`
- Modify: `apps/web-spa/src/views/PosView.tsx`

- [ ] **Step 1: Write failing worker integration tests for Bulk CSV Product Import, Cycle Count/Stock Adjust, Fleet Dispatch/ePOD, and POS Quick Return**

Create `apps/node-worker/test/omni-verticals.worker.test.ts` testing:
1. `POST /api/wms/catalog-csv-import` (imports an array of parsed CSV product rows `{ sku, name, basePriceMinor, categoryName? }` into `cat_products` in a single `DB.batch` and returns `{ importedCount }`).
2. `POST /api/wms/cycle-counts` & `GET /api/wms/fleet-and-qc` (creates a `wms_qc_and_cycle_counts` record with variance and a `wms_fleet_and_deliveries` route dispatch with driver/plate/ePOD status, then reads both in `1` `DB.batch`).
3. `POST /api/pos/returns-quick` (records a POS return/credit memo in `com_returns_and_credit_memos` with integer `refund_minor` and reason).

- [ ] **Step 2: Run Vitest on `omni-verticals.worker.test.ts` to confirm RED (`404`)**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
```
Expected: FAIL with `404`.

- [ ] **Step 3: Implement `wms-fleet-labels-routes.ts` and mount in `apps/node-worker/src/router.ts`**

Create `apps/node-worker/src/wms-fleet-labels-routes.ts` (`<= 220` lines) with:
- `GET /wms/fleet-and-qc` (`DB.batch` reading `wms_fleet_and_deliveries`, `wms_qc_and_cycle_counts`, and `com_returns_and_credit_memos`)
- `POST /wms/catalog-csv-import` (upserts up to 50 CSV rows into `cat_products` via `DB.batch`)
- `POST /wms/cycle-counts` (inserts `cycle_count` / `stock_adjust` into `wms_qc_and_cycle_counts`)
- `POST /wms/fleet-dispatch` (inserts or updates `delivery_trip` with `vehicle_code`, `license_plate`, `order_id`, `epod_recipient_name`, `status` in `wms_fleet_and_deliveries`)
- `POST /pos/returns-quick` (inserts into `com_returns_and_credit_memos`).
Mount `.route('/api', createWmsFleetLabelsRoutes(profileLoader))` in `apps/node-worker/src/router.ts`.

- [ ] **Step 4: Build `LabelsAndFleetView.tsx` (`/labels-fleet`) and `PosProModals.tsx` (Cashier PIN Switch + Line Modifier + Quick Return + Printable Invoice)**

1. Create `apps/web-spa/src/views/LabelsAndFleetView.tsx` (`<= 265` lines):
   - 4 `SegmentedTabs`: **Etiquetas Código de Barras** (product multi-select + copies counter + dual USD/Bs live preview grid using `BarcodeSvg` + `window.print()`), **Importar CSV Masivo** (paste/upload CSV `sku,nombre,precio_usd` with preview table + 1-click import), **Conteo Cíclico & Ajustes** (`wms_qc_and_cycle_counts`), and **Flota & Despacho ePOD** (`wms_fleet_and_deliveries`).
   - Includes `AiCopilotBanner` connected to `rpc.api.automation['ai-chat'].$post`.
2. Create `apps/web-spa/src/views/PosProModals.tsx` (`<= 195` lines):
   - **Cambio Rápido de Cajero por PIN** (`CashierPinSwitchModal`: 6-digit touch PIN pad switching active `cashierName` without closing shift), **Nota / Modificador de Línea**, and **Devolución Rápida POS** (`POST /api/pos/returns-quick`).
   - Wire compact header trigger buttons (`Cajero PIN`, `Devolución`) into `apps/web-spa/src/views/PosView.tsx` keeping `PosView.tsx <= 300` lines.

- [ ] **Step 5: Run worker tests and typecheck**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
pnpm --filter @shac/node-worker --filter @shac/web-spa typecheck
```
Expected: PASS.

---

## Task 3: Clinical EHR Workspace, AI Medical Scribe, eRx, Lab/Imaging & RCM Scrubber (`Doctors-EHR-New`)

**Files:**
- Create: `apps/node-worker/src/clinical-ehr-routes.ts`
- Modify: `apps/node-worker/src/router.ts`
- Modify: `apps/node-worker/test/omni-verticals.worker.test.ts`
- Create: `apps/web-spa/src/views/ClinicalEhrView.tsx`
- Create: `apps/web-spa/src/views/ClinicalAiScribeModal.tsx`

- [ ] **Step 1: Append failing tests for Clinical EHR overview, Vitals + AI Scribe SOAP generation, eRx, and RCM Claim Scrubber to `omni-verticals.worker.test.ts`**

Test:
1. `POST /api/clinical/encounters` with `{ patientPartyId, chiefComplaint, vitals: { bpSystolic: 145, bpDiastolic: 92, heartRate: 88, tempC: 37.2, spo2Pct: 98 }, dictationText: 'Paciente masculino con cefalea tensional y PA elevada...' }` creates `med_encounters_and_vitals` + `med_clinical_notes` (using `env.AI` when bound or structured deterministic parser otherwise).
2. `POST /api/clinical/prescriptions` creates `med_prescriptions_and_erx`.
3. `POST /api/clinical/labs-and-rcm` creates `med_labs_and_imaging` or `med_rcm_claims_and_era` (computing `patient_responsibility_minor = total_charge_minor - insurer_paid_minor` and flagging scrubber warnings when `diagnosisCodes` is empty).
4. `GET /api/clinical/overview` returns all 4 collections + waiting room summary in `1` `DB.batch`.

- [ ] **Step 2: Run Vitest to confirm RED**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
```
Expected: FAIL (`404` on `/api/clinical/*`).

- [ ] **Step 3: Implement `clinical-ehr-routes.ts`, `ClinicalEhrView.tsx`, and `ClinicalAiScribeModal.tsx`**

1. Create `apps/node-worker/src/clinical-ehr-routes.ts` (`<= 255` lines) and mount `.route('/api', createClinicalEhrRoutes(profileLoader))` in `apps/node-worker/src/router.ts`.
2. Create `apps/web-spa/src/views/ClinicalAiScribeModal.tsx` (`<= 175` lines):
   - Doctor dictation box + Vitals strip (`PA`, `FC`, `Temp °C`, `SpO2 %`) + 1-click **"Generar SOAP + CIE-10 con IA"** previewing `Subjective`, `Objective`, `Assessment`, `Plan`, and `ICD-10` badges.
3. Create `apps/web-spa/src/views/ClinicalEhrView.tsx` (`<= 265` lines):
   - High-craft clinical cockpit (`/clinical-ehr`) with 5 `SegmentedTabs`: **Sala de Espera & Signos Vitales** (with abnormal vital badges in `rose`/`amber`), **Notas SOAP & AI Scribe**, **Recetas Electrónicas (eRx)**, **Laboratorio & Imagenología**, and **Seguros & Glosas RCM** (showing charge, insurer paid, copay/responsibility, and scrubber warnings).

- [ ] **Step 4: Run Vitest and typecheck to verify Task 3 GREEN**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
pnpm --filter @shac/node-worker --filter @shac/web-spa typecheck
```
Expected: PASS.

---

## Task 4: Legal Practice Suite — Matters, Court Dockets, Conflict Detector, Billable Timer, IOLTA Trust & AI Contract Reviewer (`lawyerplatform`)

**Files:**
- Create: `apps/node-worker/src/legal-practice-routes.ts`
- Modify: `apps/node-worker/src/router.ts`
- Modify: `apps/node-worker/test/omni-verticals.worker.test.ts`
- Create: `apps/web-spa/src/views/LegalPracticeView.tsx`
- Create: `apps/web-spa/src/views/LegalAiContractModal.tsx`

- [ ] **Step 1: Append failing tests for Legal Overview, Billable Time Entries, IOLTA Trust Overdraft Guard, and AI Contract & Conflict Review to `omni-verticals.worker.test.ts`**

Test:
1. `POST /api/legal/time-entries` computes integer `amount_minor = Math.round((durationMinutes * hourlyRateMinor) / 60)` and inserts into `leg_time_entries`.
2. `POST /api/legal/ai-contract-review` checks `crm_parties` + `leg_matters` for opposing/existing party name matches (`conflictsFound`) AND returns structured clause risk analysis (`riskScore`, `flaggedClauses`, `summary`) via `env.AI` or deterministic analyzer.
3. `GET /api/legal/overview` returns `matters`, `dockets`, `timeEntries`, and `trustLedgers` (`fin_trust_escrow_ledgers`) in `1` `DB.batch`.

- [ ] **Step 2: Run Vitest to confirm RED**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
```
Expected: FAIL (`404` on `/api/legal/*`).

- [ ] **Step 3: Implement `legal-practice-routes.ts`, `LegalPracticeView.tsx`, and `LegalAiContractModal.tsx`**

1. Create `apps/node-worker/src/legal-practice-routes.ts` (`<= 240` lines) and mount `.route('/api', createLegalPracticeRoutes(profileLoader))` in `apps/node-worker/src/router.ts`.
2. Create `apps/web-spa/src/views/LegalAiContractModal.tsx` (`<= 170` lines):
   - Dual-purpose modal for **Análisis de Contratos / Escritos con IA** and **Detector de Conflicto de Intereses** with risk severity pills and party-collision alerts.
3. Create `apps/web-spa/src/views/LegalPracticeView.tsx` (`<= 270` lines):
   - Includes a live **Cronómetro Facturable (`00:00:00`)** in the header action bar (Play/Pause/Registrar en `leg_time_entries`), plus 4 `SegmentedTabs`: **Expedientes & Dockets Judiciales**, **Horas Facturables**, **Cuentas Fideicomiso IOLTA** (deposit/disbursement wired to `/api/finance/trust/transact`), and **Conflictos & Contratos IA**.

- [ ] **Step 4: Run Vitest and typecheck to verify Task 4 GREEN**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
pnpm --filter @shac/node-worker --filter @shac/web-spa typecheck
```
Expected: PASS.

---

## Task 5: Hospitality PMS Housekeeping + Folios (`hotel-project-turpial`) & Condo Resident Hub (`apartment-property-management`)

**Files:**
- Create: `apps/node-worker/src/hospitality-condo-routes.ts`
- Modify: `apps/node-worker/src/router.ts`
- Modify: `apps/node-worker/test/omni-verticals.worker.test.ts`
- Create: `apps/web-spa/src/views/HospitalityPmsView.tsx`
- Create: `apps/web-spa/src/views/CondoResidentHubView.tsx`

- [ ] **Step 1: Append failing tests for Housekeeping Room State Transitions, Guest Folios, and Condo Hub (Visitor QR, Packages, Parking/Pets, Amenities, Polls) to `omni-verticals.worker.test.ts`**

Test:
1. `POST /api/hospitality/housekeeping` creates/updates a task in `spc_housekeeping_tasks` and atomically updates `spc_units.current_status` (`CLEAN` / `DIRTY` / `INSPECTED` / `MAINTENANCE`) via `DB.batch`.
2. `POST /api/condo/hub-items` creates items of kind `'visitor_pass' | 'package_delivery' | 'parking_pet' | 'amenity_booking' | 'community_poll'` in `condo_community_hub`, and `POST /api/condo/hub-items/:id/vote` increments poll option votes cleanly.
3. `GET /api/hospitality/overview` and `GET /api/condo/overview` each execute `1` `DB.batch`.

- [ ] **Step 2: Run Vitest to confirm RED**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
```
Expected: FAIL (`404` on `/api/hospitality/*` and `/api/condo/*`).

- [ ] **Step 3: Implement `hospitality-condo-routes.ts`, `HospitalityPmsView.tsx`, and `CondoResidentHubView.tsx`**

1. Create `apps/node-worker/src/hospitality-condo-routes.ts` (`<= 255` lines) and mount `.route('/api', createHospitalityCondoRoutes(profileLoader))` in `apps/node-worker/src/router.ts`.
2. Create `apps/web-spa/src/views/HospitalityPmsView.tsx` (`<= 270` lines) enhancing `/spaces`:
   - Visual color-coded **Rack de Habitaciones** (`Disponible`, `Ocupada`, `Sucia`, `En Limpieza`, `Mantenimiento`), **Tablero de Camareras (Housekeeping)** with 1-click state transitions, **Check-In / Check-Out & Folios**, and `AiCopilotBanner` for occupancy/tariff suggestions.
3. Create `apps/web-spa/src/views/CondoResidentHubView.tsx` (`<= 275` lines) enhancing `/leases`:
   - 5 `SegmentedTabs`: **Contratos & Renovaciones**, **Visitantes QR & Paquetería**, **Estacionamiento & Mascotas**, **Reserva de Amenidades**, and **Votaciones de Condominio** (interactive poll bars with 1-click voting).

- [ ] **Step 4: Run Vitest and typecheck to verify Task 5 GREEN**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
pnpm --filter @shac/node-worker --filter @shac/web-spa typecheck
```
Expected: PASS.

---

## Task 6: Helios Physical Security Console (Garita Deck, Video Wall, Smart Lockers & LAN Discovery), Navigation Wiring, Lazy Chunking & Live Deploy

**Files:**
- Create: `apps/node-worker/src/physical-helios-routes.ts`
- Modify: `apps/node-worker/src/router.ts`
- Modify: `apps/node-worker/test/omni-verticals.worker.test.ts`
- Create: `apps/web-spa/src/views/HeliosSecurityView.tsx`
- Modify: `apps/web-spa/src/nav.ts`
- Modify: `apps/web-spa/src/main.tsx`
- Modify: `apps/web-spa/vite.config.ts`

- [ ] **Step 1: Append failing tests for Helios Physical Overview, Remote Door Lock/Unlock Toggle, and LAN Device Discovery Registration to `omni-verticals.worker.test.ts`**

Test:
1. `POST /api/physical/devices/upsert-or-toggle` registers a smart lock/camera/LPR gate (`phy_devices_and_locks`) or toggles `lock_state` (`LOCKED` <-> `UNLOCKED`) with heartbeat timestamp.
2. `GET /api/physical/overview` returns `devices`, `passes`, `lprEvents`, `lockers`, `clips`, and `tamperAlerts` in `1` `DB.batch`.

- [ ] **Step 2: Run Vitest to confirm RED**

Run:
```bash
pnpm --filter @shac/node-worker test:run test/omni-verticals.worker.test.ts
```
Expected: FAIL (`404` on `/api/physical/overview`).

- [ ] **Step 3: Implement `physical-helios-routes.ts`, `HeliosSecurityView.tsx`, wire routes in `nav.ts` + `main.tsx`, and add Vite chunk splitting**

1. Create `apps/node-worker/src/physical-helios-routes.ts` (`<= 195` lines) and mount `.route('/api', createPhysicalHeliosRoutes(profileLoader))` in `apps/node-worker/src/router.ts`.
2. Create `apps/web-spa/src/views/HeliosSecurityView.tsx` (`<= 275` lines) replacing the basic `/physical` view:
   - **Consola Garita Táctil**: 1-tap Remote Door Lock/Unlock cards with battery % and online status, **Video Wall 2×2 / 3×3** showing sealed clips with SHA-256 verification pills, **Lectura de Placas LPR** en vivo, ** Pases QR / WhatsApp**, **Matriz de Smart Lockers**, and **Escáner de Red LAN**.
3. Update `apps/web-spa/src/nav.ts` and `apps/web-spa/src/main.tsx`:
   - Add `/labels-fleet` (`Etiquetas, CSV & Flota` in `WMS`), `/clinical-ehr` (`Clínica EHR & AI Scribe` in `OPERACIONES`), `/legal-hub` (`Legal, Dockets & IOLTA` in `OPERACIONES`), and route `/spaces` -> `HospitalityPmsView`, `/leases` -> `CondoResidentHubView`, `/physical` -> `HeliosSecurityView` (keeping legacy `SpacesLeasesViews.tsx` / `PhysicalView.tsx` clean or removed if unused so `knip --strict` stays `0`!).
4. Update `apps/web-spa/vite.config.ts` with `build.rollupOptions.output.manualChunks` separating `vendor-react` (`react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`) and `vendor-icons` (`lucide-react`) so bundle chunks stay crisp and fast.

- [ ] **Step 4: Run Full Monorepo Verification Gates (`<= 300` LOC check, `typecheck`, `test:run`, `knip --strict`, `vite build`, and `wrangler deploy`)**

Run:
```bash
pnpm -r typecheck
pnpm -r test:run
pnpm dlx knip --strict
pnpm --filter @shac/web-spa build
wrangler deploy -c apps/node-worker/wrangler.jsonc
```
Expected:
- Every `.ts` / `.tsx` file `<= 300` lines.
- `pnpm -r typecheck` -> `24/24` projects `exit code 0`.
- `pnpm -r test:run` -> all test suites `exit code 0`.
- `pnpm dlx knip --strict` -> `0` unused files/exports (`exit code 0`).
- `shac-node-worker` deployed live (`< 1024 KiB` gzip) with HTTP `200` verification.
