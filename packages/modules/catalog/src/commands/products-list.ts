import { catProducts, type ShacD1Database } from '@shac/db-d1';
import { defineCommand } from '@shac/kernel';
import { and, asc, eq, isNull, like, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  listProductsInputSchema,
  listProductsOutputSchema,
} from './products-schemas.js';

export const catalogProductsListCommand = defineCommand<
  typeof listProductsInputSchema,
  z.infer<typeof listProductsOutputSchema>,
  ShacD1Database
>({
  id: 'catalog.products.list',
  moduleId: 'catalog',
  method: 'GET',
  path: '/api/catalog/products',
  summary: 'List catalog products scoped by tenantId using <= 2 D1 queries',
  requiredPermission: 'catalog.products.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description: 'List catalog products for the active tenant in a single D1 batch',
  },
  inputSchema: listProductsInputSchema,
  outputSchema: listProductsOutputSchema,
  async handler(ctx, input) {
    const conditions = [
      eq(catProducts.tenantId, ctx.tenantId),
      isNull(catProducts.deletedAt),
    ];

    if (!input.includeInactive) conditions.push(eq(catProducts.isActive, true));
    if (input.itemKind) conditions.push(eq(catProducts.itemKind, input.itemKind));
    if (input.categoryId) conditions.push(eq(catProducts.categoryId, input.categoryId));
    if (input.orgId) conditions.push(eq(catProducts.orgId, input.orgId));
    if (input.search) {
      const pattern = `%${input.search}%`;
      const searchCond = or(
        like(catProducts.sku, pattern),
        like(catProducts.name, pattern),
        like(catProducts.gtin, pattern),
      );
      if (searchCond) conditions.push(searchCond);
    }

    const whereClause = and(...conditions);

    const itemsQuery = ctx.db
      .select({
        id: catProducts.id,
        tenantId: catProducts.tenantId,
        orgId: catProducts.orgId,
        itemKind: catProducts.itemKind,
        sku: catProducts.sku,
        gtin: catProducts.gtin,
        name: catProducts.name,
        subtitle: catProducts.subtitle,
        categoryId: catProducts.categoryId,
        baseUom: catProducts.baseUom,
        salesUom: catProducts.salesUom,
        trackingMode: catProducts.trackingMode,
        costingMethod: catProducts.costingMethod,
        removalStrategy: catProducts.removalStrategy,
        basePriceMinor: catProducts.basePriceMinor,
        costPriceMinor: catProducts.costPriceMinor,
        standardPriceMinor: catProducts.standardPriceMinor,
        primaryCurrency: catProducts.primaryCurrency,
        taxClass: catProducts.taxClass,
        taxRateBps: catProducts.taxRateBps,
        isFixedPrice: catProducts.isFixedPrice,
        isActive: catProducts.isActive,
        version: catProducts.version,
        createdAt: catProducts.createdAt,
        updatedAt: catProducts.updatedAt,
      })
      .from(catProducts)
      .where(whereClause)
      .orderBy(asc(catProducts.sku))
      .limit(input.limit)
      .offset(input.offset);

    const countQuery = ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(catProducts)
      .where(whereClause);

    const [items, countRows] = await ctx.db.batch([itemsQuery, countQuery]);

    return {
      items,
      total: Number(countRows[0]?.count ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  },
});
