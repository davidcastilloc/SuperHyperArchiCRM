import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  buildNextAuditChainInsert,
  finTrustEscrowLedgers,
} from '@shac/db-d1';
import { AppError } from '@shac/kernel';
import { and, eq, gte, isNull } from 'drizzle-orm';
import type {
  TrustTransactInput,
  TrustTransactOutput,
} from '../commands/trust-transact.js';
import {
  computeNextTrustBalanceMinor,
  toBigIntMinor,
  toSafeNumberMinor,
} from './money-bigint.js';
import {
  assertTrustLedgerInScope,
  buildPartyScopeQuery,
  parseJsonArray,
  parseJsonRecord,
  resolveScopedTargetOrg,
  verifyScopedRow,
  type FinanceCtx,
} from './scope-helpers.js';

function buildTxEntry(
  ctx: FinanceCtx,
  input: TrustTransactInput,
  txId: string,
  previousBalanceMinor: number,
  balanceAfterMinor: number,
  nowSec: number,
) {
  return {
    id: txId,
    txKind: input.txKind,
    amountMinor: input.amountMinor,
    previousBalanceMinor,
    balanceAfterMinor,
    reference: input.reference ?? null,
    description: input.description,
    recordedByActorId: ctx.actor.id,
    recordedAt: nowSec,
  };
}

export async function transactExistingTrustLedger(
  ctx: FinanceCtx,
  input: TrustTransactInput,
  requestHash: string,
): Promise<TrustTransactOutput> {
  const ledger = await assertTrustLedgerInScope(ctx, input.ledgerId!);
  const amountMinorBig = toBigIntMinor(input.amountMinor, 'amountMinor');
  const currentBalanceBig = toBigIntMinor(ledger.balanceMinor, 'balanceMinor');
  const computed = computeNextTrustBalanceMinor(
    currentBalanceBig,
    input.txKind,
    amountMinorBig,
  );

  if (!computed.ok) {
    throw new AppError(
      'TRUST_OVERDRAFT_BLOCKED',
      422,
      'Trust/escrow disbursement exceeds available ledger balance',
      {
        ledgerId: ledger.id,
        currentBalanceMinor: toSafeNumberMinor(
          computed.currentBalanceMinor,
          'currentBalanceMinor',
        ),
        requestedAmountMinor: toSafeNumberMinor(
          computed.requestedAmountMinor,
          'requestedAmountMinor',
        ),
      },
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const txId = crypto.randomUUID();
  const nextBalanceMinor = toSafeNumberMinor(
    computed.nextBalanceMinor,
    'balanceMinor',
  );
  const existingTxs = parseJsonArray(ledger.transactionsJson);
  const nextTxs = [
    ...existingTxs,
    buildTxEntry(ctx, input, txId, ledger.balanceMinor, nextBalanceMinor, nowSec),
  ];

  const output: TrustTransactOutput = {
    ledgerId: ledger.id,
    tenantId: ledger.tenantId,
    orgId: ledger.orgId,
    ledgerKind: ledger.ledgerKind,
    partyId: ledger.partyId,
    matterOrLeaseId: ledger.matterOrLeaseId,
    bankAccountId: ledger.bankAccountId,
    currency: ledger.currency,
    txKind: input.txKind,
    amountMinor: input.amountMinor,
    previousBalanceMinor: ledger.balanceMinor,
    balanceMinor: nextBalanceMinor,
    transactionId: txId,
    transactionCount: nextTxs.length,
    status: ledger.status,
    updatedAt: nowSec,
  };
  const responseJson = JSON.stringify(output);

  const whereConditions = [
    eq(finTrustEscrowLedgers.id, ledger.id),
    eq(finTrustEscrowLedgers.tenantId, ledger.tenantId),
    eq(finTrustEscrowLedgers.version, ledger.version),
    isNull(finTrustEscrowLedgers.deletedAt),
  ];
  if (input.txKind === 'DISBURSEMENT') {
    whereConditions.push(
      gte(finTrustEscrowLedgers.balanceMinor, input.amountMinor),
    );
  }

  const auditChainStmt = await buildNextAuditChainInsert(ctx.db, {
    orgId: ledger.orgId,
    streamKey: 'finance:trust',
    actorId: ctx.actor.id,
    action: input.txKind,
    targetId: ledger.id,
    occurredAtMs: nowSec * 1000,
    payload: output,
  });

  await ctx.db.batch([
    ctx.db
      .update(finTrustEscrowLedgers)
      .set({
        balanceMinor: nextBalanceMinor,
        transactionsJson: JSON.stringify(nextTxs),
        version: ledger.version + 1,
        updatedAt: nowSec,
      })
      .where(and(...whereConditions)),
    buildIdempotencyInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: ledger.orgId,
      clientMutationId: input.clientMutationId,
      commandId: 'finance.trust.transact',
      requestHash,
      responseJson,
      nowSec,
    }),
    buildActionLogInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: ledger.orgId,
      actor: ctx.actor,
      commandId: 'finance.trust.transact',
      resourceKind: 'fin_trust_escrow_ledger',
      resourceId: ledger.id,
      targetPartyId: ledger.partyId,
      snapshotAfterJson: responseJson,
      nowSec,
    }),
    ...(auditChainStmt ? [auditChainStmt.stmt] : []),
  ]);

  return output;
}

