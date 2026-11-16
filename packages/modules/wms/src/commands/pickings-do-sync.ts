import {
  catProducts,
  wmsLocations,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, type ExecutionContext } from '@shac/kernel';
import { and, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { parseGs1Barcode } from '../gs1-parser.js';
import { assertWmsResourceScope, type WmsDbCtx } from '../lib/scope.js';
import type {
  pickingMoveLineInputSchema,
  processPickingInputSchema,
} from './wms-schemas.js';

type MoveLineInput = z.infer<typeof pickingMoveLineInputSchema>;
type ProcessInput = z.infer<typeof processPickingInputSchema>;

export interface PreparedMoveLine {
  index: number;
  productId: string;
  variantId: string;
  lotId: string | null;
  lotCode: string | null;
  gs1RawBarcode: string | null;
  serialNumber: string | null;
  manufactureEpochMs: number | null;
  expiryEpochMs: number | null;
  manufactureDate: string | null;
  expiryDate: string | null;
  packageId: string | null;
  uom: string;
  demandedQtyMicros: number;
  doneQtyMicros: number;
  remainingQtyMicros: number;
  unitCostMinor: number;
  reasonCode: string | null;
  binCode: string;
}

export function prepareMoveLines(input: ProcessInput): PreparedMoveLine[] {
  return input.lines.map((line: MoveLineInput, index: number) => {
    const parsedGs1 = line.gs1RawBarcode
      ? parseGs1Barcode(line.gs1RawBarcode)
      : null;

    const lotCode = line.lotCode ?? parsedGs1?.lotCode ?? null;
    const serialNumber = line.serialNumber ?? parsedGs1?.serialNumber ?? null;
    const expiryEpochMs =
      line.expiryEpochMs ?? parsedGs1?.expiryEpochMs ?? null;
    const manufactureEpochMs =
      line.manufactureEpochMs ?? parsedGs1?.manufactureEpochMs ?? null;

    const expiryDate =
      parsedGs1?.expiryDate ??
      (expiryEpochMs !== null
        ? new Date(expiryEpochMs).toISOString().slice(0, 10)
        : null);
    const manufactureDate =
      manufactureEpochMs !== null
        ? new Date(manufactureEpochMs).toISOString().slice(0, 10)
        : null;

    const lotId =
      line.lotId ??
      (input.operationKind === 'asn_receipt' &&
      (lotCode !== null || line.gs1RawBarcode != null)
        ? crypto.randomUUID()
        : null);

    return {
      index,
      productId: line.productId,
      variantId: line.variantId,
      lotId,
      lotCode,
      gs1RawBarcode: line.gs1RawBarcode ?? null,
      serialNumber,
      manufactureEpochMs,
      expiryEpochMs,
      manufactureDate,
      expiryDate,
      packageId: line.packageId ?? null,
      uom: line.uom,
      demandedQtyMicros: line.demandedQtyMicros,
      doneQtyMicros: line.doneQtyMicros,
      remainingQtyMicros: Math.max(
        0,
        line.demandedQtyMicros - line.doneQtyMicros,
      ),
      unitCostMinor: line.unitCostMinor,
      reasonCode: line.reasonCode ?? null,
      binCode: line.binCode ?? input.binCode,
    };
  });
}

function toDoWholeQty(qtyMicros: number): number {
  if (qtyMicros === 0) return 0;
  if (qtyMicros % 1_000_000 !== 0) {
    throw new AppError(
      'INVALID_DO_UNIT_QUANTITY',
      422,
      'BranchInventoryDO sync requires qtyMicros to be whole-unit multiples of 1_000_000',
      { qtyMicros },
    );
  }
  return qtyMicros / 1_000_000;
}

interface DoAllocSlice {
  lotId: string;
  qtyAllocated: number;
  lineCostMinor: number;
}

async function assertDoOk(res: Response): Promise<unknown> {
  const payload = (await res.json()) as {
    error?: { code?: string; status?: number; message?: string; details?: unknown };
  };
  if (!res.ok) {
    throw new AppError(
      payload.error?.code ?? 'BRANCH_DO_ERROR',
      res.status,
      payload.error?.message ?? 'BranchInventoryDO rejected WMS inventory mutation',
      payload.error?.details,
    );
  }
  return payload;
}

/** Synchronizes inbound receipt or outbound FEFO allocation with BranchInventoryDO before D1 commit. */
export async function syncPickingWithBranchDo(
  ctx: Pick<ExecutionContext<ShacD1Database>, 'tenantId' | 'branchDo'>,
  targetOrgId: string,
  input: ProcessInput,
  lines: PreparedMoveLine[],
): Promise<boolean> {
  if (!ctx.branchDo) return false;

  const isInbound = input.operationKind === 'asn_receipt';
  const isOutbound =
    input.operationKind === 'wave_pick' ||
    input.operationKind === 'pack' ||
    input.operationKind === 'outgoing_ship' ||
    input.operationKind === 'pos_drop';

  if (!isInbound && !isOutbound) return false;

  const stub = ctx.branchDo.getByBranchKey(`${ctx.tenantId}:${targetOrgId}`);
  let synced = false;

  for (const line of lines) {
    const doQty = toDoWholeQty(line.doneQtyMicros);
    if (doQty <= 0) continue;

    if (isInbound) {
      const lotId = line.lotId ?? crypto.randomUUID();
      line.lotId = lotId;
      const res = await stub.fetch('https://do.internal/receive-lot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientMutationId: `${input.clientMutationId}:do:${line.index}`,
          lotId,
          lotCode: line.lotCode ?? lotId,
          productId: line.productId,
          variantId: line.variantId,
          binCode: line.binCode,
          qty: doQty,
          unitCostMinor: line.unitCostMinor,
          serialNumber: line.serialNumber,
          manufactureEpochMs: line.manufactureEpochMs,
          expiryEpochMs: line.expiryEpochMs,
          quarantineStatus: 'RELEASED',
        }),
      });
      await assertDoOk(res);
      synced = true;
      continue;
    }

    const res = await stub.fetch('https://do.internal/allocate-fefo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientMutationId: `${input.clientMutationId}:do:${line.index}`,
        productId: line.productId,
        variantId: line.variantId,
        binCode: line.binCode,
        qtyRequested: doQty,
        mode: input.allocateMode,
        orderId: input.orderId ?? undefined,
      }),
    });
    const body = (await assertDoOk(res)) as {
      allocations?: DoAllocSlice[];
      qtyAllocated?: number;
    };
    const slices = body.allocations ?? [];
    if (!line.lotId && slices[0]?.lotId) {
      line.lotId = slices[0].lotId;
    }
    if (line.unitCostMinor === 0 && slices.length > 0 && body.qtyAllocated) {
      const totalCost = slices.reduce(
        (acc, s) => acc + BigInt(s.lineCostMinor),
        0n,
      );
      line.unitCostMinor = Number(totalCost / BigInt(body.qtyAllocated));
    }
    synced = true;
  }

  return synced;
}

