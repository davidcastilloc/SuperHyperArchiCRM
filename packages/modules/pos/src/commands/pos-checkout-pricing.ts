import { AppError } from '@shac/kernel';
import {
  computeBpsAmount,
  computeMarginBps,
  convertCurrencyMinor,
  MICROS_SCALE,
  multiplyMicros,
} from '@shac/mod-catalog';
import type { z } from 'zod';
import { computeTaxInclusiveAmounts } from '../tender-engine.js';
import type { posCheckoutLineInputSchema } from './pos-schemas.js';

export interface CheckoutProductRow {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  itemKind: string;
  salesUom: string;
  basePriceMinor: number;
  costPriceMinor: number;
  primaryCurrency: string;
  taxClass: string;
  taxRateBps: number;
}

export interface CheckoutVariantRow {
  id: string;
  productId: string;
  sku: string;
  presentationName: string;
  uomFactorMicros: number;
  overridePriceMinor: number | null;
}

export interface CheckoutRateRow {
  fromCurrency: string;
  toCurrency: string;
  rateMicros: number;
}

export interface PreparedOrderLine {
  lineNo: number;
  productId: string;
  variantId: string | null;
  doVariantId: string;
  sku: string;
  name: string;
  presentationName: string;
  qty: number;
  qtyMicros: number;
  uom: string;
  unitCostMinor: number;
  basePriceMinor: number;
  unitPriceMinor: number;
  pricingSourceLayer: string;
  manualDiscountBps: number;
  taxRateBps: number;
  taxMinor: number;
  lineSubtotalMinor: number;
  lineTotalMinor: number;
  trackInventory: boolean;
  binCode?: string;
}

export function findRateMicros(
  rateRows: readonly CheckoutRateRow[],
  fromCurrency: string,
  toCurrency: string,
): number | null {
  if (fromCurrency === toCurrency) return MICROS_SCALE;
  const hit = rateRows.find(
    (r) => r.fromCurrency === fromCurrency && r.toCurrency === toCurrency,
  );
  return hit ? hit.rateMicros : null;
}

