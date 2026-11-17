# SHAC Omni-Turbo POS Fusion Implementation Plan (GeorginaPOS + CRMWarehouse-Stores + open-pos)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `PosView` in `@shac/web-spa` and `@shac/ui` by fusing the highest-velocity point-of-sale capabilities from `GeorginaPOS` (300ms debounced search, instant barcode `Enter` capture, `VirtualKeypad`, live dual USD/VES conversion), `CRMWarehouse-Stores` (`PosAudio` Web Audio + haptics synthesizer, `PosCameraScannerModal`, `PosHoldOrdersModal` / "Leylan" parked carts, quick-tender bills & dual change calculation, cashier PIN quick-switch), and `open-pos` (detailed cash-closing denomination count before closing shift).

**Architecture:**
- All new POS components adhere strictly to Open Mercato DS v3 (`lucide-react` icons, `oklch` CSS tokens, `Geist` + `Geist Mono`, `tabular-nums`, bimodal compact/touch density) and stay `<= 300` lines per `.ts` / `.tsx` file.
- All monetary calculations use integer minor units (`*_minor: number`) and basis points (`discountBps: 0..10000`) with `BigInt` rounding for `USD -> VES` conversion.
- Parked/Held orders ("Leylan") persist locally per `registerId` (`localStorage` with safe SSR/Vitest fallback) so cashiers can suspend and recall carts instantaneously at `0 ms` even while offline.

**Tech Stack:** React 19, TypeScript 5.8, TanStack Query, Tailwind CSS v4, Lucide React, Web Audio API (`AudioContext`), Browser `BarcodeDetector` API (with manual fallback), Vitest, Wrangler.

## Global Constraints

- **Maximum 300 lines per `.ts` or `.tsx` file** (`wc -l` verified).
- **Maximum 3 implementation files per step (plus `.test.ts`)**.
- **Zero `next/*`, zero `React.forwardRef`, zero Unicode/emoji icon stand-ins, zero floating-point money math, zero OS-specific paths**.
- **Verify `pnpm -r typecheck`, `pnpm -r test:run`, `pnpm dlx knip --strict`, and `wrangler deploy --dry-run` (`< 1024 KiB` gzip)** before completion.

---

## Task 1: Web Audio POS Synthesizer (`posAudio.ts`), Debounced Search & Barcode HID/Camera Scanner

**Files:**
- Create: `apps/web-spa/src/lib/posAudio.ts`
- Create: `apps/web-spa/src/lib/usePosScanner.ts`
- Create: `apps/web-spa/src/views/PosCameraScannerModal.tsx`
- Create: `apps/web-spa/test/pos.turbo.test.ts`

- [ ] **Step 1: Write failing unit tests for debounced search/barcode SKU matching and integer discount/change math**

Create `apps/web-spa/test/pos.turbo.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  applyLineDiscountMinor,
  computeDualChangeMinor,
  findProductByScanCode,
} from '../src/lib/usePosScanner.js';

describe('POS Omni-Turbo scanner & integer math', () => {
  const catalog = [
    { id: 'p1', sku: 'AMOX-500', name: 'Amoxicilina 500mg', basePriceMinor: 1250 },
    { id: 'p2', sku: '7591234567890', name: 'Café Molido 500g', basePriceMinor: 750 },
  ];

  it('matches products case-insensitively by exact SKU or barcode', () => {
    expect(findProductByScanCode(catalog, 'amox-500')?.id).toBe('p1');
    expect(findProductByScanCode(catalog, ' 7591234567890 ')?.id).toBe('p2');
    expect(findProductByScanCode(catalog, 'UNKNOWN')).toBeNull();
  });

  it('computes line discounts in basis points using integer math', () => {
    expect(applyLineDiscountMinor(1000, 1000)).toBe(900); // 10% off
    expect(applyLineDiscountMinor(1250, 0)).toBe(1250);
    expect(applyLineDiscountMinor(1000, 10000)).toBe(0); // 100% off
  });

  it('computes remaining and dual USD/VES change without floating point drift', () => {
    const res = computeDualChangeMinor({
      totalUsdMinor: 1500,
      paidUsdMinor: 2000,
      paidVesMinor: 0,
      rateMicros: 54_750_000,
    });
    expect(res.remainingUsdMinor).toBe(0);
    expect(res.changeUsdMinor).toBe(500);
    expect(res.changeVesMinor).toBe(27375);
  });
});
```

