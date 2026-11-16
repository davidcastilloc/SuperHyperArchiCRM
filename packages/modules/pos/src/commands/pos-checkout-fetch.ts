import {
  assertOrgScope,
  catCurrenciesAndRates,
  catProducts,
  catVariantsAndPresentations,
  crmParties,
  iamOrganizations,
} from '@shac/db-d1';
import { AppError } from '@shac/kernel';
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { z } from 'zod';
import type { PosCtx } from '../lib/pos-helpers.js';
import type { posSalesCheckoutInputSchema } from './pos-schemas.js';

export async function fetchCheckoutCatalogAndOrg(
  ctx: PosCtx,
  input: z.infer<typeof posSalesCheckoutInputSchema>,
  nowSec: number,
) {
  const productIds = Array.from(new Set(input.items.map((i) => i.productId)));
  const variantIds = Array.from(
    new Set(
      input.items
        .map((i) => i.variantId)
        .filter((v): v is string => Boolean(v && v !== 'default')),
    ),
  );
  const effectiveVariantIds = variantIds.length > 0 ? variantIds : ['__none__'];
  const targetOrgLookupId =
    input.orgId && input.orgId !== ctx.orgId ? input.orgId : '__none__';
  const partyLookupId = input.partyId ?? '__none__';

  const [productRows, variantRows, rateRows, orgRows, partyRows] =
    await ctx.db.batch([
      ctx.db
        .select({
          id: catProducts.id,
          tenantId: catProducts.tenantId,
          sku: catProducts.sku,
          name: catProducts.name,
          itemKind: catProducts.itemKind,
          salesUom: catProducts.salesUom,
          basePriceMinor: catProducts.basePriceMinor,
          costPriceMinor: catProducts.costPriceMinor,
          primaryCurrency: catProducts.primaryCurrency,
          taxClass: catProducts.taxClass,
          taxRateBps: catProducts.taxRateBps,
        })
        .from(catProducts)
        .where(
          and(
            eq(catProducts.tenantId, ctx.tenantId),
            inArray(catProducts.id, productIds),
            eq(catProducts.isActive, true),
            isNull(catProducts.deletedAt),
          ),
        ),
      ctx.db
        .select({
          id: catVariantsAndPresentations.id,
          productId: catVariantsAndPresentations.productId,
          sku: catVariantsAndPresentations.sku,
          presentationName: catVariantsAndPresentations.presentationName,
          uomFactorMicros: catVariantsAndPresentations.uomFactorMicros,
          overridePriceMinor: catVariantsAndPresentations.overridePriceMinor,
        })
        .from(catVariantsAndPresentations)
        .where(
          and(
            eq(catVariantsAndPresentations.tenantId, ctx.tenantId),
            inArray(catVariantsAndPresentations.id, effectiveVariantIds),
            eq(catVariantsAndPresentations.isActive, true),
            isNull(catVariantsAndPresentations.deletedAt),
          ),
        ),
      ctx.db
        .select({
          fromCurrency: catCurrenciesAndRates.fromCurrency,
          toCurrency: catCurrenciesAndRates.toCurrency,
          rateMicros: catCurrenciesAndRates.rateMicros,
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
        .limit(20),
      ctx.db
        .select({
          id: iamOrganizations.id,
          tenantId: iamOrganizations.tenantId,
          treePath: iamOrganizations.treePath,
        })
        .from(iamOrganizations)
        .where(
          and(
            eq(iamOrganizations.id, targetOrgLookupId),
            isNull(iamOrganizations.deletedAt),
          ),
        )
        .limit(1),
      ctx.db
        .select({ id: crmParties.id, tenantId: crmParties.tenantId })
        .from(crmParties)
        .where(and(eq(crmParties.id, partyLookupId), isNull(crmParties.deletedAt)))
        .limit(1),
    ]);

  let targetOrgId = ctx.orgId;
  if (input.orgId && input.orgId !== ctx.orgId) {
    const org = orgRows[0];
    if (!org) {
      throw new AppError('NOT_FOUND', 404, 'Target organization not found');
    }
    assertOrgScope(ctx, org.tenantId, org.treePath);
    targetOrgId = org.id;
  }

  if (input.partyId) {
    const party = partyRows[0];
    if (!party || party.tenantId !== ctx.tenantId) {
      throw new AppError('NOT_FOUND', 404, 'Customer party not found');
    }
  }

  return { targetOrgId, productRows, variantRows, rateRows };
}
