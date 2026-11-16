import { AppError } from '@shac/kernel';
import { MICROS_SCALE } from '@shac/mod-catalog';
import type { z } from 'zod';
import type { ScopedAccountRow } from '../lib/pos-helpers.js';
import {
  computeRemainingTender,
  type RemainingTenderResult,
  type TenderPaymentLine,
} from '../tender-engine.js';
import { findRateMicros, type CheckoutRateRow } from './pos-checkout-pricing.js';
import type { posCheckoutPaymentInputSchema } from './pos-schemas.js';

export interface PreparedPayment {
  financialAccountId: string;
  accountCurrency: string;
  accountKind: string;
  currency: string;
  methodCode: string;
  amountMinor: number;
  exchangeRateMicros: number;
  rateDirection?: 'order_to_payment' | 'payment_to_order';
  referenceNumber?: string;
  externalGatewayTxId?: string;
}

export function preparePaymentsAndSettleTender(params: {
  payments: readonly z.infer<typeof posCheckoutPaymentInputSchema>[];
  accountMap: ReadonlyMap<string, ScopedAccountRow>;
  rateRows: readonly CheckoutRateRow[];
  orderCurrency: string;
  grandTotalMinor: number;
}): {
  preparedPayments: PreparedPayment[];
  tender: RemainingTenderResult;
  accountDeltas: Map<string, bigint>;
} {
  const preparedPayments: PreparedPayment[] = [];
  const tenderLines: TenderPaymentLine[] = [];

  for (const p of params.payments) {
    const account = params.accountMap.get(p.financialAccountId)!;
    let fxRate = p.exchangeRateMicros;
    if (p.currency !== params.orderCurrency && fxRate === undefined) {
      const lookedUp = findRateMicros(
        params.rateRows,
        params.orderCurrency,
        p.currency,
      );
      if (lookedUp === null) {
        throw new AppError(
          'FX_RATE_NOT_FOUND',
          404,
          `No active FX rate found for ${params.orderCurrency}->${p.currency}`,
        );
      }
      fxRate = lookedUp;
    }

    const effectiveRate = fxRate ?? MICROS_SCALE;
    preparedPayments.push({
      financialAccountId: account.id,
      accountCurrency: account.currency,
      accountKind: account.accountKind,
      currency: p.currency,
      methodCode: p.methodCode,
      amountMinor: p.amountMinor,
      exchangeRateMicros: effectiveRate,
      rateDirection: p.rateDirection,
      referenceNumber: p.referenceNumber,
      externalGatewayTxId: p.externalGatewayTxId,
    });
    tenderLines.push({
      currency: p.currency,
      amountMinor: p.amountMinor,
      exchangeRateMicros: effectiveRate,
      rateDirection: p.rateDirection,
    });
  }

  const tender = computeRemainingTender(
    params.grandTotalMinor,
    tenderLines,
    params.orderCurrency,
    params.orderCurrency,
    MICROS_SCALE,
  );

  if (!tender.isSettled) {
    throw new AppError(
      'INSUFFICIENT_PAYMENT',
      422,
      `Payment is short by ${tender.remainingInOrderCurrencyMinor} ${params.orderCurrency} minor`,
      tender,
    );
  }

  const accountDeltas = new Map<string, bigint>();
  for (const pay of preparedPayments) {
    accountDeltas.set(
      pay.financialAccountId,
      (accountDeltas.get(pay.financialAccountId) ?? 0n) + BigInt(pay.amountMinor),
    );
  }

  if (tender.changeDueMinor > 0) {
    const changePay =
      preparedPayments.find(
        (p) =>
          p.currency === params.orderCurrency &&
          (p.accountKind === 'cash_drawer' || p.methodCode.includes('CASH')),
      ) ?? preparedPayments.find((p) => p.currency === params.orderCurrency);

    if (changePay) {
      accountDeltas.set(
        changePay.financialAccountId,
        (accountDeltas.get(changePay.financialAccountId) ?? 0n) -
          BigInt(tender.changeDueMinor),
      );
    }
  }

  return { preparedPayments, tender, accountDeltas };
}
