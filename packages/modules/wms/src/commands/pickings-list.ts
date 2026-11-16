import { wmsLocations, wmsPickings, type ShacD1Database } from '@shac/db-d1';
import { defineCommand } from '@shac/kernel';
import { and, asc, desc, eq, isNull, like, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import { buildPickingsOrgSubtreeFilter } from '../lib/scope.js';
import {
  listPickingsInputSchema,
  listPickingsOutputSchema,
} from './wms-schemas.js';

export const wmsPickingsListCommand = defineCommand<
  typeof listPickingsInputSchema,
  z.infer<typeof listPickingsOutputSchema>,
  ShacD1Database
>({
  id: 'wms.pickings.list',
  moduleId: 'wms',
  method: 'GET',
  path: '/api/wms/pickings',
  summary: 'List WMS pickings with explicit location join aliases in <= 2 D1 queries',
  requiredPermission: 'wms.pickings.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description:
      'List WMS pickings and backorders scoped by tenantId and org subtree using <= 2 D1 queries',
  },
  inputSchema: listPickingsInputSchema,
  outputSchema: listPickingsOutputSchema,
  async handler(ctx, input) {
    const conditions = [
      eq(wmsPickings.tenantId, ctx.tenantId),
      isNull(wmsPickings.deletedAt),
      buildPickingsOrgSubtreeFilter(ctx),
    ];

    if (input.orgId) conditions.push(eq(wmsPickings.orgId, input.orgId));
    if (input.status) conditions.push(eq(wmsPickings.status, input.status));
    if (input.operationKind) {
      conditions.push(eq(wmsPickings.operationKind, input.operationKind));
    }
    if (input.backorderOfPickingId) {
      conditions.push(
        eq(wmsPickings.backorderOfPickingId, input.backorderOfPickingId),
      );
    }
    if (input.search?.trim()) {
      const escaped = input.search.trim().replace(/[\\%_]/g, '\\$&');
      conditions.push(like(wmsPickings.pickingNumber, `%${escaped}%`));
    }

    const whereClause = and(...conditions);
    const srcLoc = alias(wmsLocations, 'src_loc');
    const dstLoc = alias(wmsLocations, 'dst_loc');

    const itemsQuery = ctx.db
      .select({
        id: wmsPickings.id,
        tenantId: wmsPickings.tenantId,
        orgId: wmsPickings.orgId,
        pickingNumber: wmsPickings.pickingNumber,
        operationKind: wmsPickings.operationKind,
        sourceLocationId: wmsPickings.sourceLocationId,
        sourceLocationName: sql<string | null>`${srcLoc.completeName}`.as(
          'source_location_name',
        ),
        sourceLocationKind: sql<string | null>`${srcLoc.locationKind}`.as(
          'source_location_kind',
        ),
        destLocationId: wmsPickings.destLocationId,
        destLocationName: sql<string | null>`${dstLoc.completeName}`.as(
          'dest_location_name',
        ),
        destLocationKind: sql<string | null>`${dstLoc.locationKind}`.as(
          'dest_location_kind',
        ),
        orderId: wmsPickings.orderId,
        purchaseOrderId: wmsPickings.purchaseOrderId,
        backorderOfPickingId: wmsPickings.backorderOfPickingId,
        partyId: wmsPickings.partyId,
        scheduledAt: wmsPickings.scheduledAt,
        completedAt: wmsPickings.completedAt,
        assignedToUserId: wmsPickings.assignedToUserId,
        status: wmsPickings.status,
        version: wmsPickings.version,
        createdAt: wmsPickings.createdAt,
        updatedAt: wmsPickings.updatedAt,
      })
      .from(wmsPickings)
      .leftJoin(
        srcLoc,
        and(
          eq(wmsPickings.sourceLocationId, srcLoc.id),
          eq(srcLoc.tenantId, ctx.tenantId),
          isNull(srcLoc.deletedAt),
        ),
      )
      .leftJoin(
        dstLoc,
        and(
          eq(wmsPickings.destLocationId, dstLoc.id),
          eq(dstLoc.tenantId, ctx.tenantId),
          isNull(dstLoc.deletedAt),
        ),
      )
      .where(whereClause)
      .orderBy(desc(wmsPickings.createdAt), asc(wmsPickings.pickingNumber))
      .limit(input.limit)
      .offset(input.offset);

    const countQuery = ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(wmsPickings)
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
