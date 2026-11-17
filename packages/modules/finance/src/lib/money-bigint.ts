import { AppError, assertZeroSumBalanced } from '@shac/kernel';

export function toBigIntMinor(value: number | bigint, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (!Number.isSafeInteger(value)) {
    throw new AppError(
      'INVALID_MONETARY_AMOUNT',
      422,
      `${fieldName} must be a safe integer in minor units`,
      { fieldName },
    );
  }
  return BigInt(value);
}

export function toSafeNumberMinor(value: bigint, fieldName: string): number {
  if (
    value < BigInt(Number.MIN_SAFE_INTEGER) ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new AppError(
      'MONETARY_OVERFLOW',
      422,
      `${fieldName} exceeds safe integer bounds`,
      { fieldName },
    );
  }
  return Number(value);
}

export type TrustTxKind = 'DEPOSIT' | 'DISBURSEMENT';

export type TrustBalanceComputation =
  | { ok: true; nextBalanceMinor: bigint }
  | { ok: false; currentBalanceMinor: bigint; requestedAmountMinor: bigint };

export function computeNextTrustBalanceMinor(
  currentBalanceMinor: bigint,
  txKind: TrustTxKind,
  amountMinor: bigint,
): TrustBalanceComputation {
  if (amountMinor <= 0n) {
    throw new AppError(
      'INVALID_MONETARY_AMOUNT',
      422,
      'Trust transaction amountMinor must be strictly positive',
    );
  }
  if (txKind === 'DEPOSIT') {
    return { ok: true, nextBalanceMinor: currentBalanceMinor + amountMinor };
  }
  if (currentBalanceMinor < amountMinor) {
    return {
      ok: false,
      currentBalanceMinor,
      requestedAmountMinor: amountMinor,
    };
  }
  return { ok: true, nextBalanceMinor: currentBalanceMinor - amountMinor };
}

export interface JournalLineInput {
  accountCode: string;
  accountId?: string;
  debitMinor: number;
  creditMinor: number;
  memo?: string;
}

export interface JournalBalanceSummary {
  totalDebitMinor: bigint;
  totalCreditMinor: bigint;
  isBalanced: boolean;
}

export function sumJournalLinesBigInt(
  lines: readonly JournalLineInput[],
): JournalBalanceSummary {
  const debits: bigint[] = [];
  const credits: bigint[] = [];

  for (const line of lines) {
    const debit = toBigIntMinor(line.debitMinor, 'debitMinor');
    const credit = toBigIntMinor(line.creditMinor, 'creditMinor');
    if (debit < 0n || credit < 0n) {
      throw new AppError(
        'INVALID_MONETARY_AMOUNT',
        422,
        'Journal line debitMinor and creditMinor must be non-negative',
      );
    }
    debits.push(debit);
    credits.push(credit);
  }

  const totalDebitMinor = debits.reduce((a, b) => a + b, 0n);
  const totalCreditMinor = credits.reduce((a, b) => a + b, 0n);
  let isBalanced = false;
  try {
    assertZeroSumBalanced(debits, credits);
    isBalanced = true;
  } catch {
    isBalanced = false;
  }

  return {
    totalDebitMinor,
    totalCreditMinor,
    isBalanced,
  };
}
