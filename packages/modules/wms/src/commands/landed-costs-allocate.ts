import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  catProducts,
  checkIdempotency,
  wmsPickings,
  wmsValuationAndLandedCosts,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { assertWmsResourceScope, resolveWmsTargetOrg } from '../lib/scope.js';
import { allocateLandedCosts, computeAvcoValuation } from '../valuation-engine.js';
import type { WmsBatchOp } from './pickings-batch-ops.js';
import {
  allocateLandedCostsInputSchema,
  allocateLandedCostsOutputSchema,
} from './wms-schemas.js';

export const wmsLandedCostsAllocateCommand = defineCommand<
  typeof allocateLandedCostsInputSchema,
  z.infer<typeof allocateLandedCostsOutputSchema>,
  ShacD1Database
>({
  id: 'wms.landed_costs.allocate',
  moduleId: 'wms',
  method: 'POST',
  path: '/api/wms/landed-costs/allocate',
  summary: 'Prorate landed costs across receipt lines with exact BigInt remainder distribution',
  requiredPermission: 'wms.valuation.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Allocate freight/customs/insurance landed costs across WMS lines and update AVCO valuation layers',
  },
  inputSchema: allocateLandedCostsInputSchema,
  outputSchema: allocateLandedCostsOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({ commandId: 'wms.landed_costs.allocate', ...input }),
    );
    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      allocateLandedCostsOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveWmsTargetOrg(ctx, input.orgId);

    if (input.costComponents.length > 0) {
      const componentsSum = input.costComponents.reduce(
        (acc, c) => acc + BigInt(c.amountMinor),
        0n,
      );
      if (componentsSum !== BigInt(input.totalFreightMinor)) {
        throw new AppError(
          'VALIDATION_ERROR',
          400,
          'costComponents sum must match totalFreightMinor',
        );
      }
    }

    const productIds = Array.from(new Set(input.lines.map((l) => l.productId)));
    const [pickingRows, productRows, existingLayers] = await ctx.db.batch([
      input.pickingIds.length > 0
        ? ctx.db
            .select({ id: wmsPickings.id, tenantId: wmsPickings.tenantId, orgId: wmsPickings.orgId })
            .from(wmsPickings)
            .where(and(inArray(wmsPickings.id, input.pickingIds), isNull(wmsPickings.deletedAt)))
        : ctx.db
            .select({ id: wmsPickings.id, tenantId: wmsPickings.tenantId, orgId: wmsPickings.orgId })
            .from(wmsPickings)
            .where(eq(wmsPickings.id, '__none__')),
      ctx.db
        .select({ id: catProducts.id, tenantId: catProducts.tenantId })
        .from(catProducts)
        .where(and(inArray(catProducts.id, productIds), isNull(catProducts.deletedAt))),
      ctx.db
        .select()
        .from(wmsValuationAndLandedCosts)
        .where(
          and(
            eq(wmsValuationAndLandedCosts.tenantId, ctx.tenantId),
            eq(wmsValuationAndLandedCosts.recordKind, 'valuation_layer'),
            inArray(wmsValuationAndLandedCosts.productId, productIds),
            isNull(wmsValuationAndLandedCosts.deletedAt),
          ),
        ),
    ]);

    if (input.pickingIds.length > 0) {
      if (pickingRows.length !== new Set(input.pickingIds).size) {
        throw new AppError('NOT_FOUND', 404, 'Referenced WMS picking not found');
      }
      for (const p of pickingRows) {
        await assertWmsResourceScope(ctx, p, 'WMS picking');
      }
    }
    for (const prod of productRows) {
      if (prod.tenantId !== ctx.tenantId) {
        throw new AppError('NOT_FOUND', 404, 'Product not found');
      }
    }

    const layerByProduct = new Map(
      existingLayers.filter((l) => l.productId !== null).map((l) => [l.productId!, l]),
    );

    const allocation = allocateLandedCosts(
      input.splitMethod,
      input.totalFreightMinor,
      input.lines.map((line) => ({
        ...line,
        unitCostMinor: line.unitCostMinor ?? layerByProduct.get(line.productId)?.unitCostMinor,
      })),
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const pickingIdsJson = JSON.stringify(input.pickingIds);
    const costComponentsJson = JSON.stringify(input.costComponents);
    const ops: WmsBatchOp[] = [];
    const outputAllocations: z.infer<typeof allocateLandedCostsOutputSchema>['allocations'] = [];

    for (const item of allocation.lines) {
      const valuationId = crypto.randomUUID();
      const productId = item.productId!;
      ops.push(
        ctx.db.insert(wmsValuationAndLandedCosts).values({
          id: valuationId,
          tenantId: ctx.tenantId,
          orgId: targetOrgId,
          recordKind: 'landed_cost_allocation',
          productId,
          stockMoveId: item.stockMoveId,
          pickingIdsJson,
          splitMethod: input.splitMethod,
          qtyMicros: item.qtyMicros,
          unitCostMinor: item.newUnitCostMinor,
          totalValueMinor: item.allocatedCostMinor,
          remainingQtyMicros: item.qtyMicros,
          remainingValueMinor: item.newTotalValueMinor,
          costComponentsJson,
          createdAt: nowSec,
          updatedAt: nowSec,
        }),
      );

      const existing = layerByProduct.get(productId);
      if (existing) {
        const updatedAvco = computeAvcoValuation({
          currentQtyMicros: existing.remainingQtyMicros,
          currentTotalValueMinor: existing.remainingValueMinor,
          currentUnitCostMinor: existing.unitCostMinor,
          addedCostMinor: item.allocatedCostMinor,
        });
        ops.push(
          ctx.db
            .update(wmsValuationAndLandedCosts)
            .set({
              unitCostMinor: updatedAvco.newUnitCostMinor,
              totalValueMinor: updatedAvco.newTotalValueMinor,
              remainingValueMinor: updatedAvco.newTotalValueMinor,
              version: existing.version + 1,
              updatedAt: nowSec,
            })
            .where(
              and(
                eq(wmsValuationAndLandedCosts.tenantId, ctx.tenantId),
                eq(wmsValuationAndLandedCosts.id, existing.id),
              ),
            ),
        );
        layerByProduct.set(productId, {
          ...existing,
          unitCostMinor: updatedAvco.newUnitCostMinor,
          totalValueMinor: updatedAvco.newTotalValueMinor,
          remainingValueMinor: updatedAvco.newTotalValueMinor,
          version: existing.version + 1,
        });
      } else {
        const layerId = crypto.randomUUID();
        ops.push(
          ctx.db.insert(wmsValuationAndLandedCosts).values({
            id: layerId,
            tenantId: ctx.tenantId,
            orgId: targetOrgId,
            recordKind: 'valuation_layer',
            productId,
            stockMoveId: item.stockMoveId,
            qtyMicros: item.qtyMicros,
            unitCostMinor: item.newUnitCostMinor,
            totalValueMinor: item.newTotalValueMinor,
            remainingQtyMicros: item.qtyMicros,
            remainingValueMinor: item.newTotalValueMinor,
            createdAt: nowSec,
            updatedAt: nowSec,
          }),
        );
      }

      outputAllocations.push({
        valuationId,
        lineId: item.lineId,
        productId,
        stockMoveId: item.stockMoveId,
        qtyMicros: item.qtyMicros,
        previousTotalValueMinor: item.previousTotalValueMinor,
        allocatedCostMinor: item.allocatedCostMinor,
        newTotalValueMinor: item.newTotalValueMinor,
        newUnitCostMinor: item.newUnitCostMinor,
      });
    }

    const response: z.infer<typeof allocateLandedCostsOutputSchema> = {
      ok: true,
      splitMethod: input.splitMethod,
      totalFreightMinor: input.totalFreightMinor,
      totalAllocatedMinor: allocation.totalAllocatedMinor,
      remainderDistributedMinor: allocation.remainderDistributedMinor,
      allocations: outputAllocations,
    };
    const responseJson = JSON.stringify(response);

    await ctx.db.batch([
      ops[0]!,
      ...ops.slice(1),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'wms.landed_costs.allocate',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'wms.landed_costs.allocate',
        resourceKind: 'wms_valuation',
        resourceId: outputAllocations[0]!.valuationId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return response;
  },
});
