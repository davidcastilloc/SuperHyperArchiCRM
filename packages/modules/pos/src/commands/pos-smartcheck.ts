import {
  assertOrgScope,
  catCurrenciesAndRates,
  catProducts,
  catVariantsAndPresentations,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand } from '@shac/kernel';
import { MICROS_SCALE, multiplyMicros } from '@shac/mod-catalog';
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { computeTaxInclusiveAmounts } from '../tender-engine.js';
import {
  posKioskSmartCheckInputSchema,
  posKioskSmartCheckOutputSchema,
} from './pos-schemas.js';

export const posKioskSmartCheckCommand = defineCommand<
  typeof posKioskSmartCheckInputSchema,
  z.infer<typeof posKioskSmartCheckOutputSchema>,
  ShacD1Database
>({
  id: 'pos.kiosk.smartcheck',
  moduleId: 'pos',
  method: 'GET',
  path: '/api/pos/kiosk/smartcheck',
  summary:
    'Look up tax-inclusive primary and secondary prices for the 10s SmartCheck kiosk in <= 2 D1 queries',
  requiredPermission: 'pos.kiosk.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description:
      'Fetch tax-inclusive product prices in primary and secondary currency with autoCloseSeconds=10 in a single D1 batch',
  },
  inputSchema: posKioskSmartCheckInputSchema,
  outputSchema: posKioskSmartCheckOutputSchema,
  async handler(ctx, input) {
    assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);
    const nowSec = input.asOfSec ?? Math.floor(Date.now() / 1000);
    const code = input.code?.trim();

    const itemMatchFilter = input.productId
      ? eq(catProducts.id, input.productId)
      : or(
          eq(catProducts.sku, code!),
          eq(catProducts.gtin, code!),
          eq(catVariantsAndPresentations.sku, code!),
          eq(catVariantsAndPresentations.barcode, code!),
        )!;

    // Explicit SQL AS aliases on LEFT JOIN prevent D1 batch homonym collisions.
    const itemQuery = ctx.db
      .select({
        productId: catProducts.id,
        productSku: catProducts.sku,
        productGtin: catProducts.gtin,
        productName: catProducts.name,
        basePriceMinor: catProducts.basePriceMinor,
        primaryCurrency: catProducts.primaryCurrency,
        taxRateBps: catProducts.taxRateBps,
        variantId: sql<string | null>`${catVariantsAndPresentations.id}`.as(
          'variant_id',
        ),
        variantSku: sql<string | null>`${catVariantsAndPresentations.sku}`.as(
          'variant_sku',
        ),
        variantBarcode: catVariantsAndPresentations.barcode,
        presentationName: catVariantsAndPresentations.presentationName,
        uomFactorMicros: catVariantsAndPresentations.uomFactorMicros,
        overridePriceMinor: catVariantsAndPresentations.overridePriceMinor,
        variantIsDefault: catVariantsAndPresentations.isDefault,
      })
      .from(catProducts)
      .leftJoin(
        catVariantsAndPresentations,
        and(
          eq(catVariantsAndPresentations.productId, catProducts.id),
          eq(catVariantsAndPresentations.tenantId, ctx.tenantId),
          eq(catVariantsAndPresentations.isActive, true),
          isNull(catVariantsAndPresentations.deletedAt),
        ),
      )
      .where(
        and(
          eq(catProducts.tenantId, ctx.tenantId),
          eq(catProducts.isActive, true),
          isNull(catProducts.deletedAt),
          itemMatchFilter,
        ),
      )
      .limit(10);

    const ratesQuery = ctx.db
      .select({
        rateId: catCurrenciesAndRates.id,
        fromCurrency: catCurrenciesAndRates.fromCurrency,
        toCurrency: catCurrenciesAndRates.toCurrency,
        rateMicros: catCurrenciesAndRates.rateMicros,
        source: catCurrenciesAndRates.source,
        effectiveAt: catCurrenciesAndRates.effectiveAt,
      })
      .from(catCurrenciesAndRates)
      .where(
        and(
          eq(catCurrenciesAndRates.tenantId, ctx.tenantId),
          eq(catCurrenciesAndRates.isActive, true),
          lte(catCurrenciesAndRates.effectiveAt, nowSec),
        ),
      )
      .orderBy(desc(catCurrenciesAndRates.effectiveAt))
      .limit(20);

    const [matchedRows, rateRows] = await ctx.db.batch([itemQuery, ratesQuery]);
    if (matchedRows.length === 0) {
      throw new AppError(
        'NOT_FOUND',
        404,
        'Product not found for SmartCheck kiosk',
      );
    }

    const picked =
      (code
        ? matchedRows.find(
            (r) => r.variantBarcode === code || r.variantSku === code,
          )
        : undefined) ??
      matchedRows.find((r) => r.variantIsDefault) ??
      matchedRows[0]!;

    const useVariantPricing =
      Boolean(picked.variantId) &&
      Boolean(code) &&
      (picked.variantBarcode === code || picked.variantSku === code);

    const unitPriceExclTaxMinor =
      useVariantPricing && picked.overridePriceMinor != null
        ? picked.overridePriceMinor
        : useVariantPricing && picked.uomFactorMicros != null
          ? multiplyMicros(picked.basePriceMinor, picked.uomFactorMicros)
          : picked.basePriceMinor;

    const desiredSecondary =
      input.secondaryCurrency ??
      ctx.profile.currency.operatingCurrencies
        .map((c) => c.toUpperCase())
        .find((c) => c !== picked.primaryCurrency) ??
      null;

    let effectiveRateMicros: number | null = null;
    let rateSource: string | null = null;
    if (desiredSecondary) {
      if (desiredSecondary === picked.primaryCurrency) {
        effectiveRateMicros = MICROS_SCALE;
        rateSource = 'PARITY';
      } else {
        const rateRow = rateRows.find(
          (r) =>
            r.fromCurrency === picked.primaryCurrency &&
            r.toCurrency === desiredSecondary,
        );
        if (rateRow) {
          effectiveRateMicros = rateRow.rateMicros;
          rateSource = rateRow.source;
        }
      }
    }

    const amounts = computeTaxInclusiveAmounts(
      unitPriceExclTaxMinor,
      input.qty,
      picked.taxRateBps,
      effectiveRateMicros,
    );

    return {
      autoCloseSeconds: 10,
      productId: picked.productId,
      variantId: picked.variantId,
      sku: picked.variantSku ?? picked.productSku,
      gtin: picked.productGtin,
      barcode: picked.variantBarcode,
      name: picked.productName,
      presentationName: picked.presentationName ?? 'UNIDAD',
      qty: input.qty,
      primaryCurrency: picked.primaryCurrency,
      taxRateBps: picked.taxRateBps,
      unitPriceExclTaxMinor: amounts.unitPriceExclTaxMinor,
      unitTaxMinor: amounts.unitTaxMinor,
      unitPriceInclTaxMinor: amounts.unitPriceInclTaxMinor,
      lineTotalMinor: amounts.lineTotalMinor,
      secondaryCurrency: desiredSecondary,
      rateMicros: effectiveRateMicros,
      rateSource,
      secondaryUnitPriceInclTaxMinor: amounts.secondaryUnitPriceInclTaxMinor,
      secondaryLineTotalMinor: amounts.secondaryLineTotalMinor,
    };
  },
});
