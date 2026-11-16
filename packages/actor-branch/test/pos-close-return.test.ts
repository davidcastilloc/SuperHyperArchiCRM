import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type {
  ApprovePhysicalReturnResult,
  CheckoutPosSaleResult,
  ClosePosShiftResult,
} from '../src/index.js';

interface ErrorBody {
  ok: false;
  error: { code: string; status: number; message: string };
}

async function postJson<T>(
  stub: DurableObjectStub,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: T }> {
  const res = await stub.fetch(`https://do.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

describe('@shac/actor-branch POS validation, registerId resolution & return conflicts', () => {
  it('validates integer money, X-Client-Mutation-Id, petty expenses, and idempotent close/return', async () => {
    const stub = env.BRANCH_DO.getByName('branch-pos-edges');
    const baseMs = 1_760_100_000_000;

    // Checkout before any shift is open -> 409 SHIFT_NOT_OPEN
    const noShift = await postJson<ErrorBody>(stub, '/pos-checkout', {
      clientMutationId: 'no-shift-sale',
      registerId: 'REG-EDGE',
      items: [{ productId: 'SKU-EDGE', qty: 1 }],
      payments: [
        {
          financialAccountId: 'acc_usd',
          accountCurrency: 'USD',
          paymentCurrency: 'USD',
          methodCode: 'CASH',
          amountMinor: 500,
        },
      ],
    });
    expect(noShift.status).toBe(409);
    expect(noShift.data.error.code).toBe('SHIFT_NOT_OPEN');

    await stub.openPosShift({
      clientMutationId: 'open-edge-1',
      shiftId: 'SHIFT-EDGE-1',
      registerId: 'REG-EDGE',
      cashierUserId: 'usr_edge',
      cashierName: 'Caja Edge',
      initialBalancesMinor: { USD: 5000 },
      openedAt: baseMs,
    });
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE hot_pos_shifts SET petty_expenses_json = ? WHERE shift_id = 'SHIFT-EDGE-1'`,
        JSON.stringify([{ currency: 'USD', amountMinor: 300 }]),
      );
    });
    await stub.receiveLot({
      clientMutationId: 'edge-lot-1',
      lotId: 'LOT-EDGE-1',
      productId: 'SKU-EDGE',
      qty: 5,
      unitCostMinor: 250,
      receivedAt: baseMs,
    });

    // Reject float money on checkout (400)
    const floatPay = await postJson<ErrorBody>(stub, '/pos-checkout', {
      clientMutationId: 'edge-float-1',
      registerId: 'REG-EDGE',
      items: [{ productId: 'SKU-EDGE', qty: 1 }],
      payments: [
        {
          financialAccountId: 'acc_usd',
          accountCurrency: 'USD',
          paymentCurrency: 'USD',
          methodCode: 'CASH',
          amountMinor: 12.34,
        },
      ],
    });
    expect(floatPay.status).toBe(400);
    expect(floatPay.data.error.code).toBe('VALIDATION_ERROR');

    // Checkout using registerId + X-Client-Mutation-Id header + changeByCurrencyMinor
    const headerSale = await postJson<CheckoutPosSaleResult>(
      stub,
      '/pos-checkout',
      {
        registerId: 'REG-EDGE',
        orderId: 'ORD-EDGE-1',
        items: [{ productId: 'SKU-EDGE', qty: 2 }],
        payments: [
          {
            financialAccountId: 'acc_usd',
            accountCurrency: 'USD',
            paymentCurrency: 'USD',
            methodCode: 'CASH',
            amountMinor: 2000,
          },
        ],
        changeByCurrencyMinor: { USD: 500 },
        nowEpochMs: baseMs + 5_000,
      },
      { 'X-Client-Mutation-Id': 'hdr-pos-sale-1' },
    );
    expect(headerSale.status).toBe(200);
    expect(headerSale.data.clientMutationId).toBe('hdr-pos-sale-1');
    expect(headerSale.data.salesByCurrencyMinor).toEqual({ USD: 1500 });

    // Reject float on /pos-close (400)
    const floatClose = await postJson<ErrorBody>(stub, '/pos-close', {
      clientMutationId: 'edge-close-float',
      registerId: 'REG-EDGE',
      actualCountedBalancesMinor: { USD: 6200.5 },
    });
    expect(floatClose.status).toBe(400);
    expect(floatClose.data.error.code).toBe('VALIDATION_ERROR');

    // Close by registerId with petty expense subtraction: 5000 + 1500 - 300 = 6200
    const closeOk = await postJson<ClosePosShiftResult>(stub, '/pos-close', {
      clientMutationId: 'edge-close-ok',
      registerId: 'REG-EDGE',
      actualCountedBalancesMinor: { USD: 6200 },
      closedAt: baseMs + 60_000,
    });
    expect(closeOk.status).toBe(200);
    expect(closeOk.data.expensesByCurrencyMinor).toEqual({ USD: 300 });
    expect(closeOk.data.expectedBalancesMinor).toEqual({ USD: 6200 });
    expect(closeOk.data.discrepancyBalancesMinor).toEqual({ USD: 0 });

    // Idempotent replay after close still succeeds with 200
    const closeReplay = await postJson<ClosePosShiftResult>(stub, '/pos-close', {
      clientMutationId: 'edge-close-ok',
      registerId: 'REG-EDGE',
      actualCountedBalancesMinor: { USD: 6200 },
    });
    expect(closeReplay.status).toBe(200);
    expect(closeReplay.data).toEqual(closeOk.data);

    // Return idempotency + LOT_CONFLICT
    const retOk = await postJson<ApprovePhysicalReturnResult>(
      stub,
      '/pos-return-approve',
      {
        clientMutationId: 'edge-ret-1',
        returnId: 'RET-EDGE-1',
        originalOrderId: 'ORD-EDGE-1',
        items: [
          {
            productId: 'SKU-EDGE',
            lotId: 'LOT-EDGE-1',
            qty: 1,
            unitCostMinor: 250,
            disposition: 'RESTOCK',
          },
        ],
        nowEpochMs: baseMs + 70_000,
      },
    );
    expect(retOk.status).toBe(200);
    expect(retOk.data.items[0]?.availableQty).toBe(4);

    const retConflict = await postJson<ErrorBody>(stub, '/pos-return-approve', {
      clientMutationId: 'edge-ret-1',
      returnId: 'RET-EDGE-1',
      originalOrderId: 'ORD-EDGE-1',
      items: [{ productId: 'SKU-EDGE', lotId: 'LOT-EDGE-1', qty: 2, disposition: 'RESTOCK' }],
    });
    expect(retConflict.status).toBe(409);
    expect(retConflict.data.error.code).toBe('IDEMPOTENCY_CONFLICT');

    const lotMismatch = await postJson<ErrorBody>(stub, '/pos-return-approve', {
      clientMutationId: 'edge-ret-lot-conflict',
      originalOrderId: 'ORD-EDGE-1',
      items: [{ productId: 'SKU-OTHER', lotId: 'LOT-EDGE-1', qty: 1, disposition: 'RESTOCK' }],
    });
    expect(lotMismatch.status).toBe(409);
    expect(lotMismatch.data.error.code).toBe('LOT_CONFLICT');
  });
});
