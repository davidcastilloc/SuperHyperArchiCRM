import { describe, expect, it } from 'vitest';
import {
  computeLowest30dMinor,
  computeMarginBps,
  convertCurrencyMinor,
  OMNIBUS_WINDOW_SEC,
  resolveFiveLayerPrice,
} from '../src/index.js';

describe('@shac/mod-catalog pure integer pricing engine', () => {
  const nowSec = 1_763_000_000;
  const baseProduct = {
    id: 'prod_1',
    basePriceMinor: 1000,
    costPriceMinor: 600,
    primaryCurrency: 'USD',
    taxRateBps: 1600,
  };

  it('cascades strictly through all 5 layers: Contract -> Group -> Promo -> Variant -> Base', () => {
    const rules = [
      { id: 'r_contract', targetPartyId: 'pty_vip', unitPriceMinor: 750 },
      { id: 'r_group', targetGroupId: 'grp_b2b', unitPriceMinor: 820 },
      { id: 'r_promo', tariffKind: 'promotion', discountBps: 1000 },
    ];
    const variant = { id: 'var_box', uomFactorMicros: 12_000_000, overridePriceMinor: 11_400 };

    const l1 = resolveFiveLayerPrice({
      product: baseProduct,
      partyId: 'pty_vip',
      groupIds: ['grp_b2b'],
      rules,
      nowSec,
    });
    expect(l1.appliedLayer).toBe('CONTRACT_1TO1');
    expect(l1.unitPriceMinor).toBe(750);
    expect(l1.marginBps).toBe(2000);
    expect(l1.unitTaxMinor).toBe(120);
    expect(l1.unitPriceWithTaxMinor).toBe(870);

    const l2 = resolveFiveLayerPrice({
      product: baseProduct,
      groupIds: ['grp_b2b'],
      rules,
      nowSec,
    });
    expect(l2.appliedLayer).toBe('GROUP_TARIFF');
    expect(l2.unitPriceMinor).toBe(820);

    const l3 = resolveFiveLayerPrice({
      product: baseProduct,
      rules,
      nowSec,
    });
    expect(l3.appliedLayer).toBe('PROMOTION_CHANNEL');
    expect(l3.unitPriceMinor).toBe(900);

    const l4 = resolveFiveLayerPrice({
      product: baseProduct,
      variant,
      nowSec,
    });
    expect(l4.appliedLayer).toBe('VARIANT_UOM');
    expect(l4.unitPriceMinor).toBe(11_400);
    expect(l4.unitCostMinor).toBe(7_200);

    const l5 = resolveFiveLayerPrice({
      product: baseProduct,
      nowSec,
    });
    expect(l5.appliedLayer).toBe('BASE_PRICE');
    expect(l5.unitPriceMinor).toBe(1000);
  });

  it('rejects prices below margin floor with 422 BELOW_MARGIN_FLOOR unless allowBelowCost=true', () => {
    const lowPromo = [{ id: 'r_loss', tariffKind: 'promotion', unitPriceMinor: 500 }];

    expect(() =>
      resolveFiveLayerPrice({
        product: baseProduct,
        rules: lowPromo,
        nowSec,
      }),
    ).toThrowError(expect.objectContaining({ code: 'BELOW_MARGIN_FLOOR', status: 422 }));

    expect(() =>
      resolveFiveLayerPrice({
        product: baseProduct,
        minMarginBps: 5000,
        nowSec,
      }),
    ).toThrowError(expect.objectContaining({ code: 'BELOW_MARGIN_FLOOR', status: 422 }));

    const allowed = resolveFiveLayerPrice({
      product: baseProduct,
      rules: lowPromo,
      allowBelowCost: true,
      nowSec,
    });
    expect(allowed.unitPriceMinor).toBe(500);
    expect(allowed.marginBps).toBe(-2000);
  });

  it('converts secondary currency via integer rateMicros and tracks 30d Omnibus lowest', () => {
    const quoted = resolveFiveLayerPrice({
      product: baseProduct,
      qty: 3,
      nowSec,
      fxRate: { secondaryCurrency: 'VES', rateMicros: 52_450_000 },
      omnibusHistory: [
        { priceMinor: 400, recordedAt: nowSec - OMNIBUS_WINDOW_SEC - 1 },
        { priceMinor: 920, recordedAt: nowSec - 86_400 * 10 },
        { priceMinor: 1050, recordedAt: nowSec - 86_400 * 2 },
      ],
    });

    expect(quoted.lineSubtotalMinor).toBe(3000);
    expect(quoted.lineTaxMinor).toBe(480);
    expect(quoted.lineTotalMinor).toBe(3480);
    expect(quoted.secondaryUnitPriceMinor).toBe(52_450);
    expect(quoted.secondaryLineTotalMinor).toBe(182_526);
    expect(quoted.lowest30dMinor).toBe(920);
    expect(quoted.isBelow30dLowest).toBe(false);
    expect(convertCurrencyMinor(1000, 52_450_000)).toBe(52_450);
    expect(computeMarginBps(1000, 600)).toBe(4000);
    expect(computeLowest30dMinor([], nowSec)).toBeNull();
  });

  it('rejects non-integer floating-point monetary inputs', () => {
    expect(() =>
      resolveFiveLayerPrice({
        product: { ...baseProduct, basePriceMinor: 10.5 },
        nowSec,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INTEGER_MONEY', status: 400 }));
  });
});
