export type CurrencyCode =
  | 'USD'
  | 'EUR'
  | 'MXN'
  | 'COP'
  | 'CLP'
  | 'BRL'
  | 'PEN'
  | 'ARS'
  | (string & {});

export interface MoneySnapshot {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
  readonly scale: number;
}

export function roundHalfEvenBigInt(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error('MONEY_DIVISION_BY_ZERO');
  }
  const sign = (numerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  const num = numerator < 0n ? -numerator : numerator;
  const den = denominator < 0n ? -denominator : denominator;

  const quotient = num / den;
  const remainder = num % den;
  const twiceRemainder = remainder * 2n;

  if (twiceRemainder > den) {
    return sign * (quotient + 1n);
  }
  if (twiceRemainder < den) {
    return sign * quotient;
  }
  return quotient % 2n === 0n ? sign * quotient : sign * (quotient + 1n);
}

/**
 * Reparte `totalMinor` proporcionalmente a `weights` garantizando invariante de suma exacta:
 * sum(result) === totalMinor (sin perder ni inventar 1 centavo).
 */
export function allocateByRatios(
  totalMinor: bigint,
  weights: readonly (number | bigint)[],
): bigint[] {
  if (weights.length === 0) return [];
  const bigWeights = weights.map((w) => {
    const bw = typeof w === 'bigint' ? w : BigInt(Math.round(Number(w) * 1_000_000));
    if (bw < 0n) throw new Error('MONEY_NEGATIVE_WEIGHT_FORBIDDEN');
    return bw;
  });

  const totalWeight = bigWeights.reduce((acc, w) => acc + w, 0n);
  if (totalWeight === 0n) {
    throw new Error('MONEY_ZERO_TOTAL_WEIGHT');
  }

  const sign = totalMinor < 0n ? -1n : 1n;
  const absTotal = totalMinor < 0n ? -totalMinor : totalMinor;

  const floors: bigint[] = [];
  const remainders: { index: number; rem: bigint }[] = [];
  let allocated = 0n;

  for (let i = 0; i < bigWeights.length; i++) {
    const prod = absTotal * bigWeights[i]!;
    const q = prod / totalWeight;
    const r = prod % totalWeight;
    floors.push(q);
    allocated += q;
    remainders.push({ index: i, rem: r });
  }

  let leftover = absTotal - allocated;
  remainders.sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.index - b.index));

  for (let i = 0; leftover > 0n && i < remainders.length; i++) {
    floors[remainders[i]!.index]! += 1n;
    leftover -= 1n;
  }

  return floors.map((v) => v * sign);
}

export function assertZeroSumBalanced(
  debitsMinor: readonly bigint[],
  creditsMinor: readonly bigint[],
): {
  totalDebit: bigint;
  totalCredit: bigint;
} {
  const totalDebit = debitsMinor.reduce((a, b) => a + b, 0n);
  const totalCredit = creditsMinor.reduce((a, b) => a + b, 0n);
  if (totalDebit <= 0n || totalDebit !== totalCredit) {
    throw new Error(
      `UNBALANCED_JOURNAL_ENTRY: debit=${totalDebit.toString()} credit=${totalCredit.toString()}`,
    );
  }
  return { totalDebit, totalCredit };
}
