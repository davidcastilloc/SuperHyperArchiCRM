import { describe, expect, it } from 'vitest';
import { parsePercentToBps, parseRateToMicros } from '../src/views/phase2-format';

describe('Commerce human decimal & basis points helpers', () => {
  it('parses FX rates to micros cleanly', () => {
    expect(parseRateToMicros('54.75')).toBe(54_750_000);
    expect(parseRateToMicros('54,75')).toBe(54_750_000);
    expect(parseRateToMicros('-5')).toBe(1_000_000);
    expect(parseRateToMicros('abc')).toBe(1_000_000);
  });

  it('parses human percentage strings to basis points cleanly and rejects negative/NaN', () => {
    expect(parsePercentToBps('15.5')).toBe(1550);
    expect(parsePercentToBps('10')).toBe(1000);
    expect(parsePercentToBps('-10')).toBe(0);
    expect(parsePercentToBps('not-a-number')).toBe(0);
  });
});
