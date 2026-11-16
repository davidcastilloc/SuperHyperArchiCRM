import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  wmsPickings,
  wmsStockMoves,
  wmsValuationAndLandedCosts,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { assertWmsResourceScope, resolveWmsTargetOrg } from '../lib/scope.js';
import {
  buildLotAndBackorderOps,
  buildValuationBatchOps,
  type WmsBatchOp,
} from './pickings-batch-ops.js';
import {
  prepareMoveLines,
  syncPickingWithBranchDo,
  validateLocationsAndProductsScope,
} from './pickings-do-sync.js';
import {
  pickingOperationKindSchema,
  pickingStatusSchema,
  processPickingInputSchema,
  processPickingOutputSchema,
} from './wms-schemas.js';

export const wmsPickingsProcessCommand = defineCommand<
  typeof processPickingInputSchema,
  z.infer<typeof processPickingOutputSchema>,
  ShacD1Database
>({
  id: 'wms.pickings.process',
  moduleId: 'wms',
  method: 'POST',
  path: '/api/wms/pickings/process',
  summary:
    'Process double-entry WMS stock moves, sync BranchInventoryDO FEFO/lots, and generate -BACKORDER on partial fulfillment',
  requiredPermission: 'wms.pickings.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Execute double-entry WMS picking moves with GS1-128 validation, BranchInventoryDO sync, AVCO update, and atomic -BACKORDER creation',
  },
  inputSchema: processPickingInputSchema,
  outputSchema: processPickingOutputSchema,
  async handler(ctx, input) {
    const currency = input.currency.toUpperCase();
    const requestHash = await sha256Hex(
      JSON.stringify({ commandId: 'wms.pickings.process', ...input, currency }),
    );
    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      processPickingOutputSchema,
    );
    if (replay) return replay;

    const preparedLines = prepareMoveLines(input);
    let targetOrgId = await resolveWmsTargetOrg(ctx, input.orgId);

    const existingPicking = input.pickingId
      ? (
          await ctx.db
            .select()
            .from(wmsPickings)
            .where(and(eq(wmsPickings.id, input.pickingId), isNull(wmsPickings.deletedAt)))
            .limit(1)
        )[0]
      : undefined;

    if (input.pickingId) {
      await assertWmsResourceScope(ctx, existingPicking, 'WMS picking');
      if (existingPicking!.status === 'done' || existingPicking!.status === 'cancelled') {
        throw new AppError(
          'PICKING_ALREADY_FINALIZED',
          409,
          `Picking ${existingPicking!.pickingNumber} is already ${existingPicking!.status}`,
        );
      }
      targetOrgId = existingPicking!.orgId;
    }

    const operationKind = existingPicking
      ? pickingOperationKindSchema.parse(existingPicking.operationKind)
      : input.operationKind;
    const sourceLocationId = input.sourceLocationId ?? existingPicking?.sourceLocationId;
    const destLocationId = input.destLocationId ?? existingPicking?.destLocationId;
    if (!sourceLocationId || !destLocationId) {
      throw new AppError('VALIDATION_ERROR', 400, 'sourceLocationId and destLocationId are required');
    }

    const productIds = Array.from(new Set(preparedLines.map((l) => l.productId)));
    await validateLocationsAndProductsScope(ctx, sourceLocationId, destLocationId, productIds);

    const isInbound = operationKind === 'asn_receipt';
    const existingLayers = isInbound
      ? await ctx.db
          .select({
            id: wmsValuationAndLandedCosts.id,
            productId: wmsValuationAndLandedCosts.productId,
            qtyMicros: wmsValuationAndLandedCosts.qtyMicros,
            unitCostMinor: wmsValuationAndLandedCosts.unitCostMinor,
            totalValueMinor: wmsValuationAndLandedCosts.totalValueMinor,
            remainingQtyMicros: wmsValuationAndLandedCosts.remainingQtyMicros,
            remainingValueMinor: wmsValuationAndLandedCosts.remainingValueMinor,
            version: wmsValuationAndLandedCosts.version,
          })
          .from(wmsValuationAndLandedCosts)
          .where(
            and(
              eq(wmsValuationAndLandedCosts.tenantId, ctx.tenantId),
              eq(wmsValuationAndLandedCosts.recordKind, 'valuation_layer'),
              inArray(wmsValuationAndLandedCosts.productId, productIds),
              isNull(wmsValuationAndLandedCosts.deletedAt),
            ),
          )
      : [];

    const doSynced = await syncPickingWithBranchDo(
      ctx,
      targetOrgId,
      { ...input, operationKind },
      preparedLines,
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const pickingId = existingPicking?.id ?? crypto.randomUUID();
    const pickingNumber =
      existingPicking?.pickingNumber ??
      input.pickingNumber ??
      `PICK-${nowSec}-${pickingId.slice(0, 6).toUpperCase()}`;
    const orderId = input.orderId ?? existingPicking?.orderId ?? null;
    const purchaseOrderId = input.purchaseOrderId ?? existingPicking?.purchaseOrderId ?? null;
    const partyId = input.partyId ?? existingPicking?.partyId ?? null;

    const pickingOp: WmsBatchOp = existingPicking
      ? ctx.db
          .update(wmsPickings)
          .set({
            status: 'done',
            completedAt: nowSec,
            assignedToUserId: input.assignedToUserId ?? existingPicking.assignedToUserId,
            version: existingPicking.version + 1,
            updatedAt: nowSec,
          })
          .where(and(eq(wmsPickings.tenantId, ctx.tenantId), eq(wmsPickings.id, pickingId)))
      : ctx.db.insert(wmsPickings).values({
          id: pickingId,
          tenantId: ctx.tenantId,
          orgId: targetOrgId,
          pickingNumber,
          operationKind,
          sourceLocationId,
          destLocationId,
          orderId,
          purchaseOrderId,
          partyId,
          completedAt: nowSec,
          assignedToUserId: input.assignedToUserId ?? null,
          status: 'done',
          createdAt: nowSec,
          updatedAt: nowSec,
        });

    const moveIds: string[] = [];
    const moveOps: WmsBatchOp[] = preparedLines.map((line) => {
      const moveId = crypto.randomUUID();
      moveIds.push(moveId);
      return ctx.db.insert(wmsStockMoves).values({
        id: moveId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        pickingId,
        productId: line.productId,
        variantId: line.variantId,
        lotId: line.lotId,
        packageId: line.packageId,
        sourceLocationId,
        destLocationId,
        uom: line.uom,
        demandedQtyMicros: line.demandedQtyMicros,
        doneQtyMicros: line.doneQtyMicros,
        unitCostMinor: line.unitCostMinor,
        currency,
        reasonCode: line.reasonCode,
        performedByUserId: ctx.actor.id,
        idempotencyKey: `${input.clientMutationId}:move:${line.index}`,
        occurredAt: nowSec,
        createdAt: nowSec,
        updatedAt: nowSec,
      });
    });

    const valuationOps = isInbound
      ? buildValuationBatchOps(ctx.db, {
          tenantId: ctx.tenantId,
          orgId: targetOrgId,
          nowSec,
          lines: preparedLines,
          moveIds,
          existingLayers,
        })
      : [];

    const { ops: lotAndBoOps, backorderPicking } = buildLotAndBackorderOps(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      nowSec,
      clientMutationId: input.clientMutationId,
      parentPickingId: pickingId,
      parentPickingNumber: pickingNumber,
      operationKind,
      sourceLocationId,
      destLocationId,
      orderId,
      purchaseOrderId,
      partyId,
      currency,
      lines: preparedLines,
      isInbound,
    });

    const response: z.infer<typeof processPickingOutputSchema> = {
      ok: true,
      pickingId,
      pickingNumber,
      operationKind,
      status: pickingStatusSchema.parse('done'),
      moves: preparedLines.map((line, idx) => ({
        moveId: moveIds[idx]!,
        productId: line.productId,
        lotId: line.lotId,
        lotCode: line.lotCode,
        serialNumber: line.serialNumber,
        demandedQtyMicros: line.demandedQtyMicros,
        doneQtyMicros: line.doneQtyMicros,
        remainingQtyMicros: line.remainingQtyMicros,
        unitCostMinor: line.unitCostMinor,
      })),
      backorderPicking,
      doSynced,
    };

    const responseJson = JSON.stringify(response);
    await ctx.db.batch([
      pickingOp,
      ...moveOps,
      ...valuationOps,
      ...lotAndBoOps,
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'wms.pickings.process',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'wms.pickings.process',
        resourceKind: 'wms_picking',
        resourceId: pickingId,
        snapshotAfterJson: responseJson,
        nowSec,
        targetPartyId: partyId,
      }),
    ]);

    return response;
  },
});
