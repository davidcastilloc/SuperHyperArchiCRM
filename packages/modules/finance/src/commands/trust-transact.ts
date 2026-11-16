import { checkIdempotency, type ShacD1Database } from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import {
  createAndTransactTrustLedger,
  transactExistingTrustLedger,
} from '../lib/trust-helpers.js';

export const trustTransactInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  ledgerId: z.string().min(1).optional(),
  ledgerKind: z
    .enum(['legal_iolta_trust', 'property_escrow', 'retainer'])
    .default('legal_iolta_trust'),
  partyId: z.string().min(1).optional(),
  matterOrLeaseId: z.string().min(1).optional(),
  bankAccountId: z.string().min(1).optional(),
  currency: z.string().min(3).max(8).default('USD'),
  txKind: z.enum(['DEPOSIT', 'DISBURSEMENT']),
  amountMinor: z.number().int().positive(),
  reference: z.string().max(128).optional(),
  description: z.string().min(1).max(500),
  customFields: z.record(z.unknown()).default({}),
});

export const trustTransactOutputSchema = z.object({
  ledgerId: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  ledgerKind: z.string(),
  partyId: z.string(),
  matterOrLeaseId: z.string(),
  bankAccountId: z.string(),
  currency: z.string(),
  txKind: z.enum(['DEPOSIT', 'DISBURSEMENT']),
  amountMinor: z.number().int().positive(),
  previousBalanceMinor: z.number().int().nonnegative(),
  balanceMinor: z.number().int().nonnegative(),
  transactionId: z.string(),
  transactionCount: z.number().int().positive(),
  status: z.string(),
  updatedAt: z.number().int(),
});

export type TrustTransactInput = z.infer<typeof trustTransactInputSchema>;
export type TrustTransactOutput = z.infer<typeof trustTransactOutputSchema>;

export const financeTrustTransactCommand = defineCommand<
  typeof trustTransactInputSchema,
  TrustTransactOutput,
  ShacD1Database
>({
  id: 'finance.trust.transact',
  moduleId: 'finance',
  method: 'POST',
  path: '/api/finance/trust/transact',
  summary:
    'Deposit to or disburse from a trust/IOLTA/escrow ledger with strict overdraft protection',
  requiredPermission: 'finance.trust.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Execute a DEPOSIT or DISBURSEMENT on fin_trust_escrow_ledgers using integer minor units; blocks overdrafts with 422 TRUST_OVERDRAFT_BLOCKED',
  },
  inputSchema: trustTransactInputSchema,
  outputSchema: trustTransactOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'finance.trust.transact',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      trustTransactOutputSchema,
    );
    if (replay) return replay;

    if (input.ledgerId) {
      return transactExistingTrustLedger(ctx, input, requestHash);
    }

    return createAndTransactTrustLedger(ctx, input, requestHash);
  },
});
