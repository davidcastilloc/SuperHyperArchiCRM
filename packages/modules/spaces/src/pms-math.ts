import { AppError } from '@shac/kernel';

export interface AdrRevParInput {
  roomRevenueMinor: number;
  occupiedUnits: number;
  totalAvailableUnits: number;
}

export interface AdrRevParResult {
  roomRevenueMinor: number;
  occupiedUnits: number;
  totalAvailableUnits: number;
  adrMinor: number;
  revParMinor: number;
  occupancyBps: number;
}

function assertNonNegativeSafeInt(value: number, field: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `${field} must be a non-negative safe integer`,
    );
  }
  return BigInt(value);
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n || numerator === 0n) {
    return 0;
  }
  const rounded = (numerator * 2n + denominator) / (2n * denominator);
  const asNum = Number(rounded);
  if (!Number.isSafeInteger(asNum)) {
    throw new AppError(
      'ARITHMETIC_OVERFLOW',
      422,
      'Computed PMS metric exceeds safe integer range',
    );
  }
  return asNum;
}

/**
 * Computes integer ADR, RevPAR (in minor currency units), and occupancy (bps)
 * using BigInt half-up rounding with zero floating-point arithmetic.
 */
export function computeAdrAndRevParMinor(
  input: AdrRevParInput,
): AdrRevParResult {
  const revenue = assertNonNegativeSafeInt(
    input.roomRevenueMinor,
    'roomRevenueMinor',
  );
  const occupied = assertNonNegativeSafeInt(
    input.occupiedUnits,
    'occupiedUnits',
  );
  const available = assertNonNegativeSafeInt(
    input.totalAvailableUnits,
    'totalAvailableUnits',
  );

  if (occupied > available) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'occupiedUnits cannot exceed totalAvailableUnits',
    );
  }

  return {
    roomRevenueMinor: input.roomRevenueMinor,
    occupiedUnits: input.occupiedUnits,
    totalAvailableUnits: input.totalAvailableUnits,
    adrMinor: divideRoundHalfUp(revenue, occupied),
    revParMinor: divideRoundHalfUp(revenue, available),
    occupancyBps: divideRoundHalfUp(occupied * 10_000n, available),
  };
}
