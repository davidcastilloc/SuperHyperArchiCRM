import { AppError } from '@shac/kernel';

export const QTY_MICROS_SCALE = 1_000_000n;

export type LandedCostSplitMethod =
  | 'by_value'
  | 'by_weight'
  | 'by_volume'
  | 'by_qty'
  | 'equal';

export interface AvcoValuationInput {
  currentQtyMicros: number;
  currentTotalValueMinor?: number;
  currentUnitCostMinor?: number;
  incomingQtyMicros?: number;
  incomingUnitCostMinor?: number;
  incomingTotalValueMinor?: number;
  addedCostMinor?: number;
}

export interface AvcoValuationResult {
  previousQtyMicros: number;
  previousTotalValueMinor: number;
  previousUnitCostMinor: number;
  newQtyMicros: number;
  newTotalValueMinor: number;
  newUnitCostMinor: number;
  deltaValueMinor: number;
}

export interface LandedCostLineInput {
  lineId: string;
  productId?: string;
  stockMoveId?: string;
  qtyMicros: number;
  lineValueMinor?: number;
  unitCostMinor?: number;
  weightGrams?: number;
  volumeCm3?: number;
}

export interface AllocatedLandedCostLine {
  lineId: string;
  productId: string | null;
  stockMoveId: string | null;
  qtyMicros: number;
  basisWeight: string;
  previousTotalValueMinor: number;
  allocatedCostMinor: number;
  newTotalValueMinor: number;
  newUnitCostMinor: number;
}

export interface LandedCostAllocationResult {
  method: LandedCostSplitMethod;
  totalFreightMinor: number;
  totalAllocatedMinor: number;
  remainderDistributedMinor: number;
  lines: AllocatedLandedCostLine[];
}

function assertNonNegInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError(
      'INVALID_INTEGER_MONEY',
      400,
      `${label} must be a non-negative safe integer`,
    );
  }
  return value;
}

function toSafeNumber(value: bigint, label: string): number {
  const num = Number(value);
  if (!Number.isSafeInteger(num)) {
    throw new AppError('INTEGER_OVERFLOW', 400, `${label} overflowed safe integer range`);
  }
  return num;
}

function divRoundHalfUpBigInt(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new AppError('INVALID_INTEGER_MONEY', 400, 'Denominator must be positive');
  }
  const half = denominator / 2n;
  return numerator >= 0n
    ? (numerator + half) / denominator
    : -((-numerator + half) / denominator);
}

/**
 * Computes integer AVCO (Average Cost) valuation using exact BigInt arithmetic
 * without floating-point drift across receipts and landed cost capitalizations.
 */
export function computeAvcoValuation(
  input: AvcoValuationInput,
): AvcoValuationResult {
  const curQty = BigInt(assertNonNegInt(input.currentQtyMicros, 'currentQtyMicros'));
  const incQty = BigInt(assertNonNegInt(input.incomingQtyMicros ?? 0, 'incomingQtyMicros'));
  const addedCost = BigInt(assertNonNegInt(input.addedCostMinor ?? 0, 'addedCostMinor'));

  const curUnitCost =
    input.currentUnitCostMinor !== undefined
      ? BigInt(assertNonNegInt(input.currentUnitCostMinor, 'currentUnitCostMinor'))
      : null;

  const curTotalVal =
    input.currentTotalValueMinor !== undefined
      ? BigInt(assertNonNegInt(input.currentTotalValueMinor, 'currentTotalValueMinor'))
      : curUnitCost !== null
        ? divRoundHalfUpBigInt(curQty * curUnitCost, QTY_MICROS_SCALE)
        : 0n;

  const prevUnitCost =
    curUnitCost !== null
      ? curUnitCost
      : curQty > 0n
        ? divRoundHalfUpBigInt(curTotalVal * QTY_MICROS_SCALE, curQty)
        : 0n;

  const incUnitCost =
    input.incomingUnitCostMinor !== undefined
      ? BigInt(assertNonNegInt(input.incomingUnitCostMinor, 'incomingUnitCostMinor'))
      : 0n;

  const incTotalVal =
    input.incomingTotalValueMinor !== undefined
      ? BigInt(assertNonNegInt(input.incomingTotalValueMinor, 'incomingTotalValueMinor'))
      : divRoundHalfUpBigInt(incQty * incUnitCost, QTY_MICROS_SCALE);

  const deltaVal = incTotalVal + addedCost;
  const newQty = curQty + incQty;
  const newTotalVal = curTotalVal + deltaVal;
  const newUnitCost =
    newQty > 0n
      ? divRoundHalfUpBigInt(newTotalVal * QTY_MICROS_SCALE, newQty)
      : prevUnitCost;

  return {
    previousQtyMicros: toSafeNumber(curQty, 'previousQtyMicros'),
    previousTotalValueMinor: toSafeNumber(curTotalVal, 'previousTotalValueMinor'),
    previousUnitCostMinor: toSafeNumber(prevUnitCost, 'previousUnitCostMinor'),
    newQtyMicros: toSafeNumber(newQty, 'newQtyMicros'),
    newTotalValueMinor: toSafeNumber(newTotalVal, 'newTotalValueMinor'),
    newUnitCostMinor: toSafeNumber(newUnitCost, 'newUnitCostMinor'),
    deltaValueMinor: toSafeNumber(deltaVal, 'deltaValueMinor'),
  };
}

