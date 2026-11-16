import {
  catCurrenciesAndRates,
  catPriceHistoryOmnibus,
  catPriceLists,
  catPriceRules,
  catProducts,
  catVariantsAndPresentations,
  crmGroupMemberships,
  crmGroupsAndTerms,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand } from '@shac/kernel';
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import type { z } from 'zod';
import {
  OMNIBUS_WINDOW_SEC,
  resolveFiveLayerPrice,
} from '../pricing-engine.js';
import {
  quotePriceInputSchema,
  quotePriceOutputSchema,
} from './quote-price-schemas.js';

export const catalogPricingQuoteCommand = defineCommand<
  typeof quotePriceInputSchema,
  z.infer<typeof quotePriceOutputSchema>,
  ShacD1Database
>({
  id: 'catalog.pricing.quote',
  moduleId: 'catalog',
  method: 'POST',
  path: '/api/catalog/pricing/quote',
  summary: 'Quote a 5-layer price with margin floor, FX conversion & 30d Omnibus lowest',
  requiredPermission: 'catalog.pricing.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description:
      'Fetch product, variant, rules, FX rate & 30d Omnibus history in 1 batch and compute integer 5-layer quote',
  },
  inputSchema: quotePriceInputSchema,
  outputSchema: quotePriceOutputSchema,
  async handler(ctx, input) {
    const nowSec = input.asOfSec ?? Math.floor(Date.now() / 1000);
    const windowStart = nowSec - OMNIBUS_WINDOW_SEC;
    const secondaryUpper = input.secondaryCurrency?.toUpperCase() ?? '__none__';

    const productQuery = ctx.db
      .select()
      .from(catProducts)
      .where(
        and(
          eq(catProducts.tenantId, ctx.tenantId),
          eq(catProducts.id, input.productId),
          eq(catProducts.isActive, true),
          isNull(catProducts.deletedAt),
        ),
      )
      .limit(1);

    const variantQuery = ctx.db
      .select()
      .from(catVariantsAndPresentations)
      .where(
        and(
          eq(catVariantsAndPresentations.tenantId, ctx.tenantId),
          eq(catVariantsAndPresentations.productId, input.productId),
          eq(catVariantsAndPresentations.id, input.variantId ?? '__none__'),
          eq(catVariantsAndPresentations.isActive, true),
          isNull(catVariantsAndPresentations.deletedAt),
        ),
      )
      .limit(1);

    const rulesQuery = ctx.db
      .select({
        id: catPriceRules.id,
        priceListId: catPriceRules.priceListId,
        tariffKind: catPriceLists.tariffKind,
        priceListCurrency: catPriceLists.currency,
        priceListIsDefault: catPriceLists.isDefault,
        priceListIsActive: catPriceLists.isActive,
        priceListValidFrom: catPriceLists.validFrom,
        priceListValidTo: catPriceLists.validTo,
        variantId: catPriceRules.variantId,
        targetPartyId: catPriceRules.targetPartyId,
        targetGroupId: catPriceRules.targetGroupId,
        channelId: catPriceRules.channelId,
        minQty: catPriceRules.minQty,
        maxQty: catPriceRules.maxQty,
        unitPriceMinor: catPriceRules.unitPriceMinor,
        discountBps: catPriceRules.discountBps,
        startsAt: catPriceRules.startsAt,
        endsAt: catPriceRules.endsAt,
      })
      .from(catPriceRules)
      .leftJoin(
        catPriceLists,
        and(
          eq(catPriceRules.priceListId, catPriceLists.id),
          eq(catPriceLists.tenantId, ctx.tenantId),
          isNull(catPriceLists.deletedAt),
        ),
      )
      .where(
        and(
          eq(catPriceRules.tenantId, ctx.tenantId),
          eq(catPriceRules.productId, input.productId),
          isNull(catPriceRules.deletedAt),
        ),
      );

    const fxQuery = ctx.db
      .select()
      .from(catCurrenciesAndRates)
      .where(
        and(
          eq(catCurrenciesAndRates.tenantId, ctx.tenantId),
          eq(catCurrenciesAndRates.toCurrency, secondaryUpper),
          eq(catCurrenciesAndRates.isActive, true),
          lte(catCurrenciesAndRates.effectiveAt, nowSec),
        ),
      )
      .orderBy(desc(catCurrenciesAndRates.effectiveAt))
      .limit(10);

    const omnibusQuery = ctx.db
      .select()
      .from(catPriceHistoryOmnibus)
      .where(
        and(
          eq(catPriceHistoryOmnibus.tenantId, ctx.tenantId),
          eq(catPriceHistoryOmnibus.productId, input.productId),
          gte(catPriceHistoryOmnibus.recordedAt, windowStart),
          lte(catPriceHistoryOmnibus.recordedAt, nowSec),
        ),
      );

    const groupsQuery = ctx.db
      .select({
        groupId: crmGroupsAndTerms.id,
        priceListId: crmGroupsAndTerms.priceListId,
        allowBelowCost: crmGroupsAndTerms.allowBelowCost,
        validFrom: crmGroupMemberships.validFrom,
        validUntil: crmGroupMemberships.validUntil,
      })
      .from(crmGroupMemberships)
      .innerJoin(
        crmGroupsAndTerms,
        and(
          eq(crmGroupMemberships.groupId, crmGroupsAndTerms.id),
          eq(crmGroupsAndTerms.tenantId, ctx.tenantId),
          isNull(crmGroupsAndTerms.deletedAt),
        ),
      )
      .where(
        and(
          eq(crmGroupMemberships.tenantId, ctx.tenantId),
          eq(crmGroupMemberships.partyId, input.partyId ?? '__none__'),
          isNull(crmGroupMemberships.deletedAt),
        ),
      )
      .orderBy(asc(crmGroupsAndTerms.priority));

    const [
      productRows,
      variantRows,
      ruleRows,
      fxRows,
      omnibusRows,
      groupRows,
    ] = await ctx.db.batch([
      productQuery,
      variantQuery,
      rulesQuery,
      fxQuery,
      omnibusQuery,
      groupsQuery,
    ]);

    const product = productRows[0];
    if (!product) {
      throw new AppError('NOT_FOUND', 404, 'Product not found');
    }

    const variant = input.variantId ? (variantRows[0] ?? null) : null;
    if (input.variantId && !variant) {
      throw new AppError('NOT_FOUND', 404, 'Variant not found');
    }

    const activeGroups = groupRows.filter(
      (g) =>
        (g.validFrom == null || nowSec >= g.validFrom) &&
        (g.validUntil == null || nowSec <= g.validUntil),
    );
    const mergedGroupIds = Array.from(
      new Set([...(input.groupIds ?? []), ...activeGroups.map((g) => g.groupId)]),
    );
    const effectivePriceListId =
      input.priceListId ??
      activeGroups.find((g) => g.priceListId != null)?.priceListId ??
      null;
    const effectiveAllowBelowCost =
      input.allowBelowCost ?? activeGroups.some((g) => g.allowBelowCost);

    let fxRate: { secondaryCurrency: string; rateMicros: number } | null = null;
    if (input.secondaryCurrency) {
      const targetCurr = input.secondaryCurrency.toUpperCase();
      if (targetCurr === product.primaryCurrency) {
        fxRate = { secondaryCurrency: targetCurr, rateMicros: 1_000_000 };
      } else {
        const matchedFx = fxRows.find(
          (r) =>
            r.fromCurrency === product.primaryCurrency &&
            r.toCurrency === targetCurr,
        );
        if (!matchedFx) {
          throw new AppError(
            'FX_RATE_NOT_FOUND',
            404,
            `No active FX rate found for ${product.primaryCurrency}->${targetCurr}`,
          );
        }
        fxRate = { secondaryCurrency: targetCurr, rateMicros: matchedFx.rateMicros };
      }
    }

    const currencyOmnibus = omnibusRows.filter(
      (row) => row.currency === product.primaryCurrency,
    );
    const matchingOmnibus = variant
      ? currencyOmnibus.filter((row) => row.variantId === variant.id)
      : currencyOmnibus.filter((row) => row.variantId == null);

    const result = resolveFiveLayerPrice({
      product: {
        id: product.id,
        basePriceMinor: product.basePriceMinor,
        costPriceMinor: product.costPriceMinor,
        primaryCurrency: product.primaryCurrency,
        taxRateBps: product.taxRateBps,
        isFixedPrice: product.isFixedPrice,
      },
      variant: variant
        ? {
            id: variant.id,
            uomFactorMicros: variant.uomFactorMicros,
            overridePriceMinor: variant.overridePriceMinor,
          }
        : null,
      qty: input.qty,
      nowSec,
      partyId: input.partyId ?? null,
      groupIds: mergedGroupIds,
      priceListId: effectivePriceListId,
      tariffKind: input.tariffKind ?? null,
      channelId: input.channelId ?? null,
      rules: ruleRows,
      allowBelowCost: effectiveAllowBelowCost,
      minMarginBps: input.minMarginBps,
      fxRate,
      omnibusHistory: matchingOmnibus,
    });

    return {
      productId: product.id,
      variantId: variant?.id ?? null,
      ...result,
    };
  },
});