- [ ] **Step 2: Run Vitest to confirm RED**

Run:
```bash
pnpm --filter @shac/web-spa test:run test/pos.turbo.test.ts
```
Expected: FAIL (`Cannot find module '../src/lib/usePosScanner.js'`).

- [ ] **Step 3: Implement `posAudio.ts`, `usePosScanner.ts`, and `PosCameraScannerModal.tsx`**

1. Create `apps/web-spa/src/lib/posAudio.ts` (`<= 95` lines):
   - Port `PosAudio` (`playScanBeep()`, `playPaymentSuccess()`, `playErrorTone()`) using Web Audio API `AudioContext` + `navigator.vibrate?.(...)`, failing silently in headless/Vitest environments.
2. Create `apps/web-spa/src/lib/usePosScanner.ts` (`<= 120` lines):
   - Export pure helpers `findProductByScanCode`, `applyLineDiscountMinor`, `computeDualChangeMinor`.
   - Export `useDebouncedValue<T>(value: T, delayMs = 300): T` for 300ms debounced catalog filtering.
   - Export `useGlobalBarcodeHid(onScan: (code: string) => void, enabled: boolean)` listening for rapid HID keyboard bursts (`< 60ms` inter-keystroke + `Enter`) even when focus is outside the search box (ignoring active `<input>`/`<textarea>` elements).
3. Create `apps/web-spa/src/views/PosCameraScannerModal.tsx` (`<= 145` lines):
   - Uses `navigator.mediaDevices.getUserMedia` + `BarcodeDetector` (`ean_13`, `code_128`, `qr_code`, `upc_a`) when supported, plus a clean manual barcode/SKU input fallback so it works on any device.

- [ ] **Step 4: Run Vitest + typecheck to verify Task 1 GREEN**

Run:
```bash
pnpm --filter @shac/web-spa test:run test/pos.turbo.test.ts
pnpm --filter @shac/web-spa typecheck
```
Expected: PASS (`3/3` tests, `0` TypeScript errors).

---

## Task 2: Parked & Held Orders ("Leylan" / Apartados) + Line Discounts & Customer Selector

**Files:**
- Create: `apps/web-spa/src/views/PosHoldOrdersModal.tsx`
- Modify: `apps/web-spa/src/views/PosReceiptPanel.tsx`
- Modify: `apps/web-spa/test/pos.turbo.test.ts`

- [ ] **Step 1: Add failing test for hold/recall ("Leylan") queue serialization in `apps/web-spa/test/pos.turbo.test.ts`**

Append tests verifying `parkOrderToList` and `recallOrderFromList` preserve cart lines, customer label, and total minor units cleanly.

- [ ] **Step 2: Run Vitest to confirm RED**

