import { describe, expect, it } from 'vitest';
import {
  applyLineDiscountMinor,
  computeDualChangeMinor,
  findProductByScanCode,
} from '../src/lib/usePosScanner.js';
import { parkOrderToList, recallOrderFromList } from '../src/views/PosHoldOrdersModal.js';

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
    expect(applyLineDiscountMinor(1000, 1000)).toBe(900);
    expect(applyLineDiscountMinor(1250, 0)).toBe(1250);
    expect(applyLineDiscountMinor(1000, 10000)).toBe(0);
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

  it('parks and recalls held (Leylan) orders preserving cart lines and customer label', () => {
    const parked = parkOrderToList([], {
      customerName: 'María Pérez (Leylan #1)',
      items: [{ productId: 'p1', sku: 'AMOX-500', name: 'Amoxicilina 500mg', unitPriceMinor: 1250, qty: 2, discountBps: 1000 }],
      totalMinor: 2250,
    });
    expect(parked).toHaveLength(1);
    expect(parked[0]?.customerName).toContain('María Pérez');

    const { recalled, remaining } = recallOrderFromList(parked, parked[0]!.id);
    expect(recalled?.items).toHaveLength(1);
    expect(recalled?.totalMinor).toBe(2250);
    expect(remaining).toHaveLength(0);
  });

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

  it('builds POS checkout payload with manualDiscountBps, selected method/accounts, and exchangeRateMicros', async () => {
    const {
      buildPosCheckoutPayload,
      loadPersistedPosState,
      savePersistedPosState,
    } = await import('../src/lib/usePosShiftAndCheckout.js');
    const payload = buildPosCheckoutPayload({
      shiftId: 'sh_1',
      orderCurrency: 'USD',
      cart: [
        {
          productId: 'p1',
          sku: 'AMOX-500',
          name: 'Amoxicilina',
          unitPriceMinor: 1000,
          qty: 1,
          discountBps: 1000,
        },
      ],
      usdMinor: 500,
      vesMinor: 21900,
      rateMicros: 54_750_000,
      usdAccountId: 'acc_1',
      vesAccountId: 'acc_2',
      usdMethod: 'ZELLE',
    });
    expect(payload.items[0]?.manualDiscountBps).toBe(1000);
    expect(payload.payments[0]?.methodCode).toBe('ZELLE');
    expect(payload.payments[0]?.financialAccountId).toBe('acc_1');
    expect(payload.payments[1]?.exchangeRateMicros).toBe(54_750_000);

    savePersistedPosState('ten_1:org_1', {
      shiftId: 'sh_1',
      registerId: 'CAJA-01',
      cart: payload.items.map((i) => ({
        productId: i.productId,
        sku: 'AMOX-500',
        name: 'Amoxicilina',
        unitPriceMinor: 1000,
        qty: i.qty,
        discountBps: i.manualDiscountBps,
      })),
    });
    expect(loadPersistedPosState('ten_1:org_1')?.shiftId).toBe('sh_1');
  });
});
