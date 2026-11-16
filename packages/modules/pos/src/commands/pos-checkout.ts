import type { CheckoutPosSaleResult } from '@shac/actor-branch';
import {
  assertOrgScope,
  kernelIdempotencyKeys,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand } from '@shac/kernel';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  buildFinAccountsLookupQuery,
  callBranchDoJson,
  computeCommandRequestHash,
  verifyScopedAccountRow,
  type ScopedAccountRow,
} from '../lib/pos-helpers.js';
import { assertAccountCurrencyMatch } from '../tender-engine.js';
import { persistCheckoutBatch } from './pos-checkout-db.js';
import { fetchCheckoutCatalogAndOrg } from './pos-checkout-fetch.js';
import { preparePaymentsAndSettleTender } from './pos-checkout-payments.js';
import { prepareCheckoutLines } from './pos-checkout-pricing.js';
import {
  posSalesCheckoutInputSchema,
  posSalesCheckoutOutputSchema,
} from './pos-schemas.js';

export const posSalesCheckoutCommand = defineCommand<
  typeof posSalesCheckoutInputSchema,
  z.infer<typeof posSalesCheckoutOutputSchema>,
  ShacD1Database
>({
  id: 'pos.sales.checkout',
  moduleId: 'pos',
  method: 'POST',
  path: '/api/pos/sales/checkout',
  summary:
    'Execute mixed-currency POS sale in BranchInventoryDO and persist D1 batch',
  requiredPermission: 'pos.sales.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Validate Cuenta=Moneda, deduct FEFO inventory in BranchInventoryDO, and atomically persist order/lines/payments/account balances in D1',
  },
  inputSchema: posSalesCheckoutInputSchema,
  outputSchema: posSalesCheckoutOutputSchema,
  async handler(ctx, input) {
    assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);
    const requestHash = await computeCommandRequestHash('pos.sales.checkout', {
      orgId: input.orgId ?? null,
      shiftId: input.shiftId ?? null,
      registerId: input.registerId ?? null,
      partyId: input.partyId ?? null,
      orderNumber: input.orderNumber ?? null,
      orderCurrency: input.orderCurrency,
      exchangeRateMicros: input.exchangeRateMicros,
      items: input.items,
      payments: input.payments,
      withholdingIslrMinor: input.withholdingIslrMinor,
      shippingMinor: input.shippingMinor,
    });

    const accountIds = Array.from(
      new Set(input.payments.map((p) => p.financialAccountId)),
    );

    // Batch 1 (<= 2 queries): idempotency + fin_accounts Cuenta=Moneda pre-check.
    const [idemRows, accountRows] = await ctx.db.batch([
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
      buildFinAccountsLookupQuery(ctx.db, accountIds),
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
      return posSalesCheckoutOutputSchema.parse(JSON.parse(idemHit.responseJson));
    }

    const accountMap = new Map<string, ScopedAccountRow>();
    for (const row of accountRows) {
      accountMap.set(row.id, row);
    }
    for (const payment of input.payments) {
      const account = verifyScopedAccountRow(
        ctx,
        accountMap.get(payment.financialAccountId),
        payment.financialAccountId,
      );
      assertAccountCurrencyMatch(account.currency, payment.currency);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const { targetOrgId, productRows, variantRows, rateRows } =
      await fetchCheckoutCatalogAndOrg(ctx, input, nowSec);

    const productMap = new Map(productRows.map((p) => [p.id, p]));
    const variantMap = new Map(variantRows.map((v) => [v.id, v]));

    const priced = prepareCheckoutLines({
      items: input.items,
      productMap,
      variantMap,
      rateRows,
      orderCurrency: input.orderCurrency,
      allowBelowCost: input.allowBelowCost,
    });

    const grandTotalBig =
      BigInt(priced.revenueExclTaxMinor) +
      BigInt(priced.taxGeneralMinor) +
      BigInt(priced.taxReducedMinor) +
      BigInt(input.shippingMinor) -
      BigInt(input.withholdingIslrMinor);
    if (grandTotalBig < 0n) {
      throw new AppError('VALIDATION_ERROR', 400, 'Grand total cannot be negative');
    }
    const grandTotalMinor = Number(grandTotalBig);

    const { preparedPayments, tender, accountDeltas } =
      preparePaymentsAndSettleTender({
        payments: input.payments,
        accountMap,
        rateRows,
        orderCurrency: input.orderCurrency,
        grandTotalMinor,
      });

    const orderId = crypto.randomUUID();
    const doResult = await callBranchDoJson<CheckoutPosSaleResult>(
      ctx,
      targetOrgId,
      '/pos-checkout',
      {
        clientMutationId: input.clientMutationId,
        shiftId: input.shiftId,
        registerId: input.registerId,
        orderId,
        orderCurrency: input.orderCurrency,
        items: priced.lines.map((line) => ({
          productId: line.productId,
          variantId: line.doVariantId,
          sku: line.sku,
          binCode: line.binCode,
          qty: line.qty,
          unitPriceMinor: line.unitPriceMinor,
          trackInventory: line.trackInventory,
        })),
        payments: preparedPayments.map((p) => ({
          financialAccountId: p.financialAccountId,
          accountCurrency: p.accountCurrency,
          paymentCurrency: p.currency,
          methodCode: p.methodCode,
          amountMinor: p.amountMinor,
          referenceNumber: p.referenceNumber,
        })),
        changeByCurrencyMinor:
          tender.changeDueMinor > 0
            ? { [input.orderCurrency]: tender.changeDueMinor }
            : undefined,
        nowEpochMs: input.nowEpochMs,
      },
    );

    const orderNumber =
      input.orderNumber ??
      `POS-${doResult.ticketSeq}-${doResult.orderId.slice(0, 8).toUpperCase()}`;

    const paymentOutputs = preparedPayments.map((p, idx) => {
      const paymentId = crypto.randomUUID();
      return {
        paymentId,
        paymentNumber: `PAY-${doResult.ticketSeq}-${idx + 1}-${paymentId.slice(0, 6).toUpperCase()}`,
        idempotencyKey: `${input.clientMutationId}:pay:${idx}`,
        ...p,
      };
    });

    const output: z.infer<typeof posSalesCheckoutOutputSchema> = {
      orderId: doResult.orderId,
      orderNumber,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      shiftId: doResult.shiftId,
      registerId: doResult.registerId,
      ticketSeq: doResult.ticketSeq,
      nextTicketSeq: doResult.nextTicketSeq,
      orderCurrency: input.orderCurrency,
      grandTotalMinor,
      paidTotalMinor: tender.paidInOrderCurrencyMinor,
      changeGivenMinor: tender.changeDueMinor,
      taxTotalMinor: priced.taxGeneralMinor + priced.taxReducedMinor,
      lines: priced.lines.map((line, idx) => ({
        lineNo: line.lineNo,
        productId: line.productId,
        variantId: line.variantId,
        sku: line.sku,
        qty: line.qty,
        unitPriceMinor: line.unitPriceMinor,
        taxMinor: line.taxMinor,
        lineTotalMinor: line.lineTotalMinor,
        lotId: doResult.items[idx]?.allocations[0]?.lotId ?? null,
      })),
      payments: paymentOutputs.map((p) => ({
        paymentId: p.paymentId,
        paymentNumber: p.paymentNumber,
        financialAccountId: p.financialAccountId,
        methodCode: p.methodCode,
        currency: p.currency,
        amountMinor: p.amountMinor,
        exchangeRateMicros: p.exchangeRateMicros,
      })),
      outboxSeqId: doResult.outboxSeqId,
    };

    await persistCheckoutBatch({
      ctx,
      targetOrgId,
      input,
      doResult,
      orderNumber,
      grandTotalMinor,
      priced,
      tender,
      paymentOutputs,
      accountDeltas,
      requestHash,
      responseJson: JSON.stringify(output),
      nowSec,
    });

    return output;
  },
});