export async function createAndTransactTrustLedger(
  ctx: FinanceCtx,
  input: TrustTransactInput,
  requestHash: string,
): Promise<TrustTransactOutput> {
  if (!input.partyId || !input.matterOrLeaseId || !input.bankAccountId) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'partyId, matterOrLeaseId, and bankAccountId are required when creating a new trust ledger',
    );
  }

  const amountMinorBig = toBigIntMinor(input.amountMinor, 'amountMinor');
  const computed = computeNextTrustBalanceMinor(0n, input.txKind, amountMinorBig);
  if (!computed.ok) {
    throw new AppError(
      'TRUST_OVERDRAFT_BLOCKED',
      422,
      'Cannot disburse from a new trust/escrow ledger with zero balance',
      {
        currentBalanceMinor: 0,
        requestedAmountMinor: input.amountMinor,
      },
    );
  }

  const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);
  const partyRows = await buildPartyScopeQuery(ctx.db, input.partyId);
  verifyScopedRow(ctx, partyRows[0], 'Trust party');

  const nowSec = Math.floor(Date.now() / 1000);
  const newLedgerId = crypto.randomUUID();
  const txId = crypto.randomUUID();
  const nextBalanceMinor = toSafeNumberMinor(
    computed.nextBalanceMinor,
    'balanceMinor',
  );
  const txs = [
    buildTxEntry(ctx, input, txId, 0, nextBalanceMinor, nowSec),
  ];

  const output: TrustTransactOutput = {
    ledgerId: newLedgerId,
    tenantId: ctx.tenantId,
    orgId: targetOrgId,
    ledgerKind: input.ledgerKind,
    partyId: input.partyId,
    matterOrLeaseId: input.matterOrLeaseId,
    bankAccountId: input.bankAccountId,
    currency: input.currency,
    txKind: input.txKind,
    amountMinor: input.amountMinor,
    previousBalanceMinor: 0,
    balanceMinor: nextBalanceMinor,
    transactionId: txId,
    transactionCount: 1,
    status: 'ACTIVE',
    updatedAt: nowSec,
  };
  const customFieldsJson = JSON.stringify(
    parseJsonRecord(JSON.stringify(input.customFields)),
  );
  const responseJson = JSON.stringify(output);

  const auditChainStmt = await buildNextAuditChainInsert(ctx.db, {
    orgId: targetOrgId,
    streamKey: 'finance:trust',
    actorId: ctx.actor.id,
    action: input.txKind,
    targetId: newLedgerId,
    occurredAtMs: nowSec * 1000,
    payload: output,
  });

  await ctx.db.batch([
    ctx.db.insert(finTrustEscrowLedgers).values({
      id: newLedgerId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      ledgerKind: input.ledgerKind,
      partyId: input.partyId,
      matterOrLeaseId: input.matterOrLeaseId,
      bankAccountId: input.bankAccountId,
      currency: input.currency,
      balanceMinor: nextBalanceMinor,
      transactionsJson: JSON.stringify(txs),
      status: 'ACTIVE',
      customFields: customFieldsJson,
      createdAt: nowSec,
      updatedAt: nowSec,
    }),
    buildIdempotencyInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      clientMutationId: input.clientMutationId,
      commandId: 'finance.trust.transact',
      requestHash,
      responseJson,
      nowSec,
    }),
    buildActionLogInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      actor: ctx.actor,
      commandId: 'finance.trust.transact',
      resourceKind: 'fin_trust_escrow_ledger',
      resourceId: newLedgerId,
      targetPartyId: input.partyId,
      snapshotAfterJson: responseJson,
      nowSec,
    }),
    ...(auditChainStmt ? [auditChainStmt.stmt] : []),
  ]);

  return output;
}
