import { describe, expect, it } from 'vitest';
import {
  assertAccountCurrencyMatch,
  computeRemainingTender,
  computeTaxInclusiveAmounts,
} from '../src/tender-engine.js';

describe('@shac/mod-pos pure BigInt tender engine', () => {
  it('computes exact remaining tender in target currency for the "Restante" button (USD -> VES)', () => {
    const result = computeRemainingTender(
      2500,
      [{ currency: 'usd', amountMinor: 1000 }],
      'USD',
      'VES',
      36_500_000,
    );

    expect(result).toEqual({
      orderCurrency: 'USD',
      targetCurrency: 'VES',
      rateMicros: 36_500_000,
      orderTotalMinor: 2500,
      paidInOrderCurrencyMinor: 1000,
      remainingInOrderCurrencyMinor: 1500,
      remainingInTargetCurrencyMinor: 54_750,
      changeDueMinor: 0,
      changeDueInTargetCurrencyMinor: 0,
      isSettled: false,
    });
  });

  it('settles mixed-currency payments and calculates changeDueMinor without floats', () => {
    const settled = computeRemainingTender(
      2500,
      [
        { currency: 'USD', amountMinor: 1000 },
        { currency: 'VES', amountMinor: 54_750, exchangeRateMicros: 36_500_000 },
      ],
      'USD',
      'VES',
      36_500_000,
    );
    expect(settled.remainingInOrderCurrencyMinor).toBe(0);
    expect(settled.remainingInTargetCurrencyMinor).toBe(0);
    expect(settled.changeDueMinor).toBe(0);
    expect(settled.isSettled).toBe(true);

    const overpaid = computeRemainingTender(
      2500,
      [
        { currency: 'USD', amountMinor: 1000 },
        { currency: 'VES', amountMinor: 73_000 },
      ],
      'USD',
      'VES',
      36_500_000,
    );
    expect(overpaid.paidInOrderCurrencyMinor).toBe(3000);
    expect(overpaid.remainingInOrderCurrencyMinor).toBe(0);
    expect(overpaid.changeDueMinor).toBe(500);
    expect(overpaid.changeDueInTargetCurrencyMinor).toBe(18_250);
    expect(overpaid.isSettled).toBe(true);
  });

  it('enforces Cuenta=Moneda and throws 422 ERR_CURRENCY_ACCOUNT_MISMATCH on mismatch', () => {
    expect(assertAccountCurrencyMatch('ves', 'VES')).toBe('VES');
    expect(() => assertAccountCurrencyMatch('USD', 'VES')).toThrowError(
      expect.objectContaining({
        code: 'ERR_CURRENCY_ACCOUNT_MISMATCH',
        status: 422,
      }),
    );
  });

  it('rejects non-integer floating-point money inputs and invalid FX rates', () => {
    expect(() =>
      computeRemainingTender(25.5, [], 'USD', 'VES', 36_500_000),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INTEGER_MONEY', status: 400 }));

    expect(() =>
      computeRemainingTender(2500, [], 'USD', 'VES', 0),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_FX_RATE', status: 400 }));

    const taxIncl = computeTaxInclusiveAmounts(1000, 2, 1600, 36_500_000);
    expect(taxIncl).toEqual({
      unitPriceExclTaxMinor: 1000,
      unitTaxMinor: 160,
      unitPriceInclTaxMinor: 1160,
      lineSubtotalMinor: 2000,
      lineTaxMinor: 320,
      lineTotalMinor: 2320,
      secondaryUnitPriceInclTaxMinor: 42_340,
      secondaryLineTotalMinor: 84_680,
    });
  });
});
