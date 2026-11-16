import {
  assertOrgScope,
  buildActionLogInsert,
  buildIdempotencyInsert,
  catPriceHistoryOmnibus,
  catProducts,
  catVariantsAndPresentations,
  checkIdempotency,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { multiplyMicros } from '../pricing-engine.js';
import {
  buildProductSummary,
  upsertProductInputSchema,
  upsertProductOutputSchema,
} from './products-schemas.js';

export const catalogProductsUpsertCommand = defineCommand<
  typeof upsertProductInputSchema,
  z.infer<typeof upsertProductOutputSchema>,
  ShacD1Database
>({
  id: 'catalog.products.upsert',
  moduleId: 'catalog',
  method: 'POST',
  path: '/api/catalog/products',
  summary: 'Create or update a catalog product and optional default variant/UOM',
  requiredPermission: 'catalog.products.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Upsert a product with integer pricing and optional default UOM presentation',
  },
  inputSchema: upsertProductInputSchema,
  outputSchema: upsertProductOutputSchema,
  async handler(ctx, input) {
    const primaryCurrency = input.primaryCurrency.toUpperCase();
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'catalog.products.upsert',
        ...input,
        primaryCurrency,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      upsertProductOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = input.orgId ?? ctx.orgId;
    if (targetOrgId !== ctx.orgId) {
      const orgRows = await ctx.db
        .select({
          tenantId: iamOrganizations.tenantId,
          treePath: iamOrganizations.treePath,
        })
        .from(iamOrganizations)
        .where(
          and(
            eq(iamOrganizations.tenantId, ctx.tenantId),
            eq(iamOrganizations.id, targetOrgId),
            isNull(iamOrganizations.deletedAt),
          ),
        )
        .limit(1);
      const targetOrg = orgRows[0];
      if (!targetOrg) {
        throw new AppError('NOT_FOUND', 404, 'Organization not found');
      }
      assertOrgScope(ctx, targetOrg.tenantId, targetOrg.treePath);
    } else {
      assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);
    }

    const existingProductRows = await ctx.db
      .select()
      .from(catProducts)
      .where(
        input.id
          ? eq(catProducts.id, input.id)
          : and(
              eq(catProducts.tenantId, ctx.tenantId),
              eq(catProducts.sku, input.sku),
            ),
      )
      .limit(1);

    const existingProduct = existingProductRows[0];
    if (existingProduct && existingProduct.tenantId !== ctx.tenantId) {
      throw new AppError('NOT_FOUND', 404, 'Product not found');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const productId = existingProduct?.id ?? input.id ?? crypto.randomUUID();
    const productRecord = buildProductSummary(input, {
      id: productId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      primaryCurrency,
      version: existingProduct ? existingProduct.version + 1 : 1,
      createdAt: existingProduct?.createdAt ?? nowSec,
      updatedAt: nowSec,
    });
    const extraFields = {
      mpn: input.mpn ?? null,
      cptOrNdcCode: input.cptOrNdcCode ?? null,
      hsCode: input.hsCode ?? null,
      description: input.description ?? null,
      isPublicInNetwork: input.isPublicInNetwork,
      customFields: JSON.stringify(input.customFields ?? {}),
    };

    const productWrite = existingProduct
      ? ctx.db
          .update(catProducts)
          .set({ ...productRecord, ...extraFields, deletedAt: null })
          .where(
            and(
              eq(catProducts.tenantId, ctx.tenantId),
              eq(catProducts.id, productId),
            ),
          )
      : ctx.db.insert(catProducts).values({ ...productRecord, ...extraFields });

    let defaultVariantRecord: z.infer<
      typeof upsertProductOutputSchema
    >['defaultVariant'] = null;
    let existingVariantVersion = 0;

    if (input.defaultVariant) {
      const vIn = input.defaultVariant;
      const variantSku = vIn.sku ?? input.sku;
      const existingVarRows = await ctx.db
        .select()
        .from(catVariantsAndPresentations)
        .where(
          and(
            eq(catVariantsAndPresentations.tenantId, ctx.tenantId),
            eq(catVariantsAndPresentations.sku, variantSku),
          ),
        )
        .limit(1);
      const existingVar = existingVarRows[0];
      if (existingVar && existingVar.productId !== productId) {
        throw new AppError(
          'VARIANT_SKU_CONFLICT',
          409,
          'Variant SKU already belongs to another product',
        );
      }
      existingVariantVersion = existingVar?.version ?? 0;
      const variantId = existingVar?.id ?? vIn.id ?? crypto.randomUUID();
      defaultVariantRecord = {
        id: variantId,
        productId,
        sku: variantSku,
        barcode: vIn.barcode ?? null,
        barcodeType: vIn.barcodeType ?? null,
        presentationName: vIn.presentationName,
        uomFactorMicros: vIn.uomFactorMicros,
        overridePriceMinor: vIn.overridePriceMinor ?? null,
        defaultLocationId: vIn.defaultLocationId ?? null,
        isDefault: true,
        isActive: input.isActive,
      };
    }

    const omnibusLowest = existingProduct
      ? Math.min(existingProduct.basePriceMinor, input.basePriceMinor)
      : input.basePriceMinor;
    const omnibusWrite = ctx.db.insert(catPriceHistoryOmnibus).values({
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      productId,
      variantId: null,
      currency: primaryCurrency,
      priceMinor: input.basePriceMinor,
      lowest30dMinor: omnibusLowest,
      changeSource: 'products.upsert',
      recordedAt: nowSec,
      createdAt: nowSec,
    });

    const output: z.infer<typeof upsertProductOutputSchema> = {
      product: productRecord,
      defaultVariant: defaultVariantRecord,
      created: !existingProduct,
    };
    const responseJson = JSON.stringify(output);

    const idempotencyWrite = buildIdempotencyInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: ctx.orgId,
      clientMutationId: input.clientMutationId,
      commandId: 'catalog.products.upsert',
      requestHash,
      responseJson,
      nowSec,
    });
    const actionLogWrite = buildActionLogInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: ctx.orgId,
      actor: ctx.actor,
      commandId: 'catalog.products.upsert',
      resourceKind: 'cat_product',
      resourceId: productId,
      snapshotAfterJson: responseJson,
      nowSec,
    });

    if (defaultVariantRecord) {
      const variantPriceMinor =
        defaultVariantRecord.overridePriceMinor ??
        multiplyMicros(input.basePriceMinor, defaultVariantRecord.uomFactorMicros);
      const variantOmnibusWrite = ctx.db.insert(catPriceHistoryOmnibus).values({
        id: crypto.randomUUID(),
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        productId,
        variantId: defaultVariantRecord.id,
        currency: primaryCurrency,
        priceMinor: variantPriceMinor,
        lowest30dMinor: variantPriceMinor,
        changeSource: 'products.upsert',
        recordedAt: nowSec,
        createdAt: nowSec,
      });
      const variantWrite =
        existingVariantVersion > 0
          ? ctx.db
              .update(catVariantsAndPresentations)
              .set({
                ...defaultVariantRecord,
                orgId: targetOrgId,
                version: existingVariantVersion + 1,
                updatedAt: nowSec,
                deletedAt: null,
              })
              .where(
                and(
                  eq(catVariantsAndPresentations.tenantId, ctx.tenantId),
                  eq(catVariantsAndPresentations.id, defaultVariantRecord.id),
                ),
              )
          : ctx.db.insert(catVariantsAndPresentations).values({
              ...defaultVariantRecord,
              tenantId: ctx.tenantId,
              orgId: targetOrgId,
              createdAt: nowSec,
              updatedAt: nowSec,
            });
      await ctx.db.batch([
        productWrite,
        variantWrite,
        omnibusWrite,
        variantOmnibusWrite,
        idempotencyWrite,
        actionLogWrite,
      ]);
    } else {
      await ctx.db.batch([
        productWrite,
        omnibusWrite,
        idempotencyWrite,
        actionLogWrite,
      ]);
    }
    return output;
  },
});