export async function validateLocationsAndProductsScope(
  ctx: WmsDbCtx,
  sourceLocationId: string,
  destLocationId: string,
  productIds: string[],
): Promise<void> {
  if (sourceLocationId === destLocationId) {
    throw new AppError(
      'INVALID_STOCK_MOVE_LOCATIONS',
      422,
      'Source and destination locations must be distinct for double-entry stock moves',
    );
  }
  const [locRows, prodRows] = await ctx.db.batch([
    ctx.db
      .select({
        id: wmsLocations.id,
        tenantId: wmsLocations.tenantId,
        orgId: wmsLocations.orgId,
      })
      .from(wmsLocations)
      .where(
        and(
          inArray(wmsLocations.id, [sourceLocationId, destLocationId]),
          isNull(wmsLocations.deletedAt),
        ),
      ),
    ctx.db
      .select({
        id: catProducts.id,
        tenantId: catProducts.tenantId,
      })
      .from(catProducts)
      .where(
        and(
          inArray(catProducts.id, productIds),
          isNull(catProducts.deletedAt),
        ),
      ),
  ]);

  for (const row of locRows) {
    await assertWmsResourceScope(ctx, row, 'WMS location');
  }
  for (const prod of prodRows) {
    if (prod.tenantId !== ctx.tenantId) {
      throw new AppError('NOT_FOUND', 404, 'Product not found');
    }
  }
}
