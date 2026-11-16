import { env } from 'cloudflare:test';
import { wrapD1WithCounter } from '@shac/db-d1';
import { computeRemainingTender } from '@shac/mod-pos';
import { validateSpeiClabe } from '@shac/mod-regional';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../packages/db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import { invalidateProfileCache, workerApp, type WorkerEnv } from '../src/router.js';
import { seedPhase3Fixtures } from './phase3-fixtures.js';
import {
  callMcp,
  callMcpTool,
  callWorkerJson,
  createPhase3Tokens,
  DAY_MS,
  EXPECTED_PHASE3_MCP_TOOLS,
  SAMPLE_BRANCH_CHECKOUT,
} from './phase3-helpers.js';
import { applySqlScript, makeProfile, seedTenantsAndOrgs } from './test-helpers.js';

describe('@shac/node-worker Phase 3 workerd integration (regional, pos, wms, mcp)', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let publicKeyJwkJson: string;
  let tokenTen1: string;
  let tokenTen2: string;
  let tokenReadOnly: string;

  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await seedTenantsAndOrgs(env.DB);
    await seedPhase3Fixtures(env.DB, nowSec);
    const created = await createPhase3Tokens();
    publicKeyJwkJson = JSON.stringify(created.keys.publicKeyJwk);
    tokenTen1 = created.tokenTen1;
    tokenTen2 = created.tokenTen2;
    tokenReadOnly = created.tokenReadOnly;
  });

  beforeEach(() => {
    invalidateProfileCache();
  });

  it('enforces 403 MODULE_NOT_ENABLED and branch permission gates without touching D1', async () => {
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam'])));
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = { ...env, DB: counted.db, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    for (const [path, body] of [
      ['/api/regional/tax-id/validate', { taxIdType: 'RIF', taxIdNumber: 'J-40123456-7' }],
      ['/api/pos/kiosk/smartcheck?code=AMOX-P3', undefined],
      ['/api/wms/pickings', undefined],
      ['/api/branch/pos/checkout', SAMPLE_BRANCH_CHECKOUT],
    ] as const) {
      const res = await callWorkerJson<{ error: { code: string } }>(workerApp, testEnv, path, tokenTen1, body);
      expect(res.status).toBe(403);
      expect(res.data.error.code).toBe('MODULE_NOT_ENABLED');
    }
    expect(counted.getQueryCount()).toBe(0);

    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam', 'pos'])));
    invalidateProfileCache();
    const permRes = await callWorkerJson<{ error: { code: string } }>(
      workerApp, testEnv, '/api/branch/pos/checkout', tokenReadOnly, SAMPLE_BRANCH_CHECKOUT,
    );
    expect(permRes.status).toBe(403);
    expect(permRes.data.error.code).toBe('FORBIDDEN');
  });

  it('validates and stamps regional fiscal documents for ve, co, mx and rejects 422 INVALID_TAX_ID', async () => {
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam', 'regional'])));
    const testEnv: WorkerEnv = { ...env, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    const bad = await callWorkerJson<{ error: { code: string } }>(
      workerApp, testEnv, '/api/regional/tax-id/validate', tokenTen1,
      { regionPack: 'co', taxIdType: 'NIT', taxIdNumber: '890900608-0' },
    );
    expect(bad.status).toBe(422);
    expect(bad.data.error.code).toBe('INVALID_TAX_ID');

    const veVal = await callWorkerJson<{ normalized: string }>(
      workerApp, testEnv, '/api/regional/tax-id/validate', tokenTen1,
      { regionPack: 've', taxIdType: 'RIF', taxIdNumber: 'j-40123456-7' },
    );
    expect(veVal.status).toBe(200);
    expect(veVal.data.normalized).toBe('J401234567');

    const veStamp = await callWorkerJson<{ taxMinor: number; withholdingMinor: number; hkaPrinterZReport: string | null }>(
      workerApp, testEnv, '/api/regional/fiscal/stamp', tokenTen1,
      {
        clientMutationId: 'p3-ve-1', regionPack: 've', invoiceNumber: 'FAC-VE-P3-1',
        currency: 'VES', exchangeRateMicros: 36_500_000, subtotalMinor: 20_000, islrWithholdingBps: 200,
        issuerTaxId: 'J-40123456-7', issuerTaxIdType: 'RIF',
        lines: [{ subtotalMinor: 10_000, taxRateBps: 1600 }, { subtotalMinor: 10_000, taxRateBps: 800 }],
      },
    );
    expect(veStamp.status).toBe(200);
    expect(veStamp.data.taxMinor).toBe(2_400);
    expect(veStamp.data.withholdingMinor).toBe(400);
    expect(veStamp.data.hkaPrinterZReport).toBeTruthy();

    const coStamp = await callWorkerJson<{ dianCufeSha384: string | null }>(
      workerApp, testEnv, '/api/regional/fiscal/stamp', tokenTen1,
      { clientMutationId: 'p3-co-1', regionPack: 'co', invoiceNumber: 'FE-CO-P3-1', currency: 'COP', subtotalMinor: 50_000, issuerTaxId: '890900608-9', issuerTaxIdType: 'NIT' },
    );
    expect(coStamp.status).toBe(200);
    expect(coStamp.data.dianCufeSha384).toMatch(/^[0-9a-f]{96}$/);

    const mxStamp = await callWorkerJson<{
      satCfdiUuid: string | null; mxPayments: { oxxoPayReference: string; speiClabe: string } | null;
    }>(workerApp, testEnv, '/api/regional/fiscal/stamp', tokenTen1, {
      clientMutationId: 'p3-mx-1', regionPack: 'mx', invoiceNumber: 'CFDI-MX-P3-1', currency: 'MXN', subtotalMinor: 100_000, issuerTaxId: 'XAXX010101000', issuerTaxIdType: 'RFC',
    });
    expect(mxStamp.status).toBe(200);
    expect(mxStamp.data.satCfdiUuid).toBeTruthy();
    expect(mxStamp.data.mxPayments?.oxxoPayReference).toMatch(/^\d{14}$/);
    expect(validateSpeiClabe(mxStamp.data.mxPayments?.speiClabe ?? '')).toBe(mxStamp.data.mxPayments?.speiClabe);
  });

  it('executes POS open -> checkout USD+VES & 422 mismatch -> SmartCheck (<=2 queries, 10s) -> returns -> close & /api/branch/pos/*', async () => {
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam', 'catalog', 'pos', 'wms'])));
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = { ...env, DB: counted.db, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    await callWorkerJson(workerApp, testEnv, '/api/branch/inventory/receive-lot', tokenTen1, {
      clientMutationId: 'p3-lot-amox', lotId: 'LOT-P3-AMOX', lotCode: 'LOT-P3-AMOX',
      productId: 'prod_p3_amox', qty: 10, unitCostMinor: 1000, expiryEpochMs: Date.now() + 10 * DAY_MS,
    });

    const open = await callWorkerJson<{ shiftId: string; status: string }>(
      workerApp, testEnv, '/api/pos/shifts/open', tokenTen1,
      { clientMutationId: 'p3-open-1', registerId: 'REG-P3-1', cashierName: 'Lucia', initialBalancesMinor: { USD: 10_000, VES: 500_000 } },
    );
    expect(open.status).toBe(200);
    expect(open.data.status).toBe('OPEN');

    counted.resetQueryCount();
    const mismatch = await callWorkerJson<{ error: { code: string } }>(
      workerApp, testEnv, '/api/pos/sales/checkout', tokenTen1,
      {
        clientMutationId: 'p3-sale-mismatch', shiftId: open.data.shiftId, orderCurrency: 'USD',
        items: [{ productId: 'prod_p3_amox', qty: 1 }],
        payments: [{ financialAccountId: 'acc_p3_usd', currency: 'VES', methodCode: 'PAGO_MOVIL', amountMinor: 91_250 }],
      },
    );
    expect(mismatch.status).toBe(422);
    expect(mismatch.data.error.code).toBe('ERR_CURRENCY_ACCOUNT_MISMATCH');
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);

    const tender = computeRemainingTender(2500, [{ currency: 'USD', amountMinor: 1000 }], 'USD', 'VES', 36_500_000);
    const sale = await callWorkerJson<{ orderId: string; grandTotalMinor: number; paidTotalMinor: number }>(
      workerApp, testEnv, '/api/pos/sales/checkout', tokenTen1,
      {
        clientMutationId: 'p3-sale-mixed', shiftId: open.data.shiftId, orderCurrency: 'USD',
        items: [{ productId: 'prod_p3_amox', qty: 1 }],
        payments: [
          { financialAccountId: 'acc_p3_usd', currency: 'USD', methodCode: 'USD_CASH', amountMinor: 1000 },
          { financialAccountId: 'acc_p3_ves', currency: 'VES', methodCode: 'PAGO_MOVIL', amountMinor: tender.remainingInTargetCurrencyMinor },
        ],
      },
    );
    expect(sale.status).toBe(200);
    expect(sale.data.grandTotalMinor).toBe(2500);
    expect(sale.data.paidTotalMinor).toBe(2500);

    counted.resetQueryCount();
    const smart = await callWorkerJson<{
      autoCloseSeconds: number; unitPriceInclTaxMinor: number; secondaryUnitPriceInclTaxMinor: number | null;
    }>(workerApp, testEnv, `/api/pos/kiosk/smartcheck?code=7599990001112&asOfSec=${nowSec}`, tokenTen1);
    expect(smart.status).toBe(200);
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(smart.data.autoCloseSeconds).toBe(10);
    expect(smart.data.unitPriceInclTaxMinor).toBe(5800);
    expect(smart.data.secondaryUnitPriceInclTaxMinor).toBe(211_700);

    const ret = await callWorkerJson<{ financialStatus: string }>(
      workerApp, testEnv, '/api/pos/returns/settle', tokenTen1,
      {
        clientMutationId: 'p3-ret-1', originalOrderId: sale.data.orderId, shiftId: open.data.shiftId,
        settlementMode: 'credit_memo', refundCurrency: 'USD', refundAmountMinor: 2500,
        items: [{ productId: 'prod_p3_amox', qty: 1, disposition: 'RESTOCK' }],
      },
    );
    expect(ret.status).toBe(200);
    expect(ret.data.financialStatus).toBe('credit_memo_issued');

    const brSale = await callWorkerJson<{ ticketSeq: number }>(
      workerApp, testEnv, '/api/branch/pos/checkout', tokenTen1,
      {
        clientMutationId: 'p3-br-sale', shiftId: open.data.shiftId, orderCurrency: 'USD',
        items: [{ productId: 'prod_p3_amox', qty: 1, unitPriceMinor: 2500 }],
        payments: [{ financialAccountId: 'acc_p3_usd', accountCurrency: 'USD', paymentCurrency: 'USD', methodCode: 'USD_CASH', amountMinor: 2500 }],
      },
    );
    expect(brSale.status).toBe(200);
    expect(brSale.data.ticketSeq).toBe(2);

    const brRet = await callWorkerJson<{ ok: true }>(
      workerApp, testEnv, '/api/branch/pos/return-approve', tokenTen1,
      { clientMutationId: 'p3-br-ret', originalOrderId: sale.data.orderId, shiftId: open.data.shiftId, items: [{ productId: 'prod_p3_amox', qty: 1, disposition: 'QUARANTINE' }] },
    );
    expect(brRet.status).toBe(200);

    const close = await callWorkerJson<{ status: string; totalTickets: number }>(
      workerApp, testEnv, '/api/pos/shifts/close', tokenTen1,
      { clientMutationId: 'p3-close-1', shiftId: open.data.shiftId, actualCountedBalancesMinor: { USD: 13_500, VES: 554_750 } },
    );
    expect(close.status).toBe(200);
    expect(close.data.status).toBe('CLOSED');
    expect(close.data.totalTickets).toBe(2);

    const brCloseDup = await callWorkerJson<{ error: { code: string } }>(
      workerApp, testEnv, '/api/branch/pos/close', tokenTen1,
      { clientMutationId: 'p3-br-close-dup', shiftId: open.data.shiftId, actualCountedBalancesMinor: { USD: 13_500 } },
    );
    expect(brCloseDup.status).toBe(409);
  });

  it('executes WMS pickings (-BACKORDER + <=2 list), landed costs, e-POD, and /mcp Phase 3 tools', async () => {
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam', 'regional', 'pos', 'wms'])));
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = { ...env, DB: counted.db, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    const asn = await callWorkerJson<{ doSynced: boolean }>(workerApp, testEnv, '/api/wms/pickings/process', tokenTen1, {
      clientMutationId: 'p3-wms-asn', pickingNumber: 'ASN-P3-1', operationKind: 'asn_receipt',
      sourceLocationId: 'loc_p3_vendor', destLocationId: 'loc_p3_main',
      lines: [{ productId: 'prod_p3_ibu', gs1RawBarcode: '(01)07501031311309(10)LOTWMS1(17)271231(21)SERW1', demandedQtyMicros: 10_000_000, doneQtyMicros: 10_000_000, unitCostMinor: 500 }],
    });
    expect(asn.status).toBe(200);
    expect(asn.data.doSynced).toBe(true);

    const ship = await callWorkerJson<{ backorderPicking: { pickingNumber: string } | null }>(workerApp, testEnv, '/api/wms/pickings/process', tokenTen1, {
      clientMutationId: 'p3-wms-ship', pickingNumber: 'OUT-P3-1', operationKind: 'outgoing_ship',
      sourceLocationId: 'loc_p3_main', destLocationId: 'loc_p3_customer',
      lines: [{ productId: 'prod_p3_ibu', demandedQtyMicros: 10_000_000, doneQtyMicros: 6_000_000 }],
    });
    expect(ship.status).toBe(200);
    expect(ship.data.backorderPicking?.pickingNumber).toBe('OUT-P3-1-BACKORDER');

    counted.resetQueryCount();
    const listed = await callWorkerJson<{ total: number }>(workerApp, testEnv, '/api/wms/pickings?search=OUT-P3-1', tokenTen1);
    expect(listed.status).toBe(200);
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(listed.data.total).toBe(2);

    const lc = await callWorkerJson<{ allocations: Array<{ allocatedCostMinor: number }> }>(workerApp, testEnv, '/api/wms/landed-costs/allocate', tokenTen1, {
      clientMutationId: 'p3-wms-lc', splitMethod: 'by_weight', totalFreightMinor: 1000,
      lines: [
        { lineId: 'l1', productId: 'prod_p3_amox', qtyMicros: 10_000_000, unitCostMinor: 1000, weightGrams: 500 },
        { lineId: 'l2', productId: 'prod_p3_ibu', qtyMicros: 10_000_000, unitCostMinor: 500, weightGrams: 500 },
        { lineId: 'l3', productId: 'prod_p3_harina', qtyMicros: 10_000_000, unitCostMinor: 600, weightGrams: 500 },
      ],
    });
    expect(lc.status).toBe(200);
    expect(lc.data.allocations.map((a) => a.allocatedCostMinor)).toEqual([334, 333, 333]);

    const epodFail = await callWorkerJson<{ error: { code: string } }>(workerApp, testEnv, '/api/wms/fleet/epod', tokenTen1, {
      clientMutationId: 'p3-epod-fail', vehicleId: 'veh_p3_dry', loadWeightGrams: 1000, loadPallets: 1, requiresColdChain: true,
      epodRecipientName: 'Luis', epodSignatureSvg: '<svg/>', epodPhotoR2Key: 'epod/1.jpg', epodLat: 10, epodLng: -67,
    });
    expect(epodFail.status).toBe(422);
    expect(epodFail.data.error.code).toBe('COLD_CHAIN_REQUIRED');

    const epodOk = await callWorkerJson<{ status: string }>(workerApp, testEnv, '/api/wms/fleet/epod', tokenTen1, {
      clientMutationId: 'p3-epod-ok', vehicleId: 'veh_p3_cold', loadWeightGrams: 12_000, loadPallets: 2, requiresColdChain: true,
      epodRecipientName: 'Luis', epodSignatureSvg: '<svg/>', epodPhotoR2Key: 'epod/2.jpg', epodLat: 10, epodLng: -67,
    });
    expect(epodOk.status).toBe(200);
    expect(epodOk.data.status).toBe('delivered');

    const toolsRpc = await callMcp(workerApp, testEnv, null, 'tools/list', {}, 20);
    const toolNames = (toolsRpc.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    for (const expected of EXPECTED_PHASE3_MCP_TOOLS) expect(toolNames).toContain(expected);

    expect(await callMcpTool(workerApp, testEnv, tokenTen1, 'regional.tax_id.validate', { regionPack: 'co', taxIdType: 'NIT', taxIdNumber: '890900608-9' }, 21)).toMatchObject({ normalized: '8909006089', isValid: true });
    expect(await callMcpTool(workerApp, testEnv, tokenTen1, 'pos.kiosk.smartcheck', { code: 'AMOX-P3', asOfSec: nowSec }, 22)).toMatchObject({ autoCloseSeconds: 10, sku: 'AMOX-P3' });
    expect((await callMcpTool<{ total: number }>(workerApp, testEnv, tokenTen2, 'wms.pickings.list', { limit: 10 }, 23)).total).toBe(0);
  });
});
