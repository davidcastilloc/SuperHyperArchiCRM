import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type {
  AllocateFefoResult,
  BalancesResult,
  OutboxEvent,
  PosShiftRecord,
  SpaceLockRecord,
} from '../src/index.js';

describe('@shac/actor-branch FEFO edge cases, RESERVE mode & HTTP routes', () => {
  it('spans multiple lots in exact FEFO tie-break order and supports RESERVE mode', async () => {
    const stub = env.BRANCH_DO.getByName('branch-fefo-edges');
    const baseMs = 1_700_000_000_000;

    await stub.receiveLot({
      clientMutationId: 'tie-b',
      lotId: 'LOT-B',
      productId: 'SKU-SPAN',
      qty: 10,
      unitCostMinor: 200,
      expiryEpochMs: baseMs + 100_000,
      receivedAt: baseMs + 2_000,
    });
    await stub.receiveLot({
      clientMutationId: 'tie-a',
      lotId: 'LOT-A',
      productId: 'SKU-SPAN',
      qty: 15,
      unitCostMinor: 150,
      expiryEpochMs: baseMs + 100_000,
      receivedAt: baseMs + 1_000,
    });
    await stub.receiveLot({
      clientMutationId: 'no-exp',
      lotId: 'LOT-NOEXP',
      productId: 'SKU-SPAN',
      qty: 20,
      unitCostMinor: 300,
      expiryEpochMs: null,
      receivedAt: baseMs,
    });

    const spanRes = await stub.fetch('https://do.internal/allocate-fefo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Mutation-Id': 'hdr-mut-span',
      },
      body: JSON.stringify({
        productId: 'SKU-SPAN',
        qtyRequested: 30,
        mode: 'RESERVE',
        nowEpochMs: baseMs,
      }),
    });
    expect(spanRes.status).toBe(200);
    const spanData = (await spanRes.json()) as AllocateFefoResult;
    expect(spanData.allocations).toEqual([
      {
        lotId: 'LOT-A',
        lotCode: 'LOT-A',
        variantId: 'default',
        binCode: 'MAIN',
        qtyAllocated: 15,
        unitCostMinor: 150,
        lineCostMinor: 2250,
        expiryEpochMs: baseMs + 100_000,
      },
      {
        lotId: 'LOT-B',
        lotCode: 'LOT-B',
        variantId: 'default',
        binCode: 'MAIN',
        qtyAllocated: 10,
        unitCostMinor: 200,
        lineCostMinor: 2000,
        expiryEpochMs: baseMs + 100_000,
      },
      {
        lotId: 'LOT-NOEXP',
        lotCode: 'LOT-NOEXP',
        variantId: 'default',
        binCode: 'MAIN',
        qtyAllocated: 5,
        unitCostMinor: 300,
        lineCostMinor: 1500,
        expiryEpochMs: null,
      },
    ]);

    const balances: BalancesResult = await stub.getBalances('SKU-SPAN');
    expect(balances.totalOnHandQty).toBe(45);
    expect(balances.totalReservedQty).toBe(30);
    expect(balances.totalAvailableQty).toBe(15);
  });

  it('supports GET listings, selective ackSeqIds outbox drain, and HTTP 400/404 handling', async () => {
    const stub = env.BRANCH_DO.getByName('branch-http-routes');
    const t0 = 1_700_000_000_000;

    await stub.acquireSpaceLock({
      clientMutationId: 'http-lock-1',
      spaceId: 'CLINIC-2',
      slotBucket: '2026-11-16T09:00',
      lockKind: 'APPOINTMENT',
      holderRefId: 'APT-1',
      partyNameMasked: 'María G***',
      checkInMs: t0,
      checkOutMs: t0 + 1_800_000,
      nowEpochMs: t0,
    });
    await stub.openPosShift({
      clientMutationId: 'http-shift-1',
      registerId: 'POS-2',
      cashierUserId: 'usr_9',
      cashierName: 'Ana Pérez',
      initialBalancesMinor: { USD: 25000 },
      openedAt: t0,
    });

    const locksRes = await stub.fetch('https://do.internal/space-lock?spaceId=CLINIC-2');
    expect(locksRes.status).toBe(200);
    const locksBody = (await locksRes.json()) as { locks: SpaceLockRecord[] };
    expect(locksBody.locks).toHaveLength(1);
    expect(locksBody.locks[0]?.partyNameMasked).toBe('María G***');

    const shiftsRes = await stub.fetch('https://do.internal/pos-shift?registerId=POS-2');
    expect(shiftsRes.status).toBe(200);
    const shiftsBody = (await shiftsRes.json()) as { shifts: PosShiftRecord[] };
    expect(shiftsBody.shifts).toHaveLength(1);
    expect(shiftsBody.shifts[0]?.initialBalancesMinor).toEqual({ USD: 25000 });

    const outboxList = await stub.listOutbox();
    expect(outboxList).toHaveLength(2);

    const ackFirst = await stub.fetch('https://do.internal/outbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ackSeqIds: [outboxList[0]!.seqId] }),
    });
    expect(ackFirst.status).toBe(200);
    const ackBody = (await ackFirst.json()) as {
      drainedCount: number;
      events: OutboxEvent[];
    };
    expect(ackBody.drainedCount).toBe(1);
    expect(await stub.listOutbox()).toHaveLength(1);

    const badJson = await stub.fetch('https://do.internal/receive-lot', {
      method: 'POST',
      body: '{bad-json',
    });
    expect(badJson.status).toBe(400);

    const missingRoute = await stub.fetch('https://do.internal/unknown');
    expect(missingRoute.status).toBe(404);
  });
});
