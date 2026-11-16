import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type {
  AllocateFefoResult,
  BalancesResult,
  OutboxEvent,
} from '../src/index.js';

const DAY_MS = 86_400_000;

async function postJson<T>(
  stub: DurableObjectStub,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await stub.fetch(`https://do.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

async function getJson<T>(
  stub: DurableObjectStub,
  path: string,
): Promise<{ status: number; data: T }> {
  const res = await stub.fetch(`https://do.internal${path}`, { method: 'GET' });
  return { status: res.status, data: (await res.json()) as T };
}

describe('@shac/actor-branch BranchInventoryDO on workerd', () => {
  it('initializes all 8 canonical hot SQLite tables idempotently', async () => {
    const stub = env.BRANCH_DO.getByName('branch-schema-check');
    const health = await getJson<{ ok: boolean; actor: string }>(stub, '/health');
    expect(health.status).toBe(200);
    expect(health.data).toEqual({ ok: true, actor: 'BranchInventoryDO' });

    const tableNames = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'hot_%' ORDER BY name`,
        )
        .toArray()
        .map((r) => r.name),
    );
    expect(tableNames).toEqual([
      'hot_access_passes',
      'hot_bin_balances',
      'hot_idempotency_log',
      'hot_inventory_lots',
      'hot_outbox',
      'hot_pos_shifts',
      'hot_queue_board',
      'hot_space_locks',
    ]);
  });

  it('passes 50-concurrent FEFO stress test with 40/10 split, zero balance, and idempotent replay', async () => {
    const stub = env.BRANCH_DO.getByName('branch-fefo-stress-50');
    const baseMs = Date.now();

    const lateSeed = await postJson(stub, '/receive-lot', {
      clientMutationId: 'seed-late',
      lotId: 'LOT-LATE',
      lotCode: 'LOT-LATE',
      productId: 'SKU-FEFO',
      qty: 10,
      unitCostMinor: 500,
      expiryEpochMs: baseMs + 30 * DAY_MS,
      receivedAt: baseMs,
    });
    expect(lateSeed.status).toBe(200);

    const earlySeed = await postJson(stub, '/receive-lot', {
      clientMutationId: 'seed-early',
      lotId: 'LOT-EARLY',
      lotCode: 'LOT-EARLY',
      productId: 'SKU-FEFO',
      qty: 30,
      unitCostMinor: 450,
      expiryEpochMs: baseMs + 10 * DAY_MS,
      receivedAt: baseMs + 1_000,
    });
    expect(earlySeed.status).toBe(200);

    const drainedSeed = await postJson<{ drainedCount: number }>(stub, '/outbox');
    expect(drainedSeed.data.drainedCount).toBe(2);

    const requests = Array.from({ length: 50 }, (_, idx) =>
      postJson<AllocateFefoResult & { error?: { code: string } }>(
        stub,
        '/allocate-fefo',
        {
          clientMutationId: `stress-alloc-${idx}`,
          productId: 'SKU-FEFO',
          qtyRequested: 1,
          orderId: `ORD-${idx}`,
        },
      ),
    );

    const responses = await Promise.all(requests);
    const succeeded = responses
      .filter((r) => r.status === 200)
      .map((r) => r.data);
    const failed = responses.filter((r) => r.status === 409);

    expect(succeeded).toHaveLength(40);
    expect(failed).toHaveLength(10);
    expect(
      failed.every((r) => r.data.error?.code === 'INSUFFICIENT_STOCK'),
    ).toBe(true);

    succeeded.sort((a, b) => a.outboxSeqId - b.outboxSeqId);
    const first30Lots = succeeded.slice(0, 30).map((r) => r.allocations[0]?.lotId);
    const next10Lots = succeeded.slice(30, 40).map((r) => r.allocations[0]?.lotId);
    expect(first30Lots.every((lotId) => lotId === 'LOT-EARLY')).toBe(true);
    expect(next10Lots.every((lotId) => lotId === 'LOT-LATE')).toBe(true);

    const balances = await getJson<BalancesResult>(
      stub,
      '/balances?productId=SKU-FEFO',
    );
    expect(balances.status).toBe(200);
    expect(balances.data.totalOnHandQty).toBe(0);
    expect(balances.data.totalAvailableQty).toBe(0);
    expect(
      balances.data.lots.every(
        (lot) => lot.onHandQty === 0 && lot.availableQty === 0,
      ),
    ).toBe(true);

    const outboxBeforeReplay = await getJson<{ events: OutboxEvent[] }>(
      stub,
      '/outbox',
    );
    expect(outboxBeforeReplay.data.events).toHaveLength(40);

    const original = succeeded[0]!;
    const replay = await postJson<AllocateFefoResult>(stub, '/allocate-fefo', {
      clientMutationId: original.clientMutationId,
      productId: 'SKU-FEFO',
      qtyRequested: 1,
      orderId: original.clientMutationId.replace('stress-alloc-', 'ORD-'),
    });
    expect(replay.status).toBe(200);
    expect(replay.data).toEqual(original);

    const conflict = await postJson<{ error: { code: string } }>(
      stub,
      '/allocate-fefo',
      {
        clientMutationId: original.clientMutationId,
        productId: 'SKU-FEFO',
        qtyRequested: 2,
      },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.data.error.code).toBe('IDEMPOTENCY_CONFLICT');

    const outboxAfterReplay = await getJson<{ events: OutboxEvent[] }>(
      stub,
      '/outbox',
    );
    expect(outboxAfterReplay.data.events).toHaveLength(40);
  });

  it('excludes expired/quarantined lots and aborts atomically before mutation', async () => {
    const stub = env.BRANCH_DO.getByName('branch-fefo-guards');
    const nowMs = Date.now();

    await stub.receiveLot({
      clientMutationId: 'guard-exp',
      lotId: 'LOT-EXPIRED',
      productId: 'SKU-GUARD',
      qty: 50,
      expiryEpochMs: nowMs - 60_000,
    });
    await stub.receiveLot({
      clientMutationId: 'guard-quar',
      lotId: 'LOT-QUAR',
      productId: 'SKU-GUARD',
      qty: 50,
      quarantineStatus: 'QUARANTINE',
      expiryEpochMs: nowMs + 5 * DAY_MS,
    });
    await stub.receiveLot({
      clientMutationId: 'guard-ok',
      lotId: 'LOT-VALID',
      productId: 'SKU-GUARD',
      qty: 5,
      expiryEpochMs: null,
    });
    await stub.drainOutbox();

    const aborted = await postJson<{ error: { code: string } }>(
      stub,
      '/allocate-fefo',
      {
        clientMutationId: 'guard-abort-1',
        productId: 'SKU-GUARD',
        qtyRequested: 6,
        nowEpochMs: nowMs,
      },
    );
    expect(aborted.status).toBe(409);
    expect(aborted.data.error.code).toBe('INSUFFICIENT_STOCK');

    const balances = await stub.getBalances('SKU-GUARD');
    expect(balances.lots.find((l) => l.lotId === 'LOT-VALID')?.availableQty).toBe(5);
    expect(await stub.listOutbox()).toHaveLength(0);

    const okAlloc = await stub.allocateFefo({
      clientMutationId: 'guard-pass-1',
      productId: 'SKU-GUARD',
      qtyRequested: 5,
      nowEpochMs: nowMs,
    });
    expect(okAlloc.allocations[0]?.lotId).toBe('LOT-VALID');
  });

  it('serializes space locks (409 SPACE_ALREADY_LOCKED) and POS shifts with integer money', async () => {
    const stub = env.BRANCH_DO.getByName('branch-space-pos');
    const checkInMs = Date.now() + DAY_MS;
    const checkOutMs = checkInMs + DAY_MS;

    const lockResults = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        postJson<{ ok?: boolean; error?: { code: string } }>(
          stub,
          '/space-lock',
          {
            clientMutationId: `lock-mut-${i}`,
            spaceId: 'ROOM-304',
            slotBucket: '2026-11-17',
            lockKind: 'STAY',
            holderRefId: `RES-${i}`,
            partyNameMasked: 'M. G***',
            checkInMs,
            checkOutMs,
          },
        ),
      ),
    );
    expect(lockResults.filter((r) => r.status === 200)).toHaveLength(1);
    const lockConflicts = lockResults.filter((r) => r.status === 409);
    expect(lockConflicts).toHaveLength(4);
    expect(
      lockConflicts.every((r) => r.data.error?.code === 'SPACE_ALREADY_LOCKED'),
    ).toBe(true);

    const floatShift = await postJson<{ error: { code: string } }>(
      stub,
      '/pos-shift',
      {
        clientMutationId: 'shift-float-err',
        registerId: 'REG-1',
        cashierUserId: 'usr_1',
        cashierName: 'Caja 1',
        initialBalancesMinor: { USD: 10.5 },
      },
    );
    expect(floatShift.status).toBe(400);
    expect(floatShift.data.error.code).toBe('VALIDATION_ERROR');

    const shift1 = await postJson<{ status: string }>(stub, '/pos-shift', {
      clientMutationId: 'shift-open-1',
      registerId: 'REG-1',
      cashierUserId: 'usr_1',
      cashierName: 'Caja 1',
      initialBalancesMinor: { USD: 10000, VES: 500000 },
    });
    expect(shift1.status).toBe(200);
    expect(shift1.data.status).toBe('OPEN');

    const shift2 = await postJson<{ error: { code: string } }>(
      stub,
      '/pos-shift',
      {
        clientMutationId: 'shift-open-2',
        registerId: 'REG-1',
        cashierUserId: 'usr_2',
        cashierName: 'Caja 2',
        initialBalancesMinor: { USD: 5000 },
      },
    );
    expect(shift2.status).toBe(409);
    expect(shift2.data.error.code).toBe('SHIFT_ALREADY_OPEN');
  });
});
