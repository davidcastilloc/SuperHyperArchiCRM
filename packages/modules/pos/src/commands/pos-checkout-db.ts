import type { CheckoutPosSaleResult } from '@shac/actor-branch';
import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  comOrderLines,
  comOrders,
  comPayments,
  finAccounts,
  type ShacD1Database,
} from '@shac/db-d1';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { PosCtx } from '../lib/pos-helpers.js';
import type { RemainingTenderResult } from '../tender-engine.js';
import type { PreparedPayment } from './pos-checkout-payments.js';
import type { PreparedOrderLine } from './pos-checkout-pricing.js';
import type { posSalesCheckoutInputSchema } from './pos-schemas.js';

export async function persistCheckoutBatch(params: {
  ctx: PosCtx;
  targetOrgId: string;
  input: z.infer<typeof posSalesCheckoutInputSchema>;
  doResult: CheckoutPosSaleResult;
  orderNumber: string;
  grandTotalMinor: number;
  priced: {
    lines: PreparedOrderLine[];
    subtotalExemptMinor: number;
    subtotalReducedMinor: number;
    subtotalGeneralMinor: number;
    discountMinor: number;
    taxGeneralMinor: number;
    taxReducedMinor: number;
    marginBps: number;
  };
  tender: RemainingTenderResult;
  paymentOutputs: Array<
    PreparedPayment & {
      paymentId: string;
      paymentNumber: string;
      idempotencyKey: string;
    }
  >;
  accountDeltas: ReadonlyMap<string, bigint>;
  requestHash: string;
  responseJson: string;
  nowSec: number;
}): Promise<void> {
  const { ctx, targetOrgId, input, doResult, priced, tender, nowSec } = params;
  const db: ShacD1Database = ctx.db;

  const orderInsert = db.insert(comOrders).values({
    id: doResult.orderId,
    tenantId: ctx.tenantId,
    orgId: targetOrgId,
    orderNumber: params.orderNumber,
    orderKind: 'pos_sale',
    channelId: input.channelId ?? null,
    shiftId: doResult.shiftId,
    registerId: doResult.registerId,
    partyId: input.partyId ?? null,
    customerSnapshotJson: JSON.stringify(input.customerSnapshot ?? {}),
    warehouseId: input.warehouseId ?? null,
    currency: input.orderCurrency,
    exchangeRateMicros: input.exchangeRateMicros,
    subtotalExemptMinor: priced.subtotalExemptMinor,
    subtotalReducedMinor: priced.subtotalReducedMinor,
    subtotalGeneralMinor: priced.subtotalGeneralMinor,
    discountMinor: priced.discountMinor,
    taxGeneralMinor: priced.taxGeneralMinor,
    taxReducedMinor: priced.taxReducedMinor,
    withholdingIslrMinor: input.withholdingIslrMinor,
    shippingMinor: input.shippingMinor,
    grandTotalMinor: params.grandTotalMinor,
    paidTotalMinor: tender.paidInOrderCurrencyMinor,
    changeGivenMinor: tender.changeDueMinor,
    marginBps: priced.marginBps,
    fulfillmentStatus: 'fulfilled',
    paymentStatus: 'paid',
    status: 'completed',
    clientMutationId: input.clientMutationId,
    createdAt: nowSec,
    updatedAt: nowSec,
  });

  const lineInserts = priced.lines.map((line, idx) =>
    db.insert(comOrderLines).values({
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      orderId: doResult.orderId,
      lineNo: line.lineNo,
      productId: line.productId,
      variantId: line.variantId,
      sku: line.sku,
      name: line.name,
      presentationName: line.presentationName,
      qtyMicros: line.qtyMicros,
      uom: line.uom,
      fulfilledQtyMicros: line.qtyMicros,
      returnedQtyMicros: 0,
      unitCostMinor: line.unitCostMinor,
      basePriceMinor: line.basePriceMinor,
      unitPriceMinor: line.unitPriceMinor,
      pricingSourceLayer: line.pricingSourceLayer,
      manualDiscountBps: line.manualDiscountBps,
      taxRateBps: line.taxRateBps,
      taxMinor: line.taxMinor,
      lineTotalMinor: line.lineTotalMinor,
      lotId: doResult.items[idx]?.allocations[0]?.lotId ?? null,
      createdAt: nowSec,
      updatedAt: nowSec,
    }),
  );

  const paymentInserts = params.paymentOutputs.map((p) =>
    db.insert(comPayments).values({
      id: p.paymentId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      paymentNumber: p.paymentNumber,
      orderId: doResult.orderId,
      shiftId: doResult.shiftId,
      partyId: input.partyId ?? null,
      financialAccountId: p.financialAccountId,
      methodCode: p.methodCode,
      currency: p.currency,
      amountMinor: p.amountMinor,
      exchangeRateMicros: p.exchangeRateMicros,
      referenceNumber: p.referenceNumber ?? null,
      externalGatewayTxId: p.externalGatewayTxId ?? null,
      idempotencyKey: p.idempotencyKey,
      status: 'captured',
      paidAt: nowSec,
      createdAt: nowSec,
      updatedAt: nowSec,
    }),
  );

  const accountUpdates = Array.from(params.accountDeltas.entries()).map(
    ([accountId, delta]) =>
      db
        .update(finAccounts)
        .set({
          currentBalanceMinor: sql`${finAccounts.currentBalanceMinor} + ${Number(delta)}`,
          version: sql`${finAccounts.version} + 1`,
          updatedAt: nowSec,
        })
        .where(
          and(
            eq(finAccounts.tenantId, ctx.tenantId),
            eq(finAccounts.id, accountId),
          ),
        ),
  );

  await db.batch([
    orderInsert,
    ...lineInserts,
    ...paymentInserts,
    ...accountUpdates,
    buildIdempotencyInsert(db, {
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      clientMutationId: input.clientMutationId,
      commandId: 'pos.sales.checkout',
      requestHash: params.requestHash,
      responseJson: params.responseJson,
      nowSec,
    }),
    buildActionLogInsert(db, {
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      actor: ctx.actor,
      commandId: 'pos.sales.checkout',
      resourceKind: 'com_order',
      resourceId: doResult.orderId,
      targetPartyId: input.partyId ?? null,
      snapshotAfterJson: params.responseJson,
      nowSec,
    }),
  ]);
}
