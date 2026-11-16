import { AppError } from '@shac/kernel';
import {
  assertSafeInt,
  computeBpsAmount,
  computeLowest30dMinor,
  computeMarginBps,
  convertCurrencyMinor,
  MICROS_SCALE,
  multiplyMicros,
} from './pricing-math.js';
import { isRuleEligible, pickWinningLayer } from './pricing-rules.js';
import type {
  PricingEngineInput,
  PricingEngineResult,
  PricingLayer,
} from './pricing-types.js';

export type { OmnibusPricePoint } from './pricing-math.js';
export type {
  PricingEngineInput,
  PricingEngineResult,
  PricingLayer,
  PricingProductInput,
  PricingRuleCandidate,
  PricingVariantInput,
  SecondaryFxRateInput,
} from './pricing-types.js';
export {
  BPS_SCALE,
  computeBpsAmount,
  computeLowest30dMinor,
  computeMarginBps,
  convertCurrencyMinor,
  MICROS_SCALE,
  multiplyMicros,
  OMNIBUS_WINDOW_SEC,
} from './pricing-math.js';

/** Pure integer 5-layer pricing cascade with margin floor, FX conversion & Omnibus 30d. */
export function resolveFiveLayerPrice(
  input: PricingEngineInput,
): PricingEngineResult {
  const basePriceMinor = assertSafeInt(input.product.basePriceMinor, 'basePriceMinor');
  const baseCostMinor = assertSafeInt(input.product.costPriceMinor, 'costPriceMinor');
  const taxRateBps = assertSafeInt(input.product.taxRateBps, 'taxRateBps');
  if (basePriceMinor < 0 || baseCostMinor < 0 || taxRateBps < 0) {
    throw new AppError(
      'INVALID_INTEGER_MONEY',
      400,
      'Base price, cost price, and taxRateBps must be non-negative integers',
    );
  }

  const qty = assertSafeInt(input.qty ?? 1, 'qty');
  if (qty <= 0) {
    throw new AppError('INVALID_QUANTITY', 400, 'qty must be a positive integer');
  }
  const nowSec = assertSafeInt(
    input.nowSec ?? Math.floor(Date.now() / 1000),
    'nowSec',
  );
  const variant = input.variant ?? null;
  const uomFactorMicros = assertSafeInt(
    variant?.uomFactorMicros ?? MICROS_SCALE,
    'uomFactorMicros',
  );
  if (uomFactorMicros <= 0) {
    throw new AppError('INVALID_UOM_FACTOR', 400, 'uomFactorMicros must be positive');
  }

  const unitCostMinor =
    uomFactorMicros === MICROS_SCALE
      ? baseCostMinor
      : multiplyMicros(baseCostMinor, uomFactorMicros);

  let baselinePriceMinor = basePriceMinor;
  let baselineLayer: PricingLayer = 'BASE_PRICE';
  if (variant?.overridePriceMinor !== null && variant?.overridePriceMinor !== undefined) {
    baselinePriceMinor = assertSafeInt(variant.overridePriceMinor, 'overridePriceMinor');
    baselineLayer = 'VARIANT_UOM';
  } else if (variant && uomFactorMicros !== MICROS_SCALE) {
    baselinePriceMinor = multiplyMicros(basePriceMinor, uomFactorMicros);
    baselineLayer = 'VARIANT_UOM';
  }

  const eligibleRules = (input.rules ?? []).filter((rule) =>
    isRuleEligible(
      rule,
      nowSec,
      qty,
      variant?.id ?? null,
      input.product.primaryCurrency,
    ),
  );
  const chosen = pickWinningLayer(
    eligibleRules,
    input,
    baselinePriceMinor,
    baselineLayer,
    uomFactorMicros,
  );

  const marginBps = computeMarginBps(chosen.unitPriceMinor, unitCostMinor);
  const minMarginBps = assertSafeInt(input.minMarginBps ?? 0, 'minMarginBps');
  const allowBelowCost = input.allowBelowCost ?? false;
  if (
    !allowBelowCost &&
    (chosen.unitPriceMinor < unitCostMinor || marginBps < minMarginBps)
  ) {
    throw new AppError(
      'BELOW_MARGIN_FLOOR',
      422,
      `Quoted unit price ${chosen.unitPriceMinor} violates margin floor`,
      {
        unitPriceMinor: chosen.unitPriceMinor,
        unitCostMinor,
        marginBps,
        minMarginBps,
        appliedLayer: chosen.appliedLayer,
      },
    );
  }

  const unitTaxMinor = computeBpsAmount(chosen.unitPriceMinor, taxRateBps);
  const unitPriceWithTaxMinor = chosen.unitPriceMinor + unitTaxMinor;
  const lineSubtotalMinor = chosen.unitPriceMinor * qty;
  assertSafeInt(lineSubtotalMinor, 'lineSubtotalMinor');
  const lineTaxMinor = computeBpsAmount(lineSubtotalMinor, taxRateBps);
  const lineTotalMinor = lineSubtotalMinor + lineTaxMinor;

  const fxRate = input.fxRate ?? null;
  const rateMicros = fxRate ? assertSafeInt(fxRate.rateMicros, 'rateMicros') : null;
  const lowest30dMinor =
    input.lowest30dMinor !== undefined && input.lowest30dMinor !== null
      ? assertSafeInt(input.lowest30dMinor, 'lowest30dMinor')
      : input.omnibusHistory
        ? computeLowest30dMinor(input.omnibusHistory, nowSec)
        : null;

  return {
    unitPriceMinor: chosen.unitPriceMinor,
    unitCostMinor,
    baseReferencePriceMinor: baselinePriceMinor,
    appliedLayer: chosen.appliedLayer,
    appliedRuleId: chosen.appliedRuleId,
    appliedPriceListId: chosen.appliedPriceListId,
    marginBps,
    taxRateBps,
    unitTaxMinor,
    unitPriceWithTaxMinor,
    qty,
    lineSubtotalMinor,
    lineTaxMinor,
    lineTotalMinor,
    primaryCurrency: input.product.primaryCurrency,
    secondaryCurrency: fxRate ? fxRate.secondaryCurrency : null,
    rateMicros,
    secondaryUnitPriceMinor: rateMicros
      ? convertCurrencyMinor(chosen.unitPriceMinor, rateMicros)
      : null,
    secondaryUnitPriceWithTaxMinor: rateMicros
      ? convertCurrencyMinor(unitPriceWithTaxMinor, rateMicros)
      : null,
    secondaryLineTotalMinor: rateMicros
      ? convertCurrencyMinor(lineTotalMinor, rateMicros)
      : null,
    lowest30dMinor,
    isBelow30dLowest:
      lowest30dMinor !== null && chosen.unitPriceMinor < lowest30dMinor,
  };
}
