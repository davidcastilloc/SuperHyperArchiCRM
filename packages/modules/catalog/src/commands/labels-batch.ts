import {
  assertOrgScope,
  buildActionLogInsert,
  buildIdempotencyInsert,
  catCurrenciesAndRates,
  catLabelPrintBatches,
  catProducts,
  checkIdempotency,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { convertCurrencyMinor, MICROS_SCALE } from '../pricing-engine.js';

const labelBatchItemInputSchema = z.object({
  productId: z.string().min(1).optional(),
  sku: z.string().trim().min(1).max(80),
  qtyCopies: z.number().int().positive().max(10_000).default(1),
  pricePrimaryMinor: z.number().int().nonnegative().optional(),
});

const labelBatchInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  templateCode: z
    .enum(['THERMAL_28x18', 'SHELF_DUAL_CURRENCY', 'QR_ASSET'])
    .default('THERMAL_28x18'),
  primaryCurrency: z.string().trim().min(3).max(8).default('USD'),
  secondaryCurrency: z.string().trim().min(3).max(8).default('VES'),
  rateMicros: z.number().int().positive().optional(),
  items: z.array(labelBatchItemInputSchema).min(1).max(200),
});

const labelBatchItemOutputSchema = z.object({
  productId: z.string().nullable(),
  sku: z.string(),
  name: z.string().nullable(),
  qtyCopies: z.number().int().positive(),
  pricePrimaryMinor: z.number().int().nonnegative(),
  priceSecondaryMinor: z.number().int().nonnegative(),
});

const labelBatchOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  templateCode: z.string(),
  secondaryCurrency: z.string(),
  rateMicrosSnapshot: z.number().int().positive(),
  items: z.array(labelBatchItemOutputSchema),
  printedByUserId: z.string(),
  printedAt: z.number().int(),
});

export const catalogLabelsBatchCommand = defineCommand<
  typeof labelBatchInputSchema,
  z.infer<typeof labelBatchOutputSchema>,
  ShacD1Database
>({
  id: 'catalog.labels.batch',
  moduleId: 'catalog',
  method: 'POST',
  path: '/api/catalog/labels/batches',
  summary: 'Create a dual-currency thermal or shelf label print batch snapshot',
  requiredPermission: 'catalog.labels.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Generate and persist a dual-currency label print batch with integer rateMicros snapshot',
  },
  inputSchema: labelBatchInputSchema,
  outputSchema: labelBatchOutputSchema,
  async handler(ctx, input) {
    const primaryCurrency = input.primaryCurrency.toUpperCase();
    const secondaryCurrency = input.secondaryCurrency.toUpperCase();
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'catalog.labels.batch',
        ...input,
        primaryCurrency,
        secondaryCurrency,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      labelBatchOutputSchema,
    );
    if (replay) return replay;

    assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);

    const skus = Array.from(new Set(input.items.map((i) => i.sku)));
    const productIds = Array.from(
      new Set(input.items.map((i) => i.productId).filter((v): v is string => !!v)),
    );
    const matchCond =
      productIds.length > 0
        ? or(inArray(catProducts.sku, skus), inArray(catProducts.id, productIds))
        : inArray(catProducts.sku, skus);

    const productsQuery = ctx.db
      .select({
        id: catProducts.id,
        sku: catProducts.sku,
        name: catProducts.name,
        basePriceMinor: catProducts.basePriceMinor,
        primaryCurrency: catProducts.primaryCurrency,
      })
      .from(catProducts)
      .where(
        and(
          eq(catProducts.tenantId, ctx.tenantId),
          matchCond,
          isNull(catProducts.deletedAt),
        ),
      );

    const fxQuery = ctx.db
      .select()
      .from(catCurrenciesAndRates)
      .where(
        and(
          eq(catCurrenciesAndRates.tenantId, ctx.tenantId),
          eq(catCurrenciesAndRates.fromCurrency, primaryCurrency),
          eq(catCurrenciesAndRates.toCurrency, secondaryCurrency),
          eq(catCurrenciesAndRates.isActive, true),
        ),
      )
      .orderBy(desc(catCurrenciesAndRates.effectiveAt))
      .limit(1);

    const [productRows, fxRows] = await ctx.db.batch([productsQuery, fxQuery]);

    const bySku = new Map(productRows.map((p) => [p.sku, p]));
    const byId = new Map(productRows.map((p) => [p.id, p]));

    let rateMicrosSnapshot = input.rateMicros ?? null;
    if (rateMicrosSnapshot === null) {
      if (primaryCurrency === secondaryCurrency) {
        rateMicrosSnapshot = MICROS_SCALE;
      } else if (fxRows[0]) {
        rateMicrosSnapshot = fxRows[0].rateMicros;
      } else {
        throw new AppError(
          'FX_RATE_NOT_FOUND',
          404,
          `No active FX rate found for ${primaryCurrency}->${secondaryCurrency}`,
        );
      }
    }

    const resolvedItems = input.items.map((item) => {
      const product = item.productId
        ? byId.get(item.productId)
        : bySku.get(item.sku);
      if (item.productId && !product) {
        throw new AppError('NOT_FOUND', 404, 'Product not found');
      }
      const pricePrimaryMinor = item.pricePrimaryMinor ?? product?.basePriceMinor;
      if (pricePrimaryMinor === undefined) {
        throw new AppError(
          'NOT_FOUND',
          404,
          `Product SKU ${item.sku} not found and pricePrimaryMinor not provided`,
        );
      }
      return {
        productId: product?.id ?? item.productId ?? null,
        sku: product?.sku ?? item.sku,
        name: product?.name ?? null,
        qtyCopies: item.qtyCopies,
        pricePrimaryMinor,
        priceSecondaryMinor: convertCurrencyMinor(
          pricePrimaryMinor,
          rateMicrosSnapshot,
        ),
      };
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const batchId = crypto.randomUUID();
    const output: z.infer<typeof labelBatchOutputSchema> = {
      id: batchId,
      tenantId: ctx.tenantId,
      orgId: ctx.orgId,
      templateCode: input.templateCode,
      secondaryCurrency,
      rateMicrosSnapshot,
      items: resolvedItems,
      printedByUserId: ctx.actor.id,
      printedAt: nowSec,
    };
    const responseJson = JSON.stringify(output);

    await ctx.db.batch([
      ctx.db.insert(catLabelPrintBatches).values({
        id: batchId,
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        templateCode: input.templateCode,
        rateMicrosSnapshot,
        secondaryCurrency,
        itemsJson: JSON.stringify(resolvedItems),
        printedByUserId: ctx.actor.id,
        printedAt: nowSec,
        createdAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        clientMutationId: input.clientMutationId,
        commandId: 'catalog.labels.batch',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        actor: ctx.actor,
        commandId: 'catalog.labels.batch',
        resourceKind: 'cat_label_print_batch',
        resourceId: batchId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return output;
  },
});
