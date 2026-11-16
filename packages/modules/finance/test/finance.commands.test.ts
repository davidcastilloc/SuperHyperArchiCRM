import { AppError } from '@shac/kernel';
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  financeJournalPostCommand,
  financeTrustTransactCommand,
  modFinanceManifest,
} from '../src/index.js';
import { buildFinanceCtx, setupFinanceD1 } from './test-helpers.js';

describe('@shac/mod-finance workerd commands', () => {
  beforeAll(async () => {
    await setupFinanceD1(env.DB);
  });

  it('exposes modFinanceManifest with MCP-enabled commands', () => {
    expect(modFinanceManifest.id).toBe('finance');
    expect(modFinanceManifest.commands.map((c) => c.id)).toEqual([
      'finance.trust.transact',
      'finance.journal.post',
    ]);
    for (const cmd of modFinanceManifest.commands) {
      expect(cmd.moduleId).toBe('finance');
      expect(cmd.mcp?.expose).toBe(true);
    }
  });

  it('handles Trust/IOLTA deposit, valid disbursement, overdraft block (422), and idempotency', async () => {
    const { ctx } = buildFinanceCtx(env.DB);

    const depositInput = financeTrustTransactCommand.inputSchema.parse({
      clientMutationId: 'mut_trust_dep_1',
      partyId: 'party_1',
      matterOrLeaseId: 'matter_101',
      bankAccountId: 'bank_iolta_1',
      txKind: 'DEPOSIT',
      amountMinor: 50_000,
      reference: 'WIRE-001',
      description: 'Initial IOLTA retainer deposit',
    });
    const deposited = await financeTrustTransactCommand.handler(ctx, depositInput);
    expect(deposited.balanceMinor).toBe(50_000);
    expect(deposited.previousBalanceMinor).toBe(0);
    expect(deposited.transactionCount).toBe(1);

    const replay = await financeTrustTransactCommand.handler(ctx, depositInput);
    expect(replay).toEqual(deposited);

    const disburseInput = financeTrustTransactCommand.inputSchema.parse({
      clientMutationId: 'mut_trust_disb_1',
      ledgerId: deposited.ledgerId,
      txKind: 'DISBURSEMENT',
      amountMinor: 15_000,
      reference: 'CHK-1001',
      description: 'Court filing fee disbursement',
    });
    const disbursed = await financeTrustTransactCommand.handler(ctx, disburseInput);
    expect(disbursed.previousBalanceMinor).toBe(50_000);
    expect(disbursed.balanceMinor).toBe(35_000);
    expect(disbursed.transactionCount).toBe(2);

    const overdraftInput = financeTrustTransactCommand.inputSchema.parse({
      clientMutationId: 'mut_trust_overdraft_1',
      ledgerId: deposited.ledgerId,
      txKind: 'DISBURSEMENT',
      amountMinor: 35_001,
      description: 'Attempted overdraft disbursement',
    });

    await expect(
      financeTrustTransactCommand.handler(ctx, overdraftInput),
    ).rejects.toMatchObject({
      code: 'TRUST_OVERDRAFT_BLOCKED',
      status: 422,
    });

    const row = await env.DB.prepare(
      'SELECT balance_minor, version FROM fin_trust_escrow_ledgers WHERE id = ?',
    )
      .bind(deposited.ledgerId)
      .first<{ balance_minor: number; version: number }>();
    expect(row?.balance_minor).toBe(35_000);
    expect(row?.version).toBe(2);

    const zeroOverdraft = financeTrustTransactCommand.inputSchema.parse({
      clientMutationId: 'mut_trust_zero_overdraft',
      partyId: 'party_1',
      matterOrLeaseId: 'matter_102',
      bankAccountId: 'bank_iolta_1',
      txKind: 'DISBURSEMENT',
      amountMinor: 100,
      description: 'Cannot disburse from zero-balance new ledger',
    });
    await expect(
      financeTrustTransactCommand.handler(ctx, zeroOverdraft),
    ).rejects.toMatchObject({
      code: 'TRUST_OVERDRAFT_BLOCKED',
      status: 422,
    });
  });

  it('posts balanced journal entries, rejects unbalanced ones (422), and honors idempotency', async () => {
    const { ctx } = buildFinanceCtx(env.DB);

    const unbalancedInput = financeJournalPostCommand.inputSchema.parse({
      clientMutationId: 'mut_je_unbal_1',
      entryNumber: 'JE-2026-0001',
      entryDate: 1763300100,
      fiscalYear: 2026,
      fiscalPeriod: 11,
      description: 'Unbalanced test entry',
      lines: [
        { accountCode: '1010', debitMinor: 100_000, creditMinor: 0 },
        { accountCode: '4010', debitMinor: 0, creditMinor: 99_999 },
      ],
    });

    await expect(
      financeJournalPostCommand.handler(ctx, unbalancedInput),
    ).rejects.toMatchObject({
      code: 'UNBALANCED_JOURNAL_ENTRY',
      status: 422,
    });

    const beforeCount = await env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM fin_journal_entries WHERE entry_number = ?',
    )
      .bind('JE-2026-0001')
      .first<{ cnt: number }>();
    expect(beforeCount?.cnt).toBe(0);

    const balancedInput = financeJournalPostCommand.inputSchema.parse({
      clientMutationId: 'mut_je_bal_1',
      entryNumber: 'JE-2026-0002',
      entryDate: 1763300200,
      fiscalYear: 2026,
      fiscalPeriod: 11,
      reference: 'INV-9001',
      description: 'Balanced retainer recognition',
      lines: [
        { accountCode: '1010', debitMinor: 125_000, creditMinor: 0, memo: 'Cash' },
        { accountCode: '2100', debitMinor: 0, creditMinor: 100_000, memo: 'Retainer' },
        { accountCode: '4010', debitMinor: 0, creditMinor: 25_000, memo: 'Fee' },
      ],
    });

    const posted = await financeJournalPostCommand.handler(ctx, balancedInput);
    expect(posted.totalDebitMinor).toBe(125_000);
    expect(posted.totalCreditMinor).toBe(125_000);
    expect(posted.status).toBe('posted');
    expect(posted.lineCount).toBe(3);

    const replay = await financeJournalPostCommand.handler(ctx, balancedInput);
    expect(replay).toEqual(posted);
  });

  it('enforces 404 and 403 tenant/org isolation', async () => {
    const { ctx: northCtx } = buildFinanceCtx(env.DB);
    const { ctx: ten2Ctx } = buildFinanceCtx(env.DB, {
      tenantId: 'ten_2',
      orgId: 'org_2',
      orgPath: '/org_2',
    });

    const missingLedgerInput = financeTrustTransactCommand.inputSchema.parse({
      clientMutationId: 'mut_trust_404',
      ledgerId: 'ledger_does_not_exist',
      txKind: 'DEPOSIT',
      amountMinor: 1000,
      description: 'Missing ledger',
    });
    await expect(
      financeTrustTransactCommand.handler(northCtx, missingLedgerInput),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<AppError>);

    const created = await financeTrustTransactCommand.handler(
      northCtx,
      financeTrustTransactCommand.inputSchema.parse({
        clientMutationId: 'mut_trust_iso_seed',
        partyId: 'party_1',
        matterOrLeaseId: 'matter_iso',
        bankAccountId: 'bank_iolta_1',
        txKind: 'DEPOSIT',
        amountMinor: 10_000,
        description: 'Seed for isolation test',
      }),
    );

    await expect(
      financeTrustTransactCommand.handler(
        ten2Ctx,
        financeTrustTransactCommand.inputSchema.parse({
          clientMutationId: 'mut_trust_404_cross_tenant',
          ledgerId: created.ledgerId,
          txKind: 'DISBURSEMENT',
          amountMinor: 500,
          description: 'Cross-tenant access attempt',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<AppError>);

    await expect(
      financeJournalPostCommand.handler(
        northCtx,
        financeJournalPostCommand.inputSchema.parse({
          clientMutationId: 'mut_je_403_south',
          orgId: 'org_1_south',
          entryNumber: 'JE-2026-0403',
          entryDate: 1763300300,
          fiscalYear: 2026,
          fiscalPeriod: 11,
          description: 'Cross-branch post attempt',
          lines: [
            { accountCode: '1010', debitMinor: 1000, creditMinor: 0 },
            { accountCode: '4010', debitMinor: 0, creditMinor: 1000 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<AppError>);
  });
});