export function prepareCheckoutLines(params: {
  items: readonly z.infer<typeof posCheckoutLineInputSchema>[];
  productMap: ReadonlyMap<string, CheckoutProductRow>;
  variantMap: ReadonlyMap<string, CheckoutVariantRow>;
  rateRows: readonly CheckoutRateRow[];
  orderCurrency: string;
  allowBelowCost: boolean;
}) {
  let subtotalExemptBig = 0n;
  let subtotalReducedBig = 0n;
  let subtotalGeneralBig = 0n;
  let discountBig = 0n;
  let taxGeneralBig = 0n;
  let taxReducedBig = 0n;
  let revenueExclBig = 0n;
  let costBig = 0n;

  const lines: PreparedOrderLine[] = [];

  for (let i = 0; i < params.items.length; i++) {
    const item = params.items[i]!;
    const product = params.productMap.get(item.productId);
    if (!product) {
      throw new AppError('NOT_FOUND', 404, `Product ${item.productId} not found`);
    }

    const variant =
      item.variantId && item.variantId !== 'default'
        ? params.variantMap.get(item.variantId)
        : undefined;
    if (item.variantId && item.variantId !== 'default' && !variant) {
      throw new AppError('NOT_FOUND', 404, `Variant ${item.variantId} not found`);
    }
    if (variant && variant.productId !== product.id) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        `Variant ${variant.id} does not belong to product ${product.id}`,
      );
    }

    let prodBaseMinor = product.basePriceMinor;
    let prodCostMinor = product.costPriceMinor;
    if (product.primaryCurrency !== params.orderCurrency) {
      const fx = findRateMicros(
        params.rateRows,
        product.primaryCurrency,
        params.orderCurrency,
      );
      if (fx === null) {
        throw new AppError(
          'FX_RATE_NOT_FOUND',
          404,
          `No active FX rate found for ${product.primaryCurrency}->${params.orderCurrency}`,
        );
      }
      prodBaseMinor = convertCurrencyMinor(prodBaseMinor, fx);
      prodCostMinor = convertCurrencyMinor(prodCostMinor, fx);
    }

    const uomFactorMicros = variant?.uomFactorMicros ?? MICROS_SCALE;
    const unitCostMinor = variant
      ? multiplyMicros(prodCostMinor, uomFactorMicros)
      : prodCostMinor;

    const rawBaseMinor =
      variant?.overridePriceMinor != null
        ? variant.overridePriceMinor
        : variant
          ? multiplyMicros(prodBaseMinor, uomFactorMicros)
          : prodBaseMinor;

    const referenceUnitMinor = item.unitPriceMinor ?? rawBaseMinor;
    const unitDiscountMinor = computeBpsAmount(
      referenceUnitMinor,
      item.manualDiscountBps,
    );
    const netUnitPriceMinor = referenceUnitMinor - unitDiscountMinor;

    if (
      unitCostMinor > 0 &&
      !params.allowBelowCost &&
      netUnitPriceMinor < unitCostMinor
    ) {
      throw new AppError(
        'BELOW_MARGIN_FLOOR',
        422,
        `BELOW_MARGIN_FLOOR: SKU ${product.sku} net unit price ${netUnitPriceMinor} is below cost ${unitCostMinor}`,
      );
    }

    const taxRateBps = item.taxRateBps ?? product.taxRateBps;
    const amounts = computeTaxInclusiveAmounts(
      netUnitPriceMinor,
      item.qty,
      taxRateBps,
    );

    const qtyMicros = Number(BigInt(item.qty) * BigInt(uomFactorMicros));
    if (!Number.isSafeInteger(qtyMicros)) {
      throw new AppError('INTEGER_OVERFLOW', 400, 'qtyMicros overflow');
    }

    if (taxRateBps === 0 || product.taxClass === 'EXEMPT') {
      subtotalExemptBig += BigInt(amounts.lineSubtotalMinor);
    } else if (product.taxClass === 'REDUCED' || taxRateBps === 800) {
      subtotalReducedBig += BigInt(amounts.lineSubtotalMinor);
      taxReducedBig += BigInt(amounts.lineTaxMinor);
    } else {
      subtotalGeneralBig += BigInt(amounts.lineSubtotalMinor);
      taxGeneralBig += BigInt(amounts.lineTaxMinor);
    }

    discountBig += BigInt(unitDiscountMinor) * BigInt(item.qty);
    revenueExclBig += BigInt(amounts.lineSubtotalMinor);
    costBig += BigInt(unitCostMinor) * BigInt(item.qty);

    lines.push({
      lineNo: i + 1,
      productId: product.id,
      variantId: variant?.id ?? null,
      doVariantId: variant?.id ?? 'default',
      sku: variant?.sku ?? product.sku,
      name: product.name,
      presentationName: variant?.presentationName ?? 'UNIDAD',
      qty: item.qty,
      qtyMicros,
      uom: product.salesUom,
      unitCostMinor,
      basePriceMinor: rawBaseMinor,
      unitPriceMinor: netUnitPriceMinor,
      pricingSourceLayer:
        item.unitPriceMinor !== undefined
          ? 'MANUAL_OVERRIDE'
          : variant?.overridePriceMinor != null
            ? 'VARIANT_UOM'
            : 'BASE_PRICE',
      manualDiscountBps: item.manualDiscountBps,
      taxRateBps,
      taxMinor: amounts.lineTaxMinor,
      lineSubtotalMinor: amounts.lineSubtotalMinor,
      lineTotalMinor: amounts.lineTotalMinor,
      trackInventory: item.trackInventory ?? product.itemKind === 'physical',
      binCode: item.binCode,
    });
  }

  const revenueExclTaxMinor = Number(revenueExclBig);
  const totalCostMinor = Number(costBig);

  return {
    lines,
    subtotalExemptMinor: Number(subtotalExemptBig),
    subtotalReducedMinor: Number(subtotalReducedBig),
    subtotalGeneralMinor: Number(subtotalGeneralBig),
    discountMinor: Number(discountBig),
    taxGeneralMinor: Number(taxGeneralBig),
    taxReducedMinor: Number(taxReducedBig),
    revenueExclTaxMinor,
    totalCostMinor,
    marginBps: computeMarginBps(revenueExclTaxMinor, totalCostMinor),
  };
}
