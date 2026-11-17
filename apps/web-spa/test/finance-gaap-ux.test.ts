import { describe, expect, it } from 'vitest';
import { validateBalancedJournalLines } from '../src/views/GlJournalBuilder';

describe('Finance GAAP & Deal Kanban UX', () => {
  it('validates multi-line GL journal balance in integer minor units', () => {
    expect(
      validateBalancedJournalLines([
        { accountCode: '1010-CASH', debitInput: '100.00', creditInput: '0.00' },
        { accountCode: '4010-REV', debitInput: '0.00', creditInput: '90.00' },
      ]),
    ).toEqual({
      valid: false,
      totalDebitMinor: 10_000,
      totalCreditMinor: 9_000,
      diffMinor: 1_000,
    });

    expect(
      validateBalancedJournalLines([
        { accountCode: '1010-CASH', debitInput: '100.00', creditInput: '0.00' },
        { accountCode: '4010-REV', debitInput: '0.00', creditInput: '60.00' },
        { accountCode: '2010-TAX', debitInput: '0.00', creditInput: '40.00' },
      ]),
    ).toEqual({
      valid: true,
      totalDebitMinor: 10_000,
      totalCreditMinor: 10_000,
      diffMinor: 0,
    });

    expect(
      validateBalancedJournalLines([
        { accountCode: '1010-CASH', debitInput: '100.00', creditInput: '100.00' },
      ]).valid,
    ).toBe(false);
  });

  it('computes bidirectional adjacent stages for DealsKanbanView', async () => {
    const { getAdjacentDealStages } = await import('../src/views/DealsKanbanView.js');
    expect(getAdjacentDealStages('stage_proposal')).toEqual({
      prev: 'stage_qualified',
      next: 'stage_negotiation',
    });
    expect(getAdjacentDealStages('stage_qualified').prev).toBeNull();
  });
});
