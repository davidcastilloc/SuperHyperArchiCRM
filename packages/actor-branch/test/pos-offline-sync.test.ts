import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type {
  AllocateFefoResult,
  ApprovePhysicalReturnResult,
  BalancesResult,
  CheckoutPosSaleResult,
  ClosePosShiftResult,
  OutboxEvent,
} from '../src/index.js';

const DAY_MS = 86_400_000;

interface ErrorBody {
  ok: false;
  error: { code: string; status: number; message: string };
}

async function postJson<T>(
  stub: DurableObjectStub,
  path: string,
  body: unknown,
): Promise<{ status: number; data: T }> {
  const res = await stub.fetch(`https://do.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

function makeSale(index: number, shiftId: string, nowEpochMs: number) {
  const seq = String(index).padStart(2, '0');
  return {
    clientMutationId: `offline_sale_${seq}`,
    shiftId,
    registerId: 'REG-POS-1',
    orderId: `ORD-OFFLINE-${seq}`,
    orderCurrency: 'USD',
    items: [{ productId: 'SKU-POS-1', variantId: 'default', sku: 'SKU-POS-1', qty: 2 }],
    payments: [
      {
        financialAccountId: 'acc_usd_cash',
        accountCurrency: 'USD',
        paymentCurrency: 'USD',
        methodCode: 'USD_CASH',
        amountMinor: 1000,
      },
      {
        financialAccountId: 'acc_ves_pm',
        accountCurrency: 'VES',
        paymentCurrency: 'VES',
        methodCode: 'PAGO_MOVIL',
        amountMinor: 36500,
      },
    ],
    nowEpochMs,
  };
}

describe('@shac/actor-branch POS offline sync 20x3, Cuenta=Moneda, close & return', () => {
  it('enforces 422 Cuenta=Moneda, 20x3 offline sync idempotency, close, and physical return', async () => {
    const stub = env.BRANCH_DO.getByName('branch-pos-offline-sync');
    const baseMs = 1_760_000_000_000;

    await stub.openPosShift({
      clientMutationId: 'shift-open-pos-1',
      shiftId: 'SHIFT-POS-1',
      registerId: 'REG-POS-1',
      cashierUserId: 'usr_cashier_1',
      cashierName: 'María Caja',
      initialBalancesMinor: { USD: 10000, VES: 500000 },
      openedAt: baseMs,
    });
    await stub.receiveLot({
      clientMutationId: 'pos-seed-late',
      lotId: 'LOT-LATE',
      lotCode: 'LOT-LATE',
      productId: 'SKU-POS-1',
      qty: 15,
      unitCostMinor: 400,
      expiryEpochMs: baseMs + 30 * DAY_MS,
      receivedAt: baseMs,
    });
    await stub.receiveLot({
      clientMutationId: 'pos-seed-early',
      lotId: 'LOT-EARLY',
      lotCode: 'LOT-EARLY',
      productId: 'SKU-POS-1',
      qty: 25,
      unitCostMinor: 350,
      expiryEpochMs: baseMs + 7 * DAY_MS,
      receivedAt: baseMs + 1_000,
    });
    await stub.drainOutbox();

    // 422 ERR_CURRENCY_ACCOUNT_MISMATCH before mutating stock or shift
    const mismatchRes = await postJson<ErrorBody>(stub, '/pos-checkout', {
      ...makeSale(99, 'SHIFT-POS-1', baseMs + 2_000),
      clientMutationId: 'sale-mismatch-1',
      payments: [
        {
          financialAccountId: 'acc_usd_cash',
          accountCurrency: 'USD',
          paymentCurrency: 'VES',
          methodCode: 'PAGO_MOVIL',
          amountMinor: 36500,
        },
      ],
    });
    expect(mismatchRes.status).toBe(422);
    expect(mismatchRes.data.error.code).toBe('ERR_CURRENCY_ACCOUNT_MISMATCH');
    expect((await stub.getBalances('SKU-POS-1')).totalAvailableQty).toBe(40);
    expect(await stub.listOutbox()).toHaveLength(0);

    // 20 disconnected multi-currency POS sales x 3 reconnection waves = 60 calls
    const wave1: CheckoutPosSaleResult[] = [];
    for (let i = 1; i <= 20; i++) {
      const res = await postJson<CheckoutPosSaleResult>(
        stub,
        '/pos-checkout',
        makeSale(i, 'SHIFT-POS-1', baseMs + i * 1_000),
      );
      expect(res.status).toBe(200);
      wave1.push(res.data);
    }

    const wave2 = await Promise.all(
      Array.from({ length: 20 }, (_, idx) =>
        postJson<CheckoutPosSaleResult>(
          stub,
          '/pos-checkout',
          makeSale(idx + 1, 'SHIFT-POS-1', baseMs + 90_000),
        ),
      ),
    );
    const wave3 = await Promise.all(
      Array.from({ length: 20 }, (_, idx) =>
        stub.checkoutPosSale(makeSale(idx + 1, 'SHIFT-POS-1', baseMs + 180_000)),
      ),
    );

    expect(wave2.every((r) => r.status === 200)).toBe(true);
    for (let i = 0; i < 20; i++) {
      expect(wave1[i]?.ticketSeq).toBe(i + 1);
      expect(wave2[i]?.data).toEqual(wave1[i]);
      expect(wave3[i]).toEqual(wave1[i]);
    }
    expect(wave1[12]?.items[0]?.allocations).toEqual([
      expect.objectContaining({ lotId: 'LOT-EARLY', qtyAllocated: 1 }),
      expect.objectContaining({ lotId: 'LOT-LATE', qtyAllocated: 1 }),
    ]);

    const conflict = await postJson<ErrorBody>(stub, '/pos-checkout', {
      ...makeSale(1, 'SHIFT-POS-1', baseMs),
      items: [{ productId: 'SKU-POS-1', variantId: 'default', sku: 'SKU-POS-1', qty: 3 }],
    });
    expect(conflict.status).toBe(409);
    expect(conflict.data.error.code).toBe('IDEMPOTENCY_CONFLICT');

    const overStock = await postJson<ErrorBody>(
      stub,
      '/pos-checkout',
      makeSale(21, 'SHIFT-POS-1', baseMs + 200_000),
    );
    expect(overStock.status).toBe(409);
    expect(overStock.data.error.code).toBe('INSUFFICIENT_STOCK');

    const audit = await runInDurableObject(stub, (_instance, state) => {
      const shiftRow = state.storage.sql
        .exec<{
          next_ticket_seq: number;
          sales_by_currency_json: string;
          sales_by_method_json: string;
        }>(
          `SELECT next_ticket_seq, sales_by_currency_json, sales_by_method_json
           FROM hot_pos_shifts WHERE shift_id = 'SHIFT-POS-1'`,
        )
        .one();
      const idempCount = state.storage.sql
        .exec<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM hot_idempotency_log
           WHERE command_id = 'branch.pos.checkout'`,
        )
        .one().cnt;
      const outboxCount = state.storage.sql
        .exec<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM hot_outbox
           WHERE event_type = 'POS_SALE_COMPLETED'`,
        )
        .one().cnt;
      return { shiftRow, idempCount, outboxCount };
    });

    expect(audit.shiftRow.next_ticket_seq).toBe(21);
    expect(JSON.parse(audit.shiftRow.sales_by_currency_json)).toEqual({
      USD: 20000,
      VES: 730000,
    });
    expect(JSON.parse(audit.shiftRow.sales_by_method_json)).toEqual({
      'USD:USD_CASH': 20000,
      'VES:PAGO_MOVIL': 730000,
    });
    expect(audit.idempCount).toBe(20);
    expect(audit.outboxCount).toBe(20);

    const balances: BalancesResult = await stub.getBalances('SKU-POS-1');
    expect(balances.totalOnHandQty).toBe(0);
    expect(balances.totalAvailableQty).toBe(0);
    expect(balances.lots.find((l) => l.lotId === 'LOT-EARLY')?.availableQty).toBe(0);
    expect(balances.lots.find((l) => l.lotId === 'LOT-LATE')?.availableQty).toBe(0);

    // Close shift & reject subsequent sale with 409 SHIFT_NOT_OPEN
    const closeRes = await postJson<ClosePosShiftResult>(stub, '/pos-close', {
      clientMutationId: 'shift-close-pos-1',
      shiftId: 'SHIFT-POS-1',
      actualCountedBalancesMinor: { USD: 29900, VES: 1230500 },
      closedAt: baseMs + 3_600_000,
    });
    expect(closeRes.status).toBe(200);
    expect(closeRes.data.status).toBe('CLOSED');
    expect(closeRes.data.totalTickets).toBe(20);
    expect(closeRes.data.expectedBalancesMinor).toEqual({ USD: 30000, VES: 1230000 });
    expect(closeRes.data.discrepancyBalancesMinor).toEqual({ USD: -100, VES: 500 });

    const postCloseSale = await postJson<ErrorBody>(
      stub,
      '/pos-checkout',
      makeSale(22, 'SHIFT-POS-1', baseMs + 3_700_000),
    );
    expect(postCloseSale.status).toBe(409);
    expect(postCloseSale.data.error.code).toBe('SHIFT_NOT_OPEN');

    // Approve physical return: RESTOCK, QUARANTINE, SCRAP
    const returnRes = await postJson<ApprovePhysicalReturnResult>(
      stub,
      '/pos-return-approve',
      {
        clientMutationId: 'return-phys-1',
        returnId: 'RET-001',
        originalOrderId: 'ORD-OFFLINE-01',
        items: [
          { productId: 'SKU-POS-1', lotId: 'LOT-EARLY', qty: 2, disposition: 'RESTOCK' },
          { productId: 'SKU-POS-1', lotId: 'LOT-EARLY', qty: 1, disposition: 'QUARANTINE' },
          { productId: 'SKU-POS-1', lotId: 'LOT-LATE', qty: 1, disposition: 'SCRAP' },
        ],
        nowEpochMs: baseMs + 4_000_000,
      },
    );
    expect(returnRes.status).toBe(200);
    expect(returnRes.data.items[0]).toMatchObject({
      lotId: 'LOT-EARLY',
      binCode: 'MAIN',
      quarantineStatus: 'RELEASED',
      availableQty: 2,
    });
    expect(returnRes.data.items[1]).toMatchObject({
      binCode: 'QUARANTINE',
      quarantineStatus: 'QUARANTINE',
      onHandQty: 1,
      availableQty: 0,
    });
    expect(returnRes.data.items[2]).toMatchObject({
      binCode: 'SCRAP',
      quarantineStatus: 'REJECTED',
      onHandQty: 1,
      availableQty: 0,
    });

    const afterAlloc: AllocateFefoResult = await stub.allocateFefo({
      clientMutationId: 'alloc-after-return-ok',
      productId: 'SKU-POS-1',
      qtyRequested: 2,
      nowEpochMs: baseMs + 4_200_000,
    });
    expect(afterAlloc.allocations[0]?.lotId).toBe('LOT-EARLY');

    const overAlloc = await postJson<ErrorBody>(stub, '/allocate-fefo', {
      clientMutationId: 'alloc-after-return-over',
      productId: 'SKU-POS-1',
      qtyRequested: 1,
      nowEpochMs: baseMs + 4_300_000,
    });
    expect(overAlloc.status).toBe(409);
    expect(overAlloc.data.error.code).toBe('INSUFFICIENT_STOCK');

    const outbox: OutboxEvent[] = await stub.listOutbox(100);
    expect(outbox.filter((e) => e.eventType === 'POS_SALE_COMPLETED')).toHaveLength(20);
    expect(outbox.filter((e) => e.eventType === 'POS_SHIFT_CLOSED')).toHaveLength(1);
    expect(outbox.filter((e) => e.eventType === 'POS_RETURN_PHYSICAL_APPROVED')).toHaveLength(1);
  });
});
