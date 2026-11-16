import {
  wmsPackagesAndLots,
  wmsPickings,
  wmsStockMoves,
  wmsValuationAndLandedCosts,
  type ShacD1Database,
} from '@shac/db-d1';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { computeAvcoValuation } from '../valuation-engine.js';
import type { PreparedMoveLine } from './pickings-do-sync.js';
import type { pickingOperationKindSchema } from './wms-schemas.js';

export type WmsBatchOp = Parameters<ShacD1Database['batch']>[0][number];
type OperationKind = z.infer<typeof pickingOperationKindSchema>;

export function buildValuationBatchOps(
  db: ShacD1Database,
  params: {
    tenantId: string;
    orgId: string;
    nowSec: number;
    lines: PreparedMoveLine[];
    moveIds: string[];
    existingLayers: Array<{
      id: string;
      productId: string | null;
      qtyMicros: number;
      unitCostMinor: number;
      totalValueMinor: number;
      remainingQtyMicros: number;
      remainingValueMinor: number;
      version: number;
    }>;
  },
): WmsBatchOp[] {
  const ops: WmsBatchOp[] = [];
  const layerByProduct = new Map<
    string,
    {
      id: string | null;
      qtyMicros: number;
      totalValueMinor: number;
      unitCostMinor: number;
      version: number;
    }
  >();

  for (const row of params.existingLayers) {
    if (row.productId && !layerByProduct.has(row.productId)) {
      layerByProduct.set(row.productId, {
        id: row.id,
        qtyMicros: row.remainingQtyMicros,
        totalValueMinor: row.remainingValueMinor,
        unitCostMinor: row.unitCostMinor,
        version: row.version,
      });
    }
  }

  for (let idx = 0; idx < params.lines.length; idx += 1) {
    const line = params.lines[idx]!;
    if (line.doneQtyMicros <= 0) continue;

    const current = layerByProduct.get(line.productId);
    const avco = computeAvcoValuation({
      currentQtyMicros: current?.qtyMicros ?? 0,
      currentTotalValueMinor: current?.totalValueMinor,
      currentUnitCostMinor: current?.unitCostMinor ?? 0,
      incomingQtyMicros: line.doneQtyMicros,
      incomingUnitCostMinor: line.unitCostMinor,
    });

    if (current?.id) {
      ops.push(
        db
          .update(wmsValuationAndLandedCosts)
          .set({
            stockMoveId: params.moveIds[idx]!,
            qtyMicros: avco.newQtyMicros,
            unitCostMinor: avco.newUnitCostMinor,
            totalValueMinor: avco.newTotalValueMinor,
            remainingQtyMicros: avco.newQtyMicros,
            remainingValueMinor: avco.newTotalValueMinor,
            version: current.version + 1,
            updatedAt: params.nowSec,
          })
          .where(
            and(
              eq(wmsValuationAndLandedCosts.tenantId, params.tenantId),
              eq(wmsValuationAndLandedCosts.id, current.id),
            ),
          ),
      );
      layerByProduct.set(line.productId, {
        id: current.id,
        qtyMicros: avco.newQtyMicros,
        totalValueMinor: avco.newTotalValueMinor,
        unitCostMinor: avco.newUnitCostMinor,
        version: current.version + 1,
      });
    } else {
      const layerId = crypto.randomUUID();
      ops.push(
        db.insert(wmsValuationAndLandedCosts).values({
          id: layerId,
          tenantId: params.tenantId,
          orgId: params.orgId,
          recordKind: 'valuation_layer',
          productId: line.productId,
          stockMoveId: params.moveIds[idx]!,
          qtyMicros: avco.newQtyMicros,
          unitCostMinor: avco.newUnitCostMinor,
          totalValueMinor: avco.newTotalValueMinor,
          remainingQtyMicros: avco.newQtyMicros,
          remainingValueMinor: avco.newTotalValueMinor,
          createdAt: params.nowSec,
          updatedAt: params.nowSec,
        }),
      );
      layerByProduct.set(line.productId, {
        id: layerId,
        qtyMicros: avco.newQtyMicros,
        totalValueMinor: avco.newTotalValueMinor,
        unitCostMinor: avco.newUnitCostMinor,
        version: 1,
      });
    }
  }

  return ops;
}

