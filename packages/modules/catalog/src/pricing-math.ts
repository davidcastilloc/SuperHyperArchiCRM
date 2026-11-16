import { AppError } from '@shac/kernel';

export const MICROS_SCALE = 1_000_000;
export const BPS_SCALE = 10_000;
export const OMNIBUS_WINDOW_SEC = 30 * 86_400;

export interface OmnibusPricePoint {
  priceMinor: number;
  lowest30dMinor?: number | null;
  recordedAt: number;
}

export function assertSafeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new AppError(
      'INVALID_INTEGER_MONEY',
      400,
      `${label} must be a safe integer`,
    );
  }
  return value;
}

/** Divides signed integer numerator by positive integer denominator, rounding half away from zero. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) {
    throw new AppError('INVALID_INTEGER_MONEY', 400, 'Denominator must be positive');
  }
  const half = denominator / 2n;
  const result =
    numerator >= 0n
      ? (numerator + half) / denominator
      : -((-numerator + half) / denominator);
  const num = Number(result);
  if (!Number.isSafeInteger(num)) {
    throw new AppError('INTEGER_OVERFLOW', 400, 'Integer arithmetic overflow');
  }
  return num;
}

/** Scales an integer minor amount by a micro-factor (`* 1_000_000`) using pure integer math. */
export function multiplyMicros(amountMinor: number, factorMicros: number): number {
  assertSafeInt(amountMinor, 'amountMinor');
  assertSafeInt(factorMicros, 'factorMicros');
  return divRoundHalfUp(
    BigInt(amountMinor) * BigInt(factorMicros),
    BigInt(MICROS_SCALE),
  );
}

/** Converts a primary currency minor amount to secondary currency minor units via `rateMicros`. */
export function convertCurrencyMinor(amountMinor: number, rateMicros: number): number {
  assertSafeInt(amountMinor, 'amountMinor');
  assertSafeInt(rateMicros, 'rateMicros');
  if (rateMicros <= 0) {
    throw new AppError('INVALID_FX_RATE', 400, 'rateMicros must be positive');
  }
  return multiplyMicros(amountMinor, rateMicros);
}

/** Computes basis-points gross margin: `((unitPrice - unitCost) / unitPrice) * 10_000`. */
export function computeMarginBps(unitPriceMinor: number, unitCostMinor: number): number {
  assertSafeInt(unitPriceMinor, 'unitPriceMinor');
  assertSafeInt(unitCostMinor, 'unitCostMinor');
  if (unitPriceMinor <= 0) {
    return unitPriceMinor === 0 && unitCostMinor === 0 ? 0 : -BPS_SCALE;
  }
  const profit = BigInt(unitPriceMinor - unitCostMinor);
  return divRoundHalfUp(profit * BigInt(BPS_SCALE), BigInt(unitPriceMinor));
}

/** Computes basis-points tax/discount amount using half-up integer rounding. */
export function computeBpsAmount(amountMinor: number, bps: number): number {
  assertSafeInt(amountMinor, 'amountMinor');
  assertSafeInt(bps, 'bps');
  return divRoundHalfUp(BigInt(amountMinor) * BigInt(bps), BigInt(BPS_SCALE));
}

/** Finds the lowest recorded price within the rolling 30-day EU Omnibus window. */
export function computeLowest30dMinor(
  history: readonly OmnibusPricePoint[],
  nowSec: number,
): number | null {
  assertSafeInt(nowSec, 'nowSec');
  const windowStart = nowSec - OMNIBUS_WINDOW_SEC;
  let lowest: number | null = null;
  for (const point of history) {
    assertSafeInt(point.priceMinor, 'omnibus.priceMinor');
    assertSafeInt(point.recordedAt, 'omnibus.recordedAt');
    if (point.recordedAt < windowStart || point.recordedAt > nowSec) {
      continue;
    }
    const candidate =
      point.lowest30dMinor !== null && point.lowest30dMinor !== undefined
        ? Math.min(
            point.priceMinor,
            assertSafeInt(point.lowest30dMinor, 'omnibus.lowest30dMinor'),
          )
        : point.priceMinor;
    if (lowest === null || candidate < lowest) {
      lowest = candidate;
    }
  }
  return lowest;
}
