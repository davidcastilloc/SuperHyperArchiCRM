import { env } from 'cloudflare:test';
import type { BalancesResult } from '@shac/actor-branch';
import {
  wmsFleetAndDeliveries,
  wmsPackagesAndLots,
  wmsPickings,
  wmsStockMoves,
  wmsValuationAndLandedCosts,
  wrapD1WithCounter,
} from '@shac/db-d1';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import {
  modWmsManifest,
  wmsFleetCompleteEpodCommand,
  wmsLandedCostsAllocateCommand,
  wmsPickingsListCommand,
  wmsPickingsProcessCommand,
} from '../src/index.js';
import doWorkerEntry, {
  BranchInventoryDO,
  makeBranchDoResolver,
} from './do-worker.js';
import {
  applySqlScript,
  makeWmsCtx,
  seedWmsBaseFixtures,
} from './test-helpers.js';

describe('@shac/mod-wms D1 + BranchInventoryDO workerd commands', () => {
  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await seedWmsBaseFixtures(env.DB);
  });

  it('exports modWmsManifest with 4 MCP-exposed WMS commands', () => {
    expect(BranchInventoryDO).toBeDefined();
    expect(doWorkerEntry).toBeDefined();
    expect(modWmsManifest.id).toBe('wms');
    expect(modWmsManifest.commands.map((c) => c.id)).toEqual([
      'wms.pickings.process',
      'wms.pickings.list',
      'wms.landed_costs.allocate',
      'wms.fleet.complete_epod',
    ]);
    for (const cmd of modWmsManifest.commands) {
      expect(cmd.moduleId).toBe('wms');
      expect(cmd.mcp.expose).toBe(true);
    }
  });

  it('rejects bad GS1 Modulo-10, receives GS1 ASN lot into DO+D1, partially ships with -BACKORDER & lists in <= 2 queries', async () => {
    const branchDo = makeBranchDoResolver(env.BRANCH_DO);
    const ctx = makeWmsCtx(env.DB, { branchDo });

    await expect(
      wmsPickingsProcessCommand.handler(
        ctx,
        wmsPickingsProcessCommand.inputSchema.parse({
          clientMutationId: 'wms-bad-gs1',
          pickingNumber: 'ASN-BAD-GS1',
          operationKind: 'asn_receipt',
          sourceLocationId: 'loc_vendor',
          destLocationId: 'loc_bin_main',
          lines: [{
            productId: 'prod_amox',
            gs1RawBarcode: '(01)07501031311300(10)LOT2026A(17)271231',
            demandedQtyMicros: 10_000_000,
            doneQtyMicros: 10_000_000,
            unitCostMinor: 1_000,
          }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_GS1_CHECK_DIGIT', status: 400 });

    const receiptInput = wmsPickingsProcessCommand.inputSchema.parse({
      clientMutationId: 'wms-asn-01',
      pickingNumber: 'ASN-0001',
      operationKind: 'asn_receipt',
      sourceLocationId: 'loc_vendor',
      destLocationId: 'loc_bin_main',
      lines: [{
        productId: 'prod_amox',
        gs1RawBarcode: '(01)07501031311309(10)LOT2026A(17)271231(21)SER991',
        demandedQtyMicros: 10_000_000,
        doneQtyMicros: 10_000_000,
        unitCostMinor: 1_000,
      }],
    });
    const receipt = await wmsPickingsProcessCommand.handler(ctx, receiptInput);
    expect(receipt.doSynced).toBe(true);
    expect(receipt.backorderPicking).toBeNull();
    expect(receipt.moves[0]?.lotCode).toBe('LOT2026A');
    expect(receipt.moves[0]?.serialNumber).toBe('SER991');

    expect(await wmsPickingsProcessCommand.handler(ctx, receiptInput)).toEqual(receipt);
    await expect(
      wmsPickingsProcessCommand.handler(ctx, { ...receiptInput, pickingNumber: 'ASN-0001-DIFF' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });

    const lots = await ctx.db.select().from(wmsPackagesAndLots).where(eq(wmsPackagesAndLots.tenantId, 'ten_a'));
    expect(lots[0]?.lotOrPackageCode).toBe('LOT2026A');
    expect(lots[0]?.expirationDate).toBe('2027-12-31');

    const partialShip = await wmsPickingsProcessCommand.handler(
      ctx,
      wmsPickingsProcessCommand.inputSchema.parse({
        clientMutationId: 'wms-ship-partial-01',
        pickingNumber: 'OUT-0001',
        operationKind: 'outgoing_ship',
        sourceLocationId: 'loc_bin_main',
        destLocationId: 'loc_customer',
        orderId: 'ord_b2b_1',
        lines: [{ productId: 'prod_amox', demandedQtyMicros: 10_000_000, doneQtyMicros: 6_000_000 }],
      }),
    );
    expect(partialShip.status).toBe('done');
    expect(partialShip.backorderPicking?.pickingNumber).toBe('OUT-0001-BACKORDER');
    expect(partialShip.backorderPicking?.backorderOfPickingId).toBe(partialShip.pickingId);
    expect(partialShip.backorderPicking?.totalRemainingQtyMicros).toBe(4_000_000);

    const boMoves = await ctx.db
      .select()
      .from(wmsStockMoves)
      .where(and(eq(wmsStockMoves.tenantId, 'ten_a'), eq(wmsStockMoves.pickingId, partialShip.backorderPicking!.id)));
    expect(boMoves[0]?.demandedQtyMicros).toBe(4_000_000);
    expect(boMoves[0]?.doneQtyMicros).toBe(0);

    const doBalances = (await (
      await branchDo.getByBranchKey('ten_a:org_a').fetch('https://do.internal/balances?productId=prod_amox')
    ).json()) as BalancesResult;
    expect(doBalances.totalAvailableQty).toBe(4);
    expect(doBalances.totalOnHandQty).toBe(4);

    await expect(
      wmsPickingsProcessCommand.handler(
        ctx,
        wmsPickingsProcessCommand.inputSchema.parse({
          clientMutationId: 'wms-ship-over',
          pickingNumber: 'OUT-OVER',
          operationKind: 'outgoing_ship',
          sourceLocationId: 'loc_bin_main',
          destLocationId: 'loc_customer',
          lines: [{ productId: 'prod_amox', demandedQtyMicros: 8_000_000, doneQtyMicros: 8_000_000 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 409 });

    const counted = wrapD1WithCounter(env.DB);
    const listed = await wmsPickingsListCommand.handler(
      makeWmsCtx(counted.db),
      wmsPickingsListCommand.inputSchema.parse({ search: 'OUT-0001' }),
    );
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(listed.total).toBe(2);
    const boRow = listed.items.find((p) => p.pickingNumber === 'OUT-0001-BACKORDER');
    expect(boRow?.status).toBe('waiting');
    expect(boRow?.sourceLocationName).toBe('WH1/Stock/MAIN');
    expect(boRow?.destLocationName).toBe('Partners/Customers');

    const boComplete = await wmsPickingsProcessCommand.handler(
      ctx,
      wmsPickingsProcessCommand.inputSchema.parse({
        clientMutationId: 'wms-ship-bo-01',
        pickingId: partialShip.backorderPicking!.id,
        lines: [{ productId: 'prod_amox', demandedQtyMicros: 4_000_000, doneQtyMicros: 4_000_000 }],
      }),
    );
    expect(boComplete.status).toBe('done');
    expect(boComplete.backorderPicking).toBeNull();
    const zeroBalances = (await (
      await branchDo.getByBranchKey('ten_a:org_a').fetch('https://do.internal/balances?productId=prod_amox')
    ).json()) as BalancesResult;
    expect(zeroBalances.totalAvailableQty).toBe(0);
  });

  it('allocates landed costs with 334+333+333=1000 sum, enforces e-POD checks, and isolates tenants/orgs', async () => {
    const ctx = makeWmsCtx(env.DB);
    const lcRes = await wmsLandedCostsAllocateCommand.handler(
      ctx,
      wmsLandedCostsAllocateCommand.inputSchema.parse({
        clientMutationId: 'wms-lc-1000',
        splitMethod: 'by_weight',
        totalFreightMinor: 1_000,
        costComponents: [{ kind: 'freight', amountMinor: 1_000, currency: 'USD' }],
        lines: [
          { lineId: 'l1', productId: 'prod_amox', qtyMicros: 10_000_000, unitCostMinor: 1_000, weightGrams: 500 },
          { lineId: 'l2', productId: 'prod_p2', qtyMicros: 10_000_000, unitCostMinor: 500, weightGrams: 500 },
          { lineId: 'l3', productId: 'prod_p3', qtyMicros: 10_000_000, unitCostMinor: 400, weightGrams: 500 },
        ],
      }),
    );
    expect(lcRes.totalAllocatedMinor).toBe(1_000);
    expect(lcRes.allocations.map((a) => a.allocatedCostMinor)).toEqual([334, 333, 333]);

    const layers = await ctx.db
      .select()
      .from(wmsValuationAndLandedCosts)
      .where(and(eq(wmsValuationAndLandedCosts.tenantId, 'ten_a'), eq(wmsValuationAndLandedCosts.recordKind, 'landed_cost_allocation')));
    expect(layers.reduce((s, r) => s + r.totalValueMinor, 0)).toBe(1_000);

    const baseEpod = {
      loadWeightGrams: 1_000,
      loadPallets: 1,
      epodRecipientName: 'Juan',
      epodSignatureSvg: '<svg><path d="M0 0 L10 10"/></svg>',
      epodPhotoR2Key: 'epod/ten_a/trip_1.jpg',
      epodLat: 10.4806,
      epodLng: -66.9036,
    };

    await expect(
      wmsFleetCompleteEpodCommand.handler(
        ctx,
        wmsFleetCompleteEpodCommand.inputSchema.parse({ ...baseEpod, clientMutationId: 'epod-cold-fail', vehicleId: 'veh_dry', requiresColdChain: true }),
      ),
    ).rejects.toMatchObject({ code: 'COLD_CHAIN_REQUIRED', status: 422 });

    await expect(
      wmsFleetCompleteEpodCommand.handler(
        ctx,
        wmsFleetCompleteEpodCommand.inputSchema.parse({ ...baseEpod, clientMutationId: 'epod-cap-fail', vehicleId: 'veh_dry', loadWeightGrams: 9_000, requiresColdChain: false }),
      ),
    ).rejects.toMatchObject({ code: 'VEHICLE_CAPACITY_EXCEEDED', status: 422 });

    await expect(
      wmsFleetCompleteEpodCommand.handler(
        ctx,
        wmsFleetCompleteEpodCommand.inputSchema.parse({ ...baseEpod, clientMutationId: 'epod-pallet-fail', vehicleId: 'veh_dry', loadPallets: 5, requiresColdChain: false }),
      ),
    ).rejects.toMatchObject({ code: 'VEHICLE_CAPACITY_EXCEEDED', status: 422 });

    const epodOk = await wmsFleetCompleteEpodCommand.handler(
      ctx,
      wmsFleetCompleteEpodCommand.inputSchema.parse({
        ...baseEpod,
        clientMutationId: 'epod-ok-1',
        vehicleId: 'veh_cold',
        orderId: 'ord_b2b_1',
        loadWeightGrams: 12_000,
        loadPallets: 3,
        requiresColdChain: true,
        gpsBreadcrumbs: [{ lat: 10.48, lng: -66.9, atSec: 1_763_000_100 }],
      }),
    );
    expect(epodOk.status).toBe('delivered');
    const tripRows = await ctx.db.select().from(wmsFleetAndDeliveries).where(eq(wmsFleetAndDeliveries.id, epodOk.deliveryTripId));
    expect(tripRows[0]?.epodPhotoR2Key).toBe('epod/ten_a/trip_1.jpg');

    const ctxB = makeWmsCtx(env.DB, { tenantId: 'ten_b' });
    expect((await wmsPickingsListCommand.handler(ctxB, wmsPickingsListCommand.inputSchema.parse({}))).total).toBe(0);

    await expect(
      wmsFleetCompleteEpodCommand.handler(
        ctxB,
        wmsFleetCompleteEpodCommand.inputSchema.parse({ ...baseEpod, clientMutationId: 'epod-cross-ten', vehicleId: 'veh_cold' }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    const ctxOtherOrg = makeWmsCtx(env.DB, { tenantId: 'ten_a', orgId: 'org_a_other', orgPath: '/org_a_other' });
    await expect(
      wmsFleetCompleteEpodCommand.handler(
        ctxOtherOrg,
        wmsFleetCompleteEpodCommand.inputSchema.parse({ ...baseEpod, clientMutationId: 'epod-cross-org', vehicleId: 'veh_cold' }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ORG_SCOPE', status: 403 });

    const pickingRows = await ctx.db.select().from(wmsPickings).where(eq(wmsPickings.tenantId, 'ten_a'));
    expect(pickingRows.length).toBeGreaterThanOrEqual(3);
  });
});
