import { allocateByRatios, AppError } from '@shac/kernel';

export const SPLIT_RENT_TOTAL_BPS = 10_000;

export interface SplitRentShareInput {
  partyId: string;
  shareBps: number;
}

export interface SplitRentShareAllocation extends SplitRentShareInput {
  amountMinor: number;
}

/**
 * Splits `totalMinor` across participants using exact BigInt basis-point math.
 * Validates `sum(shareBps) === 10_000` and distributes any integer remainder
 * deterministically (largest remainder first, tie-broken by input order)
 * so `sum(amountsMinor) === totalMinor`.
 */
export function computeSplitRentShares<T extends SplitRentShareInput>(
  totalMinor: number,
  shares: readonly T[],
): Array<T & SplitRentShareAllocation> {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'totalMinor must be a non-negative safe integer',
    );
  }
  if (shares.length === 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'At least one split rent share is required',
    );
  }

  let bpsSum = 0;
  for (const share of shares) {
    if (!share.partyId || share.partyId.trim().length === 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'Each split rent share must specify a non-empty partyId',
      );
    }
    if (
      !Number.isSafeInteger(share.shareBps) ||
      share.shareBps < 0 ||
      share.shareBps > SPLIT_RENT_TOTAL_BPS
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        `shareBps must be an integer between 0 and ${SPLIT_RENT_TOTAL_BPS}`,
      );
    }
    bpsSum += share.shareBps;
  }

  if (bpsSum !== SPLIT_RENT_TOTAL_BPS) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `Split rent shares must sum to ${SPLIT_RENT_TOTAL_BPS} bps (got ${bpsSum})`,
    );
  }

  const allocated = allocateByRatios(
    BigInt(totalMinor),
    shares.map((s) => BigInt(s.shareBps)),
  );

  return shares.map((share, index) => ({
    ...share,
    amountMinor: Number(allocated[index] ?? 0n),
  }));
}
