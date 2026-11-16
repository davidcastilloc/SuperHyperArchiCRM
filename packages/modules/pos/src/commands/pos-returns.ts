import type { ApprovePhysicalReturnResult } from '@shac/actor-branch';
import {
  assertOrgScope,
  buildActionLogInsert,
  buildIdempotencyInsert,
  comOrders,
  comReturnsAndCreditMemos,
  finAccounts,
  iamOrganizations,
  kernelIdempotencyKeys,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand } from '@shac/kernel';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  buildFinAccountsLookupQuery,
  callBranchDoJson,
  computeCommandRequestHash,
  resolveScopedTargetOrg,
  verifyScopedAccountRow,
} from '../lib/pos-helpers.js';
import { assertAccountCurrencyMatch } from '../tender-engine.js';
import {
  posReturnsSettleInputSchema,
  posReturnsSettleOutputSchema,
} from './pos-schemas.js';

export const posReturnsSettleCommand = defineCommand<
  typeof posReturnsSettleInputSchema,
  z.infer<typeof posReturnsSettleOutputSchema>,
  ShacD1Database
>({
  id: 'pos.returns.settle',
  moduleId: 'pos',
  method: 'POST',
  path: '/api/pos/returns/settle',
  summary:
    'Settle a 2-phase POS return: physical DO restock/quarantine/scrap and financial credit memo/refund',
  requiredPermission: 'pos.returns.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Execute 2-phase POS return: physical approval in BranchInventoryDO and financial settlement in D1 with Cuenta=Moneda',
  },
  inputSchema: posReturnsSettleInputSchema,
  outputSchema: posReturnsSettleOutputSchema,
  async handler(ctx, input) {
    assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);
    const requestHash = await computeCommandRequestHash('pos.returns.settle', {
      orgId: input.orgId ?? null,
      originalOrderId: input.originalOrderId,
      shiftId: input.shiftId ?? null,
      returnType: input.returnType,
      settlementMode: input.settlementMode,
      refundCurrency: input.refundCurrency,
      refundAmountMinor: input.refundAmountMinor,
      refundAccountId: input.refundAccountId ?? null,
      items: input.items,
    });

    const [idemRows, orderRows, accountRows] = await ctx.db.batch([
      ctx.db
        .select({
          requestHash: kernelIdempotencyKeys.requestHash,
          responseJson: kernelIdempotencyKeys.responseJson,
        })
        .from(kernelIdempotencyKeys)
        .where(
          and(
            eq(kernelIdempotencyKeys.tenantId, ctx.tenantId),
            eq(kernelIdempotencyKeys.clientMutationId, input.clientMutationId),
          ),
        )
        .limit(1),
      ctx.db
        .select({
          id: comOrders.id,
          tenantId: comOrders.tenantId,
          orgId: comOrders.orgId,
          orgTreePath: iamOrganizations.treePath,
          partyId: comOrders.partyId,
          shiftId: comOrders.shiftId,
          currency: comOrders.currency,
          grandTotalMinor: comOrders.grandTotalMinor,
        })
        .from(comOrders)
        .leftJoin(
          iamOrganizations,
          and(
            eq(comOrders.orgId, iamOrganizations.id),
            eq(comOrders.tenantId, iamOrganizations.tenantId),
            isNull(iamOrganizations.deletedAt),
          ),
        )
        .where(
          and(
            eq(comOrders.id, input.originalOrderId),
            isNull(comOrders.deletedAt),
          ),
        )
        .limit(1),
      buildFinAccountsLookupQuery(
        ctx.db,
        input.refundAccountId ? [input.refundAccountId] : ['__none__'],
      ),
    ]);

    const idemHit = idemRows[0];
    if (idemHit) {
      if (idemHit.requestHash !== requestHash) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          409,
          'clientMutationId already used with a different payload',
        );
      }
      return posReturnsSettleOutputSchema.parse(JSON.parse(idemHit.responseJson));
    }

    const origOrder = orderRows[0];
    if (!origOrder) {
      throw new AppError('NOT_FOUND', 404, 'Original order not found');
    }
    const effectiveOrderOrgPath =
      origOrder.orgTreePath ??
      (origOrder.orgId === ctx.orgId ? ctx.orgPath : '/__out_of_scope__');
    assertOrgScope(ctx, origOrder.tenantId, effectiveOrderOrgPath);

    if (input.orgId) {
      await resolveScopedTargetOrg(ctx, input.orgId);
    }

    if (
      input.refundCurrency === origOrder.currency &&
      input.refundAmountMinor > origOrder.grandTotalMinor
    ) {
      throw new AppError(
        'REFUND_EXCEEDS_ORDER_TOTAL',
        422,
        `Refund ${input.refundAmountMinor} exceeds order total ${origOrder.grandTotalMinor}`,
      );
    }

    if (input.refundAccountId) {
      const refundAccount = verifyScopedAccountRow(
        ctx,
        accountRows[0],
        input.refundAccountId,
      );
      assertAccountCurrencyMatch(refundAccount.currency, input.refundCurrency);
    }

    const returnId = crypto.randomUUID();
    const doResult = await callBranchDoJson<ApprovePhysicalReturnResult>(
      ctx,
      origOrder.orgId,
      '/pos-return-approve',
      {
        clientMutationId: input.clientMutationId,
        returnId,
        originalOrderId: origOrder.id,
        shiftId: input.shiftId ?? origOrder.shiftId ?? undefined,
        authorizedByUserId: ctx.actor.id,
        items: input.items,
        nowEpochMs: input.nowEpochMs,
      },
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const allScrapped = doResult.items.every((i) => i.disposition === 'SCRAP');
    const physicalStatus = allScrapped ? 'scrapped' : 'inspected_restocked';
    const financialStatus =
      input.settlementMode === 'refund_account'
        ? 'refunded_cash_bank'
        : 'credit_memo_issued';
    const returnNumber = `RET-${doResult.returnId.slice(0, 8).toUpperCase()}`;

    const output: z.infer<typeof posReturnsSettleOutputSchema> = {
      returnId: doResult.returnId,
      returnNumber,
      tenantId: ctx.tenantId,
      orgId: origOrder.orgId,
      originalOrderId: origOrder.id,
      returnType: input.returnType,
      physicalStatus,
      financialStatus,
      refundCurrency: input.refundCurrency,
      refundAmountMinor: input.refundAmountMinor,
      refundAccountId: input.refundAccountId ?? null,
      outboxSeqId: doResult.outboxSeqId,
      items: doResult.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        lotId: item.lotId,
        binCode: item.binCode,
        disposition: item.disposition,
        quarantineStatus: item.quarantineStatus,
        qty: item.qty,
        onHandQty: item.onHandQty,
        availableQty: item.availableQty,
      })),
    };
    const responseJson = JSON.stringify(output);

    const returnInsert = ctx.db.insert(comReturnsAndCreditMemos).values({
      id: doResult.returnId,
      tenantId: ctx.tenantId,
      orgId: origOrder.orgId,
      returnNumber,
      originalOrderId: origOrder.id,
      partyId: origOrder.partyId,
      shiftId: input.shiftId ?? origOrder.shiftId ?? null,
      returnType: input.returnType,
      physicalStatus,
      financialStatus,
      itemsJson: JSON.stringify(doResult.items),
      refundCurrency: input.refundCurrency,
      refundAmountMinor: input.refundAmountMinor,
      refundAccountId: input.refundAccountId ?? null,
      authorizedByUserId: ctx.actor.id,
      statusHistoryJson: JSON.stringify([
        { phase: 'physical', status: physicalStatus, atMs: doResult.approvedAtMs },
        { phase: 'financial', status: financialStatus, at: nowSec },
      ]),
      createdAt: nowSec,
      updatedAt: nowSec,
    });

    const writes = [
      returnInsert,
      ...(input.settlementMode === 'refund_account' &&
      input.refundAccountId &&
      input.refundAmountMinor > 0
        ? [
            ctx.db
              .update(finAccounts)
              .set({
                currentBalanceMinor: sql`${finAccounts.currentBalanceMinor} - ${input.refundAmountMinor}`,
                version: sql`${finAccounts.version} + 1`,
                updatedAt: nowSec,
              })
              .where(
                and(
                  eq(finAccounts.tenantId, ctx.tenantId),
                  eq(finAccounts.id, input.refundAccountId),
                ),
              ),
          ]
        : []),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: origOrder.orgId,
        clientMutationId: input.clientMutationId,
        commandId: 'pos.returns.settle',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: origOrder.orgId,
        actor: ctx.actor,
        commandId: 'pos.returns.settle',
        resourceKind: 'com_return',
        resourceId: doResult.returnId,
        targetPartyId: origOrder.partyId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ];

    await ctx.db.batch([writes[0]!, ...writes.slice(1)]);

    return output;
  },
});
