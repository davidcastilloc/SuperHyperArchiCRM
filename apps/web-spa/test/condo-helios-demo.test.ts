import { describe, expect, it } from 'vitest';
import { computeUiSplitPreview } from '../src/views/SplitRentLeaseModal';

describe('Condo Split Rent, Helios QR/PIN & Demo Playbooks UX', () => {
  it('validates Split Rent shares summing to 10000 bps (100.00%) in integer math', () => {
    expect(
      computeUiSplitPreview(100_000, [
        { partyId: 'p1', percentInput: '60' },
        { partyId: 'p2', percentInput: '40' },
      ]),
    ).toEqual({
      valid: true,
      totalBps: 10_000,
      allocations: [
        { partyId: 'p1', shareBps: 6_000, amountMinor: 60_000 },
        { partyId: 'p2', shareBps: 4_000, amountMinor: 40_000 },
      ],
    });

    const invalid = computeUiSplitPreview(100_000, [
      { partyId: 'p1', percentInput: '50' },
      { partyId: 'p2', percentInput: '40' },
    ]);
    expect(invalid.valid).toBe(false);
    expect(invalid.totalBps).toBe(9_000);
  });
});
