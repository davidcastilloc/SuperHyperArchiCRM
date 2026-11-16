import { AppError } from '@shac/kernel';
import {
  computeBpsAmount,
  convertCurrencyMinor,
  MICROS_SCALE,
} from '@shac/mod-catalog';
import {
  assertAccountCurrencyMatch,
  assertNonNegativeSafeInt,
  assertPositiveRateMicros,
  BIG_MICROS_SCALE,
  divRoundHalfUp,
  normalizeCurrency,
  toSafeInt,
} from './tender-math.js';

export {
  assertAccountCurrencyMatch,
  assertNonNegativeSafeInt,
  assertPositiveRateMicros,
  normalizeCurrency,
};

export interface TenderPaymentLine {
  currency: string;
  amountMinor: number;
  amountInOrderCurrencyMinor?: number;
  exchangeRateMicros?: number;
  rateDirection?: 'order_to_payment' | 'payment_to_order';
}

export interface RemainingTenderResult {
  orderCurrency: string;
  targetCurrency: string;
  rateMicros: number;
  orderTotalMinor: number;
  paidInOrderCurrencyMinor: number;
  remainingInOrderCurrencyMinor: number;
  remainingInTargetCurrencyMinor: number;
  changeDueMinor: number;
  changeDueInTargetCurrencyMinor: number;
  isSettled: boolean;
}

export interface TaxInclusiveAmountResult {
  unitPriceExclTaxMinor: number;
  unitTaxMinor: number;
  unitPriceInclTaxMinor: number;
  lineSubtotalMinor: number;
  lineTaxMinor: number;
  lineTotalMinor: number;
  secondaryUnitPriceInclTaxMinor: number | null;
  secondaryLineTotalMinor: number | null;
}

export function convertPaymentLineToOrderMinor(
  payment: TenderPaymentLine,
  orderCurrency: string,
  fallbackTargetCurrency?: string,
  fallbackOrderToTargetRateMicros?: number,
): number {
  const orderCurr = normalizeCurrency(orderCurrency, 'orderCurrency');
  const payCurr = normalizeCurrency(payment.currency, 'payment.currency');
  const amountMinor = assertNonNegativeSafeInt(
    payment.amountMinor,
    'payment.amountMinor',
  );

  if (payment.amountInOrderCurrencyMinor !== undefined) {
    return assertNonNegativeSafeInt(
      payment.amountInOrderCurrencyMinor,
      'payment.amountInOrderCurrencyMinor',
    );
  }

  if (payCurr === orderCurr) {
    return amountMinor;
  }

  if (payment.exchangeRateMicros !== undefined) {
    const rate = assertPositiveRateMicros(
      payment.exchangeRateMicros,
      'payment.exchangeRateMicros',
    );
    if (payment.rateDirection === 'payment_to_order') {
      return divRoundHalfUp(
        BigInt(amountMinor) * BigInt(rate),
        BIG_MICROS_SCALE,
      );
    }
    return divRoundHalfUp(
      BigInt(amountMinor) * BIG_MICROS_SCALE,
      BigInt(rate),
    );
  }

  if (
    fallbackTargetCurrency &&
    payCurr === fallbackTargetCurrency &&
    fallbackOrderToTargetRateMicros !== undefined
  ) {
    const rate = assertPositiveRateMicros(
      fallbackOrderToTargetRateMicros,
      'rateMicros',
    );
    return divRoundHalfUp(
      BigInt(amountMinor) * BIG_MICROS_SCALE,
      BigInt(rate),
    );
  }

  throw new AppError(
    'INVALID_FX_RATE',
    400,
    `Missing exchangeRateMicros to convert payment from ${payCurr} to ${orderCurr}`,
  );
}

/**
 * Pure BigInt multi-currency tender calculator backing the 1-click "Restante" button.
 * `rateMicros` represents `1 orderCurrency = (rateMicros / 1_000_000) targetCurrency`.
 */
