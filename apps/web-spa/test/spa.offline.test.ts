import { describe, expect, it } from 'vitest';
import {
  enqueueOfflineMutation,
  flushOfflineQueue,
  listOfflineQueue,
  type OfflineMutationItem,
} from '../src/lib/offlineQueue';
import { createShacQueryClient } from '../src/lib/queryClient';
import { createRpcClient } from '../src/lib/rpc';

describe('@shac/web-spa offlineFirst, RPC client & IndexedDB offline queue', () => {
  it('configures QueryClient with networkMode offlineFirst and 24h gcTime', () => {
    const client = createShacQueryClient({ enablePersistence: false });
    const defaults = client.getDefaultOptions();

    expect(defaults.queries?.networkMode).toBe('offlineFirst');
    expect(defaults.mutations?.networkMode).toBe('offlineFirst');
    expect(defaults.queries?.gcTime).toBe(1000 * 60 * 60 * 24);
  });

  it('builds a typed Hono RPC client covering Phase 1, Phase 2, and Phase 3 routes', () => {
    const rpc = createRpcClient('https://edge.shac.local');

    expect(rpc.api.health.$url().toString()).toBe('https://edge.shac.local/api/health');
    expect(rpc.api.customers.parties.$url().toString()).toBe(
      'https://edge.shac.local/api/customers/parties',
    );
    expect(rpc.api.catalog.products.$url().toString()).toBe(
      'https://edge.shac.local/api/catalog/products',
    );
    expect(rpc.api.catalog.pricing.quote.$url().toString()).toBe(
      'https://edge.shac.local/api/catalog/pricing/quote',
    );
    expect(rpc.api.branch.inventory['receive-lot'].$url().toString()).toBe(
      'https://edge.shac.local/api/branch/inventory/receive-lot',
    );
    expect(rpc.api.branch.inventory['allocate-fefo'].$url().toString()).toBe(
      'https://edge.shac.local/api/branch/inventory/allocate-fefo',
    );
    expect(rpc.api.branch.inventory.balances.$url().toString()).toBe(
      'https://edge.shac.local/api/branch/inventory/balances',
    );

    expect(rpc.api.regional['tax-id'].validate.$url().toString()).toBe(
      'https://edge.shac.local/api/regional/tax-id/validate',
    );
    expect(rpc.api.regional.fiscal.stamp.$url().toString()).toBe(
      'https://edge.shac.local/api/regional/fiscal/stamp',
    );
    expect(rpc.api.pos.shifts.open.$url().toString()).toBe(
      'https://edge.shac.local/api/pos/shifts/open',
    );
    expect(rpc.api.pos.shifts.close.$url().toString()).toBe(
      'https://edge.shac.local/api/pos/shifts/close',
    );
    expect(rpc.api.pos.sales.checkout.$url().toString()).toBe(
      'https://edge.shac.local/api/pos/sales/checkout',
    );
    expect(rpc.api.pos.kiosk.smartcheck.$url().toString()).toBe(
      'https://edge.shac.local/api/pos/kiosk/smartcheck',
    );
    expect(rpc.api.pos.returns.settle.$url().toString()).toBe(
      'https://edge.shac.local/api/pos/returns/settle',
    );
    expect(rpc.api.wms.pickings.$url().toString()).toBe(
      'https://edge.shac.local/api/wms/pickings',
    );
    expect(rpc.api.wms.pickings.process.$url().toString()).toBe(
      'https://edge.shac.local/api/wms/pickings/process',
    );
    expect(rpc.api.wms['landed-costs'].allocate.$url().toString()).toBe(
      'https://edge.shac.local/api/wms/landed-costs/allocate',
    );
    expect(rpc.api.wms.fleet.epod.$url().toString()).toBe(
      'https://edge.shac.local/api/wms/fleet/epod',
    );
    expect(rpc.api.branch.pos.checkout.$url().toString()).toBe(
      'https://edge.shac.local/api/branch/pos/checkout',
    );
    expect(rpc.api.branch.pos.close.$url().toString()).toBe(
      'https://edge.shac.local/api/branch/pos/close',
    );
    expect(rpc.api.branch.pos['return-approve'].$url().toString()).toBe(
      'https://edge.shac.local/api/branch/pos/return-approve',
    );
  });

  it('retains 503 and network failures for retry and removes 200 / 409 IDEMPOTENCY_CONFLICT items', async () => {
    const queueKey = `test-retry-${crypto.randomUUID()}`;
    await enqueueOfflineMutation(
      {
        clientMutationId: 'mut-retry-503',
        endpoint: '/api/pos/sales/checkout',
        kind: 'pos.sales.checkout',
        payload: { shiftId: 'shift-1', orderCurrency: 'USD' },
      },
      { queueKey },
    );
    await enqueueOfflineMutation(
      {
        clientMutationId: 'mut-retry-net',
        endpoint: '/api/pos/sales/checkout',
        kind: 'pos.sales.checkout',
        payload: { shiftId: 'shift-1', orderCurrency: 'USD' },
      },
      { queueKey },
    );

    const firstFlush = await flushOfflineQueue(
      async (item: OfflineMutationItem) => {
        if (item.clientMutationId === 'mut-retry-503') {
          return new Response(
            JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new TypeError('Network unreachable');
      },
      { queueKey },
    );

    expect(firstFlush.settled).toBe(0);
    expect(firstFlush.retained).toBe(2);
    const pending = await listOfflineQueue({ queueKey });
    expect(pending).toHaveLength(2);
    expect(pending[0]?.attempts).toBe(1);
    expect(pending[0]?.lastErrorStatus).toBe(503);
    expect(pending[1]?.attempts).toBe(1);
    expect(pending[1]?.lastErrorCode).toBe('NETWORK_ERROR');

    const secondFlush = await flushOfflineQueue(
      async (item: OfflineMutationItem) => {
        if (item.clientMutationId === 'mut-retry-503') {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ error: { code: 'IDEMPOTENCY_CONFLICT' } }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      },
      { queueKey },
    );

    expect(secondFlush.settled).toBe(2);
    expect(secondFlush.retained).toBe(0);
    expect(await listOfflineQueue({ queueKey })).toHaveLength(0);
  });

  it('enqueues 20 offline POS mutations and settles cleanly across 3 flushes (0 left)', async () => {
    const queueKey = `test-20-flushes-${crypto.randomUUID()}`;

    for (let i = 1; i <= 20; i += 1) {
      await enqueueOfflineMutation(
        {
          clientMutationId: `offline-pos-${String(i).padStart(2, '0')}`,
          endpoint: '/api/pos/sales/checkout',
          kind: 'pos.sales.checkout',
          payload: {
            shiftId: 'shift-offline-1',
            orderCurrency: 'USD',
            items: [{ productId: 'prod_amox', qty: 1 }],
            payments: [
              {
                financialAccountId: 'acc_usd_cash',
                currency: 'USD',
                methodCode: 'USD_CASH',
                amountMinor: 1000,
              },
              {
                financialAccountId: 'acc_ves_pm',
                currency: 'VES',
                methodCode: 'PAGO_MOVIL',
                amountMinor: 54_750,
              },
            ],
          },
        },
        { queueKey },
      );
    }

    // Duplicate enqueue with identical clientMutationId must not create a 21st entry.
    await enqueueOfflineMutation(
      {
        clientMutationId: 'offline-pos-01',
        endpoint: '/api/pos/sales/checkout',
        kind: 'pos.sales.checkout',
        payload: { shiftId: 'shift-offline-1' },
      },
      { queueKey },
    );

    expect(await listOfflineQueue({ queueKey })).toHaveLength(20);

    let flushRound = 0;
    const settledIds: string[] = [];

    const dispatchForRound = async (item: OfflineMutationItem) => {
      const idx = Number(item.clientMutationId.slice(-2));
      if (flushRound === 1) {
        if (idx <= 8) {
          settledIds.push(item.clientMutationId);
          return new Response(JSON.stringify({ orderId: `ord_${idx}` }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { code: 'EDGE_BUSY' } }), { status: 503 });
      }
      if (flushRound === 2) {
        if (idx <= 15) {
          settledIds.push(item.clientMutationId);
          return new Response(JSON.stringify({ orderId: `ord_${idx}` }), { status: 200 });
        }
        if (idx <= 17) {
          settledIds.push(item.clientMutationId);
          return new Response(
            JSON.stringify({ error: { code: 'IDEMPOTENCY_CONFLICT' } }),
            { status: 409 },
          );
        }
        return new Response(JSON.stringify({ error: { code: 'EDGE_BUSY' } }), { status: 503 });
      }
      settledIds.push(item.clientMutationId);
      return new Response(JSON.stringify({ orderId: `ord_${idx}` }), { status: 200 });
    };

    flushRound = 1;
    const res1 = await flushOfflineQueue(dispatchForRound, { queueKey });
    expect(res1.processed).toBe(20);
    expect(res1.settled).toBe(8);
    expect(res1.retained).toBe(12);
    expect(await listOfflineQueue({ queueKey })).toHaveLength(12);

    flushRound = 2;
    const res2 = await flushOfflineQueue(dispatchForRound, { queueKey });
    expect(res2.processed).toBe(12);
    expect(res2.settled).toBe(9);
    expect(res2.retained).toBe(3);
    expect(await listOfflineQueue({ queueKey })).toHaveLength(3);

    flushRound = 3;
    const res3 = await flushOfflineQueue(dispatchForRound, { queueKey });
    expect(res3.processed).toBe(3);
    expect(res3.settled).toBe(3);
    expect(res3.retained).toBe(0);
    expect(await listOfflineQueue({ queueKey })).toHaveLength(0);
    expect(settledIds).toHaveLength(20);
  });

  it('attaches Bearer token and X-Org-Id from authSession and clears session on 401', async () => {
    const { setAuthSession, getAuthSession, clearAuthSession } = await import(
      '../src/lib/authSession'
    );
    clearAuthSession();

    const capturedHeaders: Array<{ auth: string | null; orgId: string | null }> = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      const h = new Headers(init?.headers);
      capturedHeaders.push({
        auth: h.get('Authorization'),
        orgId: h.get('X-Org-Id'),
      });
      return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    setAuthSession({
      token: 'shac_sess_demo_123',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      actor: {
        id: 'usr_1',
        fullName: 'Admin',
        type: 'staff',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        branchName: 'Casa Matriz',
        perms: ['*'],
      },
    });

    const rpc = createRpcClient('https://edge.shac.local', { fetchImpl: fakeFetch });
    const res = await rpc.api.customers.parties.$get({ query: { limit: '10' } });
    expect(res.status).toBe(401);
    expect(capturedHeaders[0]).toEqual({
      auth: 'Bearer shac_sess_demo_123',
      orgId: 'org_1',
    });
    expect(getAuthSession()).toBeNull();
  });

  it('extracts code, message, and details.openShiftId from SHAC error responses via readApiError', async () => {
    const mod = (await import('../src/views/phase2-format')) as {
      readApiError?: (res: Response) => Promise<{
        status: number;
        code: string;
        message: string;
        details?: Record<string, unknown>;
      }>;
    };
    expect(typeof mod.readApiError).toBe('function');
    const res = new Response(
      JSON.stringify({
        error: {
          code: 'SHIFT_ALREADY_OPEN',
          message: 'Shift open on REG-1',
          details: { openShiftId: 'sh_123' },
        },
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );
    const err = await mod.readApiError!(res);
    expect(err.status).toBe(409);
    expect(err.code).toBe('SHIFT_ALREADY_OPEN');
    expect(err.message).toBe('Shift open on REG-1');
    expect(err.details?.openShiftId).toBe('sh_123');

    const nonJsonRes = new Response('Bad Gateway', { status: 502 });
    const nonJsonErr = await mod.readApiError!(nonJsonRes);
    expect(nonJsonErr.status).toBe(502);
    expect(nonJsonErr.code).toBe('HTTP_502');

    const rpc = createRpcClient('https://edge.shac.local');
    expect(rpc.api.catalog.rates.$url().toString()).toBe(
      'https://edge.shac.local/api/catalog/rates',
    );
    expect(rpc.api.customers.deals.$url().toString()).toBe(
      'https://edge.shac.local/api/customers/deals',
    );
    expect(rpc.api.customers.links.$url().toString()).toBe(
      'https://edge.shac.local/api/customers/links',
    );
    expect(rpc.api.customers['conflict-checks'].$url().toString()).toBe(
      'https://edge.shac.local/api/customers/conflict-checks',
    );
  });

  it('parses decimal currency strings to integer minor units without floating-point drift', async () => {
    const mod = (await import('../src/views/phase2-format')) as {
      parseMajorToMinor?: (raw: string) => number;
    };
    expect(typeof mod.parseMajorToMinor).toBe('function');
    expect(mod.parseMajorToMinor!('19.99')).toBe(1999);
    expect(mod.parseMajorToMinor!('1.5')).toBe(150);
    expect(mod.parseMajorToMinor!('25')).toBe(2500);
    expect(mod.parseMajorToMinor!('0.05')).toBe(5);
  });

  it('exposes auth setup/switch-branch RPC URLs and scoped STAFF_ROLE_PRESETS in IamAdminView', async () => {
    const rpc = createRpcClient('https://edge.shac.local');
    expect(rpc.api.auth.setup.$url().toString()).toBe('https://edge.shac.local/api/auth/setup');
    expect(rpc.api.auth['switch-branch'].$url().toString()).toBe(
      'https://edge.shac.local/api/auth/switch-branch',
    );
    const iamMod = (await import('../src/views/IamAdminView')) as {
      STAFF_ROLE_PRESETS?: Record<string, { label: string; perms: string[] }>;
    };
    expect(iamMod.STAFF_ROLE_PRESETS).toBeDefined();
    expect(iamMod.STAFF_ROLE_PRESETS!.cashier!.perms).not.toContain('*');
    expect(iamMod.STAFF_ROLE_PRESETS!.warehouse!.perms).not.toContain('*');
    expect(iamMod.STAFF_ROLE_PRESETS!.clinician!.perms).not.toContain('*');
    expect(iamMod.STAFF_ROLE_PRESETS!.guard!.perms).not.toContain('*');
    expect(iamMod.STAFF_ROLE_PRESETS!.admin!.perms).toEqual(['*']);
  });
});