function resolveLineValueMinor(line: LandedCostLineInput): bigint {
  if (line.lineValueMinor !== undefined) {
    return BigInt(assertNonNegInt(line.lineValueMinor, 'line.lineValueMinor'));
  }
  const qty = BigInt(assertNonNegInt(line.qtyMicros, 'line.qtyMicros'));
  const unitCost = BigInt(assertNonNegInt(line.unitCostMinor ?? 0, 'line.unitCostMinor'));
  return divRoundHalfUpBigInt(qty * unitCost, QTY_MICROS_SCALE);
}

function resolveBasisWeight(
  method: LandedCostSplitMethod,
  line: LandedCostLineInput,
  lineValueMinor: bigint,
): bigint {
  switch (method) {
    case 'equal':
      return 1n;
    case 'by_qty':
      return BigInt(assertNonNegInt(line.qtyMicros, 'line.qtyMicros'));
    case 'by_value':
      return lineValueMinor;
    case 'by_weight':
      return BigInt(assertNonNegInt(line.weightGrams ?? 0, 'line.weightGrams'));
    case 'by_volume':
      return BigInt(assertNonNegInt(line.volumeCm3 ?? 0, 'line.volumeCm3'));
  }
}

/**
 * Prorates freight, customs, or insurance minor amounts across stock move lines using
 * Hamilton largest-remainder allocation in BigInt so allocated sum equals totalFreightMinor exactly.
 */
export function allocateLandedCosts(
  method: LandedCostSplitMethod,
  totalFreightMinor: number,
  lines: readonly LandedCostLineInput[],
): LandedCostAllocationResult {
  const totalMinor = BigInt(assertNonNegInt(totalFreightMinor, 'totalFreightMinor'));
  if (lines.length === 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'At least one line is required for landed cost allocation',
    );
  }

  const prepared = lines.map((line, index) => {
    const qtyMicros = assertNonNegInt(line.qtyMicros, 'line.qtyMicros');
    const prevValue = resolveLineValueMinor(line);
    const weight = resolveBasisWeight(method, line, prevValue);
    return { index, line, qtyMicros, prevValue, weight };
  });

  const totalWeight = prepared.reduce((acc, item) => acc + item.weight, 0n);
  if (totalMinor > 0n && totalWeight <= 0n) {
    throw new AppError(
      'INVALID_LANDED_COST_BASIS',
      422,
      `Total basis weight for split method '${method}' must be positive`,
    );
  }

  const shares = prepared.map((item) => {
    if (totalMinor === 0n || totalWeight === 0n) {
      return { ...item, floorShare: 0n, remainder: 0n };
    }
    const numerator = totalMinor * item.weight;
    return {
      ...item,
      floorShare: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });

  const floorSum = shares.reduce((acc, s) => acc + s.floorShare, 0n);
  const residualUnits = totalMinor - floorSum;

  const ranked = [...shares].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder > a.remainder ? 1 : -1;
    }
    return a.index - b.index;
  });

  const bonusByIndex = new Map<number, bigint>();
  const residualCount = Number(residualUnits);
  for (let i = 0; i < residualCount; i += 1) {
    const target = ranked[i];
    if (target) {
      bonusByIndex.set(target.index, 1n);
    }
  }

  let allocatedSum = 0n;
  const allocatedLines: AllocatedLandedCostLine[] = shares.map((item) => {
    const bonus = bonusByIndex.get(item.index) ?? 0n;
    const allocated = item.floorShare + bonus;
    allocatedSum += allocated;

    const avco = computeAvcoValuation({
      currentQtyMicros: item.qtyMicros,
      currentTotalValueMinor: toSafeNumber(item.prevValue, 'previousTotalValueMinor'),
      addedCostMinor: toSafeNumber(allocated, 'allocatedCostMinor'),
    });

    return {
      lineId: item.line.lineId,
      productId: item.line.productId ?? null,
      stockMoveId: item.line.stockMoveId ?? null,
      qtyMicros: item.qtyMicros,
      basisWeight: item.weight.toString(),
      previousTotalValueMinor: avco.previousTotalValueMinor,
      allocatedCostMinor: toSafeNumber(allocated, 'allocatedCostMinor'),
      newTotalValueMinor: avco.newTotalValueMinor,
      newUnitCostMinor: avco.newUnitCostMinor,
    };
  });

  return {
    method,
    totalFreightMinor,
    totalAllocatedMinor: toSafeNumber(allocatedSum, 'totalAllocatedMinor'),
    remainderDistributedMinor: toSafeNumber(residualUnits, 'remainderDistributedMinor'),
    lines: allocatedLines,
  };
}
