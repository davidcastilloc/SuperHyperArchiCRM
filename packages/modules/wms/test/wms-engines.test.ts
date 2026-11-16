import { describe, expect, it } from 'vitest';
import {
  assertValidGs1CheckDigit,
  computeGs1CheckDigit,
  parseGs1Barcode,
} from '../src/gs1-parser.js';
import {
  allocateLandedCosts,
  computeAvcoValuation,
} from '../src/valuation-engine.js';

describe('@shac/mod-wms pure GS1-128 parser & valuation engine', () => {
  it('parses parenthesized and FNC1 GS1-128 barcodes and validates Modulo-10', () => {
    expect(computeGs1CheckDigit('0750103131130')).toBe(9);
    assertValidGs1CheckDigit('07501031311309');

    const parsed = parseGs1Barcode(
      '(01)07501031311309(10)LOT2026A(17)271231(21)SER991',
    );
    expect(parsed.gtin).toBe('07501031311309');
    expect(parsed.lotCode).toBe('LOT2026A');
    expect(parsed.expiryDate).toBe('2027-12-31');
    expect(parsed.expiryEpochMs).toBe(Date.UTC(2027, 11, 31, 23, 59, 59, 999));
    expect(parsed.serialNumber).toBe('SER991');

    const rawFnc1 = parseGs1Barcode(
      ']C1010750103131130910LOT2026A\x1d1727123121SER991',
    );
    expect(rawFnc1.gtin).toBe('07501031311309');
    expect(rawFnc1.lotCode).toBe('LOT2026A');
    expect(rawFnc1.expiryEpochMs).toBe(parsed.expiryEpochMs);
    expect(rawFnc1.serialNumber).toBe('SER991');

    const monthEnd = parseGs1Barcode('(01)07501031311309(17)280200');
    expect(monthEnd.expiryDate).toBe('2028-02-29');
  });

  it('rejects adulterated GTIN Modulo-10 check digit with 400 INVALID_GS1_CHECK_DIGIT', () => {
    expect(() =>
      parseGs1Barcode('(01)07501031311300(10)LOT2026A(17)271231'),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_GS1_CHECK_DIGIT',
        status: 400,
      }),
    );

    expect(() => parseGs1Barcode('')).toThrowError(
      expect.objectContaining({ code: 'INVALID_GS1_BARCODE', status: 400 }),
    );
    expect(() => parseGs1Barcode('(17)270230')).toThrowError(
      expect.objectContaining({ code: 'INVALID_GS1_BARCODE', status: 400 }),
    );
  });

  it('computes exact BigInt AVCO valuation across receipts and added landed cost', () => {
    const first = computeAvcoValuation({
      currentQtyMicros: 10_000_000,
      currentUnitCostMinor: 100,
      incomingQtyMicros: 10_000_000,
      incomingUnitCostMinor: 200,
    });
    expect(first.newQtyMicros).toBe(20_000_000);
    expect(first.newTotalValueMinor).toBe(3_000);
    expect(first.newUnitCostMinor).toBe(150);

    const capitalized = computeAvcoValuation({
      currentQtyMicros: first.newQtyMicros,
      currentTotalValueMinor: first.newTotalValueMinor,
      addedCostMinor: 1_000,
    });
    expect(capitalized.newTotalValueMinor).toBe(4_000);
    expect(capitalized.newUnitCostMinor).toBe(200);
  });

  it('allocates landed costs with exact deterministic remainder (334 + 333 + 333 = 1000)', () => {
    const equalLines = [
      { lineId: 'l1', productId: 'p1', qtyMicros: 10_000_000, lineValueMinor: 5_000, weightGrams: 1_000, volumeCm3: 2_000 },
      { lineId: 'l2', productId: 'p2', qtyMicros: 10_000_000, lineValueMinor: 5_000, weightGrams: 1_000, volumeCm3: 2_000 },
      { lineId: 'l3', productId: 'p3', qtyMicros: 10_000_000, lineValueMinor: 5_000, weightGrams: 1_000, volumeCm3: 2_000 },
    ];

    for (const method of ['equal', 'by_value', 'by_weight', 'by_volume', 'by_qty'] as const) {
      const res = allocateLandedCosts(method, 1_000, equalLines);
      expect(res.totalAllocatedMinor).toBe(1_000);
      expect(res.remainderDistributedMinor).toBe(1);
      expect(res.lines.map((l) => l.allocatedCostMinor)).toEqual([334, 333, 333]);
      expect(res.lines[0]?.newUnitCostMinor).toBe(533);
      expect(res.lines[1]?.newUnitCostMinor).toBe(533);
    }

    const weighted = allocateLandedCosts('by_weight', 100, [
      { lineId: 'a', qtyMicros: 1_000_000, unitCostMinor: 500, weightGrams: 1_000 },
      { lineId: 'b', qtyMicros: 2_000_000, unitCostMinor: 500, weightGrams: 2_000 },
    ]);
    expect(weighted.totalAllocatedMinor).toBe(100);
    expect(weighted.lines.map((l) => l.allocatedCostMinor)).toEqual([33, 67]);

    expect(() =>
      allocateLandedCosts('by_weight', 500, [
        { lineId: 'z', qtyMicros: 1_000_000, weightGrams: 0 },
      ]),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_LANDED_COST_BASIS', status: 422 }),
    );
  });
});