export function buildLotAndBackorderOps(
  db: ShacD1Database,
  params: {
    tenantId: string;
    orgId: string;
    nowSec: number;
    clientMutationId: string;
    parentPickingId: string;
    parentPickingNumber: string;
    operationKind: OperationKind;
    sourceLocationId: string;
    destLocationId: string;
    orderId: string | null;
    purchaseOrderId: string | null;
    partyId: string | null;
    currency: string;
    lines: PreparedMoveLine[];
    isInbound: boolean;
  },
) {
  const ops: WmsBatchOp[] = [];

  if (params.isInbound) {
    for (const line of params.lines) {
      if (!line.lotId && !line.lotCode && !line.gs1RawBarcode) continue;
      ops.push(
        db.insert(wmsPackagesAndLots).values({
          id: line.lotId ?? crypto.randomUUID(),
          tenantId: params.tenantId,
          orgId: params.orgId,
          recordKind: 'lot',
          productId: line.productId,
          variantId: line.variantId,
          lotOrPackageCode: line.lotCode ?? line.lotId ?? 'LOT',
          gs1RawBarcode: line.gs1RawBarcode,
          serialNumber: line.serialNumber,
          manufactureDate: line.manufactureDate,
          expirationDate: line.expiryDate,
          currentLocationId: params.destLocationId,
          status: 'released',
          createdAt: params.nowSec,
          updatedAt: params.nowSec,
        }),
      );
    }
  }

  const backorderLines = params.lines.filter((l) => l.remainingQtyMicros > 0);
  if (backorderLines.length === 0) {
    return { ops, backorderPicking: null };
  }

  const backorderId = crypto.randomUUID();
  const backorderNumber = params.parentPickingNumber.endsWith('-BACKORDER')
    ? `${params.parentPickingNumber}-${params.nowSec}`
    : `${params.parentPickingNumber}-BACKORDER`;

  ops.push(
    db.insert(wmsPickings).values({
      id: backorderId,
      tenantId: params.tenantId,
      orgId: params.orgId,
      pickingNumber: backorderNumber,
      operationKind: params.operationKind,
      sourceLocationId: params.sourceLocationId,
      destLocationId: params.destLocationId,
      orderId: params.orderId,
      purchaseOrderId: params.purchaseOrderId,
      backorderOfPickingId: params.parentPickingId,
      partyId: params.partyId,
      status: 'waiting',
      createdAt: params.nowSec,
      updatedAt: params.nowSec,
    }),
  );

  let totalRemainingQtyMicros = 0;
  for (const boLine of backorderLines) {
    totalRemainingQtyMicros += boLine.remainingQtyMicros;
    ops.push(
      db.insert(wmsStockMoves).values({
        id: crypto.randomUUID(),
        tenantId: params.tenantId,
        orgId: params.orgId,
        pickingId: backorderId,
        productId: boLine.productId,
        variantId: boLine.variantId,
        sourceLocationId: params.sourceLocationId,
        destLocationId: params.destLocationId,
        uom: boLine.uom,
        demandedQtyMicros: boLine.remainingQtyMicros,
        doneQtyMicros: 0,
        unitCostMinor: boLine.unitCostMinor,
        currency: params.currency,
        idempotencyKey: `${params.clientMutationId}:bo:${boLine.index}`,
        occurredAt: params.nowSec,
        createdAt: params.nowSec,
        updatedAt: params.nowSec,
      }),
    );
  }

  return {
    ops,
    backorderPicking: {
      id: backorderId,
      pickingNumber: backorderNumber,
      backorderOfPickingId: params.parentPickingId,
      status: 'waiting' as const,
      totalRemainingQtyMicros,
    },
  };
}