Run:
```bash
pnpm --filter @shac/web-spa test:run test/pos.turbo.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `PosHoldOrdersModal.tsx` and update `PosCartLine` in `PosReceiptPanel.tsx`**

1. Create `apps/web-spa/src/views/PosHoldOrdersModal.tsx` (`<= 175` lines):
   - Exports `HeldPosOrder`, `parkOrderToList`, `recallOrderFromList`, and `PosHoldOrdersModal` (Open Mercato DS v3 modal with customer/note tag, item count, total USD/VES, timestamp, Recall & Delete buttons).
2. Update `PosCartLine` in `apps/web-spa/src/views/PosReceiptPanel.tsx` to support `discountBps?: number` and per-line discount badge + quick `10%` / `0%` toggle or keypad trigger.

- [ ] **Step 4: Run Vitest + typecheck to verify Task 2 GREEN**

Run:
```bash
pnpm --filter @shac/web-spa test:run test/pos.turbo.test.ts
pnpm --filter @shac/web-spa typecheck
```
Expected: PASS.

---

## Task 3: Touch `PosVirtualKeypad` (`@shac/ui`), `PosTenderModal` (Quick Bills + Multi-Method + Dual Change) & `PosCashClosingModal`

**Files:**
- Create: `packages/ui/src/components/PosVirtualKeypad.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/test/ui.smoke.test.tsx`
- Create: `apps/web-spa/src/views/PosTenderModal.tsx`
- Create: `apps/web-spa/src/views/PosCashClosingModal.tsx`

- [ ] **Step 1: Write failing smoke test in `packages/ui/test/ui.smoke.test.tsx` for `PosVirtualKeypad`**

Assert `PosVirtualKeypad` renders digits `0-9`, `.`, `Borrar`, `Aplicar`, and invokes `onChange` / `onSubmit` on touch clicks.

- [ ] **Step 2: Run `@shac/ui` Vitest to confirm RED**

Run:
```bash
pnpm --filter @shac/ui test:run
```
Expected: FAIL (`PosVirtualKeypad` not exported).

- [ ] **Step 3: Implement `PosVirtualKeypad.tsx`, `PosTenderModal.tsx`, and `PosCashClosingModal.tsx`**

1. Create `packages/ui/src/components/PosVirtualKeypad.tsx` (`<= 115` lines) and export from `packages/ui/src/index.ts`.
2. Create `apps/web-spa/src/views/PosTenderModal.tsx` (`<= 225` lines):
   - Quick bill buttons (`Exacto`, `$1`, `$5`, `$10`, `$20`, `$50`, `$100`) + `"Restante en Bs"`.
   - Payment method selector (`USD_CASH`, `PAGO_MOVIL`, `POS_DEBIT`, `ZELLE`).
   - Live display of **Total**, **Pagado**, **Restante**, and **Vuelto USD / Bs** (`computeDualChangeMinor`), plus `PosVirtualKeypad` toggle for touch terminals.
3. Create `apps/web-spa/src/views/PosCashClosingModal.tsx` (`<= 155` lines):
   - Allows entering counted USD & VES cash (and shows variance note) before calling `POST /api/pos/shifts/close`.

- [ ] **Step 4: Run `@shac/ui` & `@shac/web-spa` tests and typecheck**

Run:
```bash
pnpm --filter @shac/ui test:run
pnpm --filter @shac/web-spa test:run
pnpm --filter @shac/ui --filter @shac/web-spa typecheck
```
Expected: PASS.

---

## Task 4: Wire Omni-Turbo Features into `PosView.tsx`, Full Verification (`typecheck`, `test:run`, `knip --strict`) & Live Cloudflare Deploy

**Files:**
- Modify: `apps/web-spa/src/views/PosView.tsx` (keep strictly `<= 300` lines!)

- [ ] **Step 1: Wire `usePosScanner`, `PosAudio`, `PosCameraScannerModal`, `PosHoldOrdersModal` ("Leylan"), `PosTenderModal`, `PosCashClosingModal`, and `F1`/`F8`/`F9` hotkeys into `PosView.tsx`**

Ensure `PosView.tsx` remains `<= 300` lines by delegating modal UIs to `PosCameraScannerModal`, `PosHoldOrdersModal`, `PosTenderModal`, `PosCashClosingModal`, and `PosReceiptPanel`.

- [ ] **Step 2: Run full monorepo verification gates**

Run:
```bash
pnpm -r typecheck
pnpm -r test:run
pnpm dlx knip --strict
pnpm --filter @shac/web-spa build
```
Expected: All 4 commands exit `0`, every file `<= 300` lines.

- [ ] **Step 3: Deploy to Cloudflare (`shac-node-worker`) and commit/push**

Run:
```bash
wrangler deploy -c apps/node-worker/wrangler.jsonc
```
Expected: Live deployment `< 1024 KiB` gzip with HTTP `200` on `/`.
