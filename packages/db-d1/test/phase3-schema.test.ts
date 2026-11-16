import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import migration0001Sql from '../migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../migrations/0003_phase3_pos_wms_regional.sql?raw';
import {
  comCartsAndPaylinks,
  comChannelsAndStores,
  comInvoicesAndFiscal,
  comOrderLines,
  comOrders,
  comPayments,
  comQuotes,
  comReturnsAndCreditMemos,
  createD1Client,
  finAccounts,
  iamOrganizations,
  iamTenants,
  posCashClosings,
  posRegistersAndDisplays,
  wmsFleetAndDeliveries,
  wmsLocations,
  wmsPackagesAndLots,
  wmsPickings,
  wmsPurchaseOrders,
  wmsQcAndCycleCounts,
  wmsReorderingAndPutawayRules,
  wmsStockMoves,
  wmsStockRequestsAndChat,
  wmsValuationAndLandedCosts,
  wmsWarehousesAndZones,
} from '../src/index.js';

async function applySqlScript(db: D1Database, sqlText: string): Promise<void> {
  const statements = sqlText
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
}

describe('@shac/db-d1 Phase 3 workerd POS, WMS & fin_accounts schema', () => {
  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
  });

  it('creates all 22 Phase 3 tables and merges all 54 schemas into Drizzle client', async () => {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    ).all<{ name: string }>();
    const names = new Set(result.results.map((r) => r.name));

    const expectedTables = [
      'pos_registers_and_displays',
      'pos_cash_closings',
      'com_channels_and_stores',
      'com_carts_and_paylinks',
      'com_quotes',
      'fin_accounts',
      'com_orders',
      'com_order_lines',
      'com_invoices_and_fiscal',
      'com_payments',
      'com_returns_and_credit_memos',
      'wms_warehouses_and_zones',
      'wms_locations',
      'wms_packages_and_lots',
      'wms_pickings',
      'wms_stock_moves',
      'wms_valuation_and_landed_costs',
      'wms_reordering_and_putaway_rules',
      'wms_qc_and_cycle_counts',
      'wms_purchase_orders',
      'wms_stock_requests_and_chat',
      'wms_fleet_and_deliveries',
    ];

    for (const tbl of expectedTables) {
      expect(names.has(tbl), `missing table ${tbl}`).toBe(true);
    }

    const db = createD1Client(env.DB);
    expect(Object.keys(db.query).length).toBeGreaterThanOrEqual(54);
  });

  it('supports integer-exact inserts/reads across fin_accounts, POS/commerce & WMS tables', async () => {
    const db = createD1Client(env.DB);
    const now = 1763400000;
    const base = { tenantId: 'ten_p3', orgId: 'org_p3', createdAt: now, updatedAt: now };

    await db.batch([
      db.insert(iamTenants).values({ id: 'ten_p3', slug: 'ten-p3', name: 'Phase 3 Tenant', createdAt: now, updatedAt: now }),
      db.insert(iamOrganizations).values({ id: 'org_p3', tenantId: 'ten_p3', rootId: 'org_p3', treePath: '/org_p3', slug: 'branch-1', name: 'Branch 1', createdAt: now, updatedAt: now }),
      db.insert(finAccounts).values({ ...base, id: 'acc_ves_pm', code: 'PAGO-MOVIL-VES', name: 'Pago Móvil VES', accountKind: 'digital_wallet', currency: 'VES', openingBalanceMinor: 100_000, currentBalanceMinor: 154_750, isDefault: true }),
      db.insert(posRegistersAndDisplays).values({ ...base, id: 'reg_01', code: 'CAJA-01', name: 'Caja 01', deviceMode: 'POS_REGISTER' }),
      db.insert(posCashClosings).values({ ...base, id: 'close_01', shiftId: 'shift_01', registerId: 'reg_01', cashierUserId: 'usr_1', openedAt: now - 3600, closedAt: now, shiftDurationSec: 3600, totalTickets: 20 }),
      db.insert(comChannelsAndStores).values({ ...base, id: 'chn_pos', code: 'POS-STORE', name: 'Tienda Física', channelKind: 'pos' }),
      db.insert(comCartsAndPaylinks).values({ ...base, id: 'cart_01', recordKind: 'cart', currency: 'USD' }),
      db.insert(comQuotes).values({ ...base, id: 'quo_01', quoteNumber: 'Q-2026-0001', partyId: 'pty_1', currency: 'USD', exchangeRateMicros: 36_500_000, totalMinor: 2500 }),
      db.insert(comOrders).values({ ...base, id: 'ord_01', orderNumber: 'POS-2026-0001', orderKind: 'pos_sale', channelId: 'chn_pos', shiftId: 'shift_01', registerId: 'reg_01', partyId: 'pty_1', currency: 'USD', exchangeRateMicros: 36_500_000, subtotalGeneralMinor: 2155, taxGeneralMinor: 345, grandTotalMinor: 2500, paidTotalMinor: 2500, marginBps: 2450, fulfillmentStatus: 'fulfilled', paymentStatus: 'paid', status: 'completed', clientMutationId: 'mut_pos_01' }),
      db.insert(comOrderLines).values({ ...base, id: 'ordl_01', orderId: 'ord_01', lineNo: 1, productId: 'prod_1', sku: 'SKU-001', name: 'Producto A', qtyMicros: 2_000_000, unitCostMinor: 800, basePriceMinor: 1078, unitPriceMinor: 1078, taxRateBps: 1600, taxMinor: 345, lineTotalMinor: 2500 }),
      db.insert(comInvoicesAndFiscal).values({ ...base, id: 'inv_01', invoiceNumber: 'FAC-0001', orderId: 'ord_01', partyId: 'pty_1', issueDate: '2026-11-16', currency: 'USD', exchangeRateMicros: 36_500_000, subtotalMinor: 2155, taxMinor: 345, totalMinor: 2500, paidMinor: 2500, balanceDueMinor: 0, regionPack: 've', fiscalControlNumber: '00-0001001', status: 'issued' }),
      db.insert(comPayments).values({ ...base, id: 'pay_01', paymentNumber: 'PAY-0001', orderId: 'ord_01', invoiceId: 'inv_01', shiftId: 'shift_01', financialAccountId: 'acc_ves_pm', methodCode: 'PAGO_MOVIL', currency: 'VES', amountMinor: 54_750, exchangeRateMicros: 36_500_000, referenceNumber: '123456', idempotencyKey: 'idem_pay_01', status: 'captured', paidAt: now }),
      db.insert(comReturnsAndCreditMemos).values({ ...base, id: 'ret_01', returnNumber: 'RET-0001', originalOrderId: 'ord_01', refundCurrency: 'VES', refundAmountMinor: 54_750, refundAccountId: 'acc_ves_pm' }),
      db.insert(wmsWarehousesAndZones).values({ ...base, id: 'wh_01', code: 'WH-CENTRAL', name: 'Almacén Central', zoneCode: 'DRY-A', zoneKind: 'dry', capacityWeightGrams: 5_000_000, isPrimary: true }),
      db.insert(wmsLocations).values({ ...base, id: 'loc_bin_a1', warehouseId: 'wh_01', completeName: 'WH-CENTRAL/DRY-A/A1', locationKind: 'internal_bin' }),
      db.insert(wmsPackagesAndLots).values({ ...base, id: 'lot_01', recordKind: 'lot', productId: 'prod_1', lotOrPackageCode: 'LOT2026A', expirationDate: '2027-12-31', currentLocationId: 'loc_bin_a1' }),
      db.insert(wmsPickings).values({ ...base, id: 'pick_01', pickingNumber: 'PICK-0001', operationKind: 'outgoing_ship', sourceLocationId: 'loc_bin_a1', destLocationId: 'loc_cust_virt', orderId: 'ord_01', status: 'done' }),
      db.insert(wmsStockMoves).values({ ...base, id: 'move_01', pickingId: 'pick_01', productId: 'prod_1', lotId: 'lot_01', sourceLocationId: 'loc_bin_a1', destLocationId: 'loc_cust_virt', demandedQtyMicros: 2_000_000, doneQtyMicros: 2_000_000, unitCostMinor: 800, currency: 'USD', idempotencyKey: 'idem_move_01', occurredAt: now }),
      db.insert(wmsValuationAndLandedCosts).values({ ...base, id: 'val_01', recordKind: 'valuation_layer', productId: 'prod_1', stockMoveId: 'move_01', qtyMicros: 2_000_000, unitCostMinor: 800, totalValueMinor: 1600 }),
      db.insert(wmsReorderingAndPutawayRules).values({ ...base, id: 'rule_01', ruleKind: 'reorder_minmax', warehouseId: 'wh_01', productId: 'prod_1', minQtyMicros: 5_000_000, maxQtyMicros: 20_000_000 }),
      db.insert(wmsQcAndCycleCounts).values({ ...base, id: 'qc_01', recordKind: 'quality_check', warehouseId: 'wh_01', pickingId: 'pick_01', productId: 'prod_1', measuredValue: 4, normMin: 2, normMax: 8, status: 'passed' }),
      db.insert(wmsPurchaseOrders).values({ ...base, id: 'po_01', poNumber: 'PO-2026-0001', supplierPartyId: 'pty_sup_1', warehouseId: 'wh_01', totalMinor: 16_000 }),
      db.insert(wmsStockRequestsAndChat).values({ id: 'sreq_01', tenantId: 'ten_p3', requestingOrgId: 'org_p3', fulfillingOrgId: 'org_hq', crossDockReady: true, createdAt: now, updatedAt: now }),
      db.insert(wmsFleetAndDeliveries).values({ ...base, id: 'fleet_01', recordKind: 'delivery_trip', vehicleCode: 'TRK-01', maxPallets: 8, maxWeightGrams: 3_500_000, isRefrigerated: true, orderId: 'ord_01', epodLat: 10.4806, epodLng: -66.9036 }),
    ]);

    const [account] = await db
      .select()
      .from(finAccounts)
      .where(and(eq(finAccounts.tenantId, 'ten_p3'), eq(finAccounts.code, 'PAGO-MOVIL-VES')));
    expect(account?.currency).toBe('VES');
    expect(account?.currentBalanceMinor).toBe(154_750);
    expect(Number.isInteger(account?.currentBalanceMinor)).toBe(true);

    const [order] = await db
      .select()
      .from(comOrders)
      .where(and(eq(comOrders.tenantId, 'ten_p3'), eq(comOrders.orderNumber, 'POS-2026-0001')));
    expect(order?.grandTotalMinor).toBe(2500);
    expect(order?.exchangeRateMicros).toBe(36_500_000);

    const [payment] = await db
      .select()
      .from(comPayments)
      .where(and(eq(comPayments.tenantId, 'ten_p3'), eq(comPayments.idempotencyKey, 'idem_pay_01')));
    expect(payment?.amountMinor).toBe(54_750);

    const [picking] = await db
      .select()
      .from(wmsPickings)
      .where(and(eq(wmsPickings.tenantId, 'ten_p3'), eq(wmsPickings.pickingNumber, 'PICK-0001')));
    expect(picking?.status).toBe('done');

    const [move] = await db
      .select()
      .from(wmsStockMoves)
      .where(and(eq(wmsStockMoves.tenantId, 'ten_p3'), eq(wmsStockMoves.idempotencyKey, 'idem_move_01')));
    expect(move?.doneQtyMicros).toBe(2_000_000);
    expect(move?.unitCostMinor).toBe(800);
  });

  it('enforces tenant-scoped UNIQUE indexes on fin_accounts, com_orders, com_payments, wms_stock_moves', async () => {
    const db = createD1Client(env.DB);
    const now = 1763400100;
    const base = { tenantId: 'ten_p3', orgId: 'org_p3', createdAt: now, updatedAt: now };

    await expect(
      db.insert(finAccounts).values({ ...base, id: 'acc_dup', code: 'PAGO-MOVIL-VES', name: 'Dup', currency: 'VES' }),
    ).rejects.toThrow();

    await expect(
      db.insert(comOrders).values({ ...base, id: 'ord_dup_num', orderNumber: 'POS-2026-0001' }),
    ).rejects.toThrow();

    await expect(
      db.insert(comOrders).values({ ...base, id: 'ord_dup_mut', orderNumber: 'POS-2026-0002', clientMutationId: 'mut_pos_01' }),
    ).rejects.toThrow();

    await expect(
      db.insert(comPayments).values({
        ...base,
        id: 'pay_dup',
        paymentNumber: 'PAY-0002',
        financialAccountId: 'acc_ves_pm',
        methodCode: 'PAGO_MOVIL',
        currency: 'VES',
        amountMinor: 100,
        idempotencyKey: 'idem_pay_01',
        paidAt: now,
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(wmsStockMoves).values({
        ...base,
        id: 'move_dup',
        productId: 'prod_1',
        sourceLocationId: 'loc_bin_a1',
        destLocationId: 'loc_cust_virt',
        idempotencyKey: 'idem_move_01',
        occurredAt: now,
      }),
    ).rejects.toThrow();

    await db.insert(finAccounts).values({
      id: 'acc_other_ten',
      tenantId: 'ten_other',
      orgId: 'org_other',
      code: 'PAGO-MOVIL-VES',
      name: 'Other Tenant Wallet',
      currency: 'VES',
      createdAt: now,
      updatedAt: now,
    });
    const [other] = await db
      .select()
      .from(finAccounts)
      .where(and(eq(finAccounts.tenantId, 'ten_other'), eq(finAccounts.code, 'PAGO-MOVIL-VES')));
    expect(other?.id).toBe('acc_other_ten');
  });
});