export function computeRemainingTender(
  orderTotalMinor: number,
  existingPayments: readonly TenderPaymentLine[],
  orderCurrency: string,
  targetCurrency: string,
  rateMicros?: number,
): RemainingTenderResult {
  const totalMinor = assertNonNegativeSafeInt(orderTotalMinor, 'orderTotalMinor');
  const ordCurr = normalizeCurrency(orderCurrency, 'orderCurrency');
  const tgtCurr = normalizeCurrency(targetCurrency, 'targetCurrency');

  const effectiveRateMicros =
    ordCurr === tgtCurr
      ? rateMicros === undefined
        ? MICROS_SCALE
        : assertPositiveRateMicros(rateMicros, 'rateMicros')
      : assertPositiveRateMicros(rateMicros ?? 0, 'rateMicros');

  let paidBig = 0n;
  for (const payment of existingPayments) {
    const equivalentOrderMinor = convertPaymentLineToOrderMinor(
      payment,
      ordCurr,
      tgtCurr,
      effectiveRateMicros,
    );
    paidBig += BigInt(equivalentOrderMinor);
  }

  const totalBig = BigInt(totalMinor);
  const remainingOrderBig = totalBig > paidBig ? totalBig - paidBig : 0n;
  const changeOrderBig = paidBig > totalBig ? paidBig - totalBig : 0n;

  const paidInOrderCurrencyMinor = toSafeInt(paidBig, 'paidInOrderCurrencyMinor');
  const remainingInOrderCurrencyMinor = toSafeInt(
    remainingOrderBig,
    'remainingInOrderCurrencyMinor',
  );
  const changeDueMinor = toSafeInt(changeOrderBig, 'changeDueMinor');

  const remainingInTargetCurrencyMinor =
    ordCurr === tgtCurr
      ? remainingInOrderCurrencyMinor
      : convertCurrencyMinor(remainingInOrderCurrencyMinor, effectiveRateMicros);

  const changeDueInTargetCurrencyMinor =
    ordCurr === tgtCurr
      ? changeDueMinor
      : convertCurrencyMinor(changeDueMinor, effectiveRateMicros);

  return {
    orderCurrency: ordCurr,
    targetCurrency: tgtCurr,
    rateMicros: effectiveRateMicros,
    orderTotalMinor: totalMinor,
    paidInOrderCurrencyMinor,
    remainingInOrderCurrencyMinor,
    remainingInTargetCurrencyMinor,
    changeDueMinor,
    changeDueInTargetCurrencyMinor,
    isSettled: remainingOrderBig === 0n,
  };
}

/**
 * Computes tax-inclusive integer pricing and optional secondary currency totals.
 */
export function computeTaxInclusiveAmounts(
  unitPriceExclTaxMinor: number,
  qty: number,
  taxRateBps: number,
  rateMicros?: number | null,
): TaxInclusiveAmountResult {
  const unitPrice = assertNonNegativeSafeInt(
    unitPriceExclTaxMinor,
    'unitPriceExclTaxMinor',
  );
  if (!Number.isSafeInteger(qty) || qty <= 0) {
    throw new AppError('INVALID_INTEGER_MONEY', 400, 'qty must be a positive safe integer');
  }
  const bps = assertNonNegativeSafeInt(taxRateBps, 'taxRateBps');
  if (bps > 10_000) {
    throw new AppError('VALIDATION_ERROR', 400, 'taxRateBps cannot exceed 10000');
  }

  const lineSubtotalMinor = toSafeInt(
    BigInt(unitPrice) * BigInt(qty),
    'lineSubtotalMinor',
  );
  const unitTaxMinor = computeBpsAmount(unitPrice, bps);
  const unitPriceInclTaxMinor = toSafeInt(
    BigInt(unitPrice) + BigInt(unitTaxMinor),
    'unitPriceInclTaxMinor',
  );
  const lineTaxMinor = computeBpsAmount(lineSubtotalMinor, bps);
  const lineTotalMinor = toSafeInt(
    BigInt(lineSubtotalMinor) + BigInt(lineTaxMinor),
    'lineTotalMinor',
  );

  let secondaryUnitPriceInclTaxMinor: number | null = null;
  let secondaryLineTotalMinor: number | null = null;
  if (rateMicros !== undefined && rateMicros !== null) {
    const validRate = assertPositiveRateMicros(rateMicros, 'rateMicros');
    secondaryUnitPriceInclTaxMinor = convertCurrencyMinor(
      unitPriceInclTaxMinor,
      validRate,
    );
    secondaryLineTotalMinor = convertCurrencyMinor(lineTotalMinor, validRate);
  }

  return {
    unitPriceExclTaxMinor: unitPrice,
    unitTaxMinor,
    unitPriceInclTaxMinor,
    lineSubtotalMinor,
    lineTaxMinor,
    lineTotalMinor,
    secondaryUnitPriceInclTaxMinor,
    secondaryLineTotalMinor,
  };
}
