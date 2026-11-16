import { AppError } from '@shac/kernel';
import { MICROS_SCALE } from '@shac/mod-catalog';

export const BIG_MICROS_SCALE = BigInt(MICROS_SCALE);

export function normalizeCurrency(code: string, label = 'currency'): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9_]{3,8}$/.test(normalized)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      `${label} must be a 3-8 character alphanumeric currency code`,
    );
  }
  return normalized;
}

export function assertNonNegativeSafeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError(
      'INVALID_INTEGER_MONEY',
      400,
      `${label} must be a non-negative safe integer`,
    );
  }
  return value;
}

export function assertPositiveRateMicros(
  rateMicros: number,
  label = 'rateMicros',
): number {
  if (!Number.isSafeInteger(rateMicros) || rateMicros <= 0) {
    throw new AppError(
      'INVALID_FX_RATE',
      400,
      `${label} must be a positive safe integer`,
    );
  }
  return rateMicros;
}

export function toSafeInt(value: bigint, label: string): number {
  const num = Number(value);
  if (!Number.isSafeInteger(num)) {
    throw new AppError(
      'INTEGER_OVERFLOW',
      400,
      `${label} exceeds safe integer bounds`,
    );
  }
  return num;
}

export function divRoundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) {
    throw new AppError('INVALID_INTEGER_MONEY', 400, 'Denominator must be positive');
  }
  const half = denominator / 2n;
  const result =
    numerator >= 0n
      ? (numerator + half) / denominator
      : -((-numerator + half) / denominator);
  return toSafeInt(result, 'divRoundHalfUp');
}

/**
 * Enforces the Cuenta=Moneda invariant before any D1 or BranchInventoryDO mutation.
 */
export function assertAccountCurrencyMatch(
  accountCurrency: string,
  paymentCurrency: string,
): string {
  const acct = normalizeCurrency(accountCurrency, 'accountCurrency');
  const pay = normalizeCurrency(paymentCurrency, 'paymentCurrency');
  if (acct !== pay) {
    throw new AppError(
      'ERR_CURRENCY_ACCOUNT_MISMATCH',
      422,
      `ERR_CURRENCY_ACCOUNT_MISMATCH: account currency ${acct} does not match payment currency ${pay}`,
      { accountCurrency: acct, paymentCurrency: pay },
    );
  }
  return pay;
}
