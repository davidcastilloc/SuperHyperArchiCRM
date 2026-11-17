import { describe, expect, it } from 'vitest';
import {
  allocateByRatios,
  assertZeroSumBalanced,
  roundHalfEvenBigInt,
} from '../src/index.js';

describe('@shac/kernel money primitives', () => {
  it('rounds half-to-even (bankers rounding) for positive and negative numerators', () => {
    expect(roundHalfEvenBigInt(5n, 2n)).toBe(2n);
    expect(roundHalfEvenBigInt(7n, 2n)).toBe(4n);
    expect(roundHalfEvenBigInt(-5n, 2n)).toBe(-2n);
    expect(roundHalfEvenBigInt(-7n, 2n)).toBe(-4n);
    expect(() => roundHalfEvenBigInt(10n, 0n)).toThrow('MONEY_DIVISION_BY_ZERO');
  });

  it('allocates amounts by ratios preserving exact sum invariant', () => {
    const parts = allocateByRatios(100n, [1, 1, 1]);
    expect(parts).toEqual([34n, 33n, 33n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);

    const negParts = allocateByRatios(-100n, [1n, 2n, 3n]);
    expect(negParts.reduce((a, b) => a + b, 0n)).toBe(-100n);

    expect(() => allocateByRatios(100n, [0, 0])).toThrow('MONEY_ZERO_TOTAL_WEIGHT');
    expect(() => allocateByRatios(100n, [-1, 2])).toThrow('MONEY_NEGATIVE_WEIGHT_FORBIDDEN');
  });

  it('asserts zero-sum balanced double-entry journals', () => {
    expect(assertZeroSumBalanced([500n, 250n], [750n])).toEqual({
      totalDebit: 750n,
      totalCredit: 750n,
    });
    expect(() => assertZeroSumBalanced([500n], [499n])).toThrow('UNBALANCED_JOURNAL_ENTRY');
    expect(() => assertZeroSumBalanced([0n], [0n])).toThrow('UNBALANCED_JOURNAL_ENTRY');
  });
});
