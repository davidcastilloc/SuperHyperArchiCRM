import { env } from 'cloudflare:test';
import type { BalancesResult } from '@shac/actor-branch';
import {
  comOrders,
  comPayments,
  finAccounts,
  wrapD1WithCounter,
} from '@shac/db-d1';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import {
  computeRemainingTender,
  modPosManifest,
  posKioskSmartCheckCommand,
  posSalesCheckoutCommand,
  posShiftsOpenCommand,
} from '../src/index.js';
import {
  applySqlScript,
  makePosCtx,
  seedAmoxBranchLots,
  seedPosFixtures,
  seedTenantsAndOrgs,
} from './test-helpers.js';

describe('@shac/mod-pos checkout & SmartCheck on workerd', () => {
  const nowSec = Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await seedTenantsAndOrgs(env.DB);
    await seedPosFixtures(env.DB, nowSec);
    await seedAmoxBranchLots(env.BRANCH_DO);
  });

  it('exports modPosManifest with 6 MCP-exposed commands', () => {
    expect(modPosManifest.id).toBe('pos');
    expect(modPosManifest.commands.map((c) => c.id)).toEqual([
      'pos.shifts.open',
      'pos.shifts.close',
      'pos.sales.checkout',
      'pos.orders.list',
      'pos.kiosk.smartcheck',
      'pos.returns.settle',
    ]);
    for (const cmd of modPosManifest.commands) {
      expect(cmd.moduleId).toBe('pos');
      expect(cmd.mcp.expose).toBe(true);
    }
  });

  it('rejects 422 ERR_CURRENCY_ACCOUNT_MISMATCH in <= 2 D1 queries without mutating D1 or DO, then settles mixed USD+VES checkout idempotently', async () => {
    const ctx = makePosCtx(env.DB, env.BRANCH_DO);
    const shift = await posShiftsOpenCommand.handler(
      ctx,
      posShiftsOpenCommand.inputSchema.parse({
        clientMutationId: 'pos-open-1',
        registerId: 'REG-1',
        cashierName: 'Ana Cajera',
        initialBalancesMinor: { USD: 10_000, VES: 500_000 },
      }),
    );
    expect(shift.status).toBe('OPEN');

    const tender = computeRemainingTender(
      2500,
      [{ currency: 'USD', amountMinor: 1000 }],
      'USD',
      'VES',
      36_500_000,
    );
    expect(tender.remainingInOrderCurrencyMinor).toBe(1500);
    expect(tender.remainingInTargetCurrencyMinor).toBe(54_750);

    const counted = wrapD1WithCounter(env.DB);
    const countedCtx = makePosCtx(counted.db, env.BRANCH_DO);
    await expect(
      posSalesCheckoutCommand.handler(
        countedCtx,
        posSalesCheckoutCommand.inputSchema.parse({
          clientMutationId: 'pos-sale-mismatch',
          shiftId: shift.shiftId,
          orderCurrency: 'USD',
          items: [{ productId: 'prod_amox', qty: 1 }],
          payments: [
            {
              financialAccountId: 'acc_usd_cash',
              currency: 'VES',
              methodCode: 'PAGO_MOVIL',
              amountMinor: 91_250,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'ERR_CURRENCY_ACCOUNT_MISMATCH',
      status: 422,
    });
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);

    const stub = env.BRANCH_DO.get(env.BRANCH_DO.idFromName('ten_a:org_a'));
    const balBefore: BalancesResult = await stub.getBalances('prod_amox');
    expect(balBefore.totalAvailableQty).toBe(15);

    const checkoutInput = posSalesCheckoutCommand.inputSchema.parse({
      clientMutationId: 'pos-sale-mixed-1',
      shiftId: shift.shiftId,
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
          amountMinor: tender.remainingInTargetCurrencyMinor,
          referenceNumber: 'PM-998877',
        },
      ],
    });

    const sale = await posSalesCheckoutCommand.handler(ctx, checkoutInput);
    expect(sale.grandTotalMinor).toBe(2500);
    expect(sale.paidTotalMinor).toBe(2500);
    expect(sale.lines[0]?.lotId).toBe('LOT-POS-EARLY');

    const replay = await posSalesCheckoutCommand.handler(ctx, checkoutInput);
    expect(replay).toEqual(sale);
    await expect(
      posSalesCheckoutCommand.handler(
        ctx,
        posSalesCheckoutCommand.inputSchema.parse({
          ...checkoutInput,
          items: [{ productId: 'prod_amox', qty: 2 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });

    const balAfter: BalancesResult = await stub.getBalances('prod_amox');
    expect(balAfter.totalAvailableQty).toBe(14);

    const [usdAcct] = await ctx.db
      .select({ bal: finAccounts.currentBalanceMinor })
      .from(finAccounts)
      .where(eq(finAccounts.id, 'acc_usd_cash'));
    const [vesAcct] = await ctx.db
      .select({ bal: finAccounts.currentBalanceMinor })
      .from(finAccounts)
      .where(eq(finAccounts.id, 'acc_ves_pm'));
    expect(usdAcct?.bal).toBe(11_000);
    expect(vesAcct?.bal).toBe(554_750);

    const dbPays = await ctx.db
      .select({ id: comPayments.id })
      .from(comPayments)
      .where(eq(comPayments.orderId, sale.orderId));
    expect(dbPays).toHaveLength(2);
    const dbOrders = await ctx.db
      .select({ id: comOrders.id })
      .from(comOrders)
      .where(eq(comOrders.id, sale.orderId));
    expect(dbOrders).toHaveLength(1);
  });

  it('runs SmartCheck kiosk in <= 2 D1 queries with autoCloseSeconds=10 and dual tax-inclusive prices', async () => {
    const counted = wrapD1WithCounter(env.DB);
    const countedCtx = makePosCtx(counted.db, env.BRANCH_DO);
    const res = await posKioskSmartCheckCommand.handler(
      countedCtx,
      posKioskSmartCheckCommand.inputSchema.parse({
        code: '7599990001112',
        asOfSec: nowSec,
      }),
    );

    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(res.autoCloseSeconds).toBe(10);
    expect(res.unitPriceExclTaxMinor).toBe(5000);
    expect(res.unitTaxMinor).toBe(800);
    expect(res.unitPriceInclTaxMinor).toBe(5800);
    expect(res.secondaryCurrency).toBe('VES');
    expect(res.secondaryUnitPriceInclTaxMinor).toBe(211_700);

    counted.resetQueryCount();
    const baseRes = await posKioskSmartCheckCommand.handler(
      countedCtx,
      posKioskSmartCheckCommand.inputSchema.parse({
        code: 'AMOX-500',
        asOfSec: nowSec,
      }),
    );
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(baseRes.autoCloseSeconds).toBe(10);
    expect(baseRes.variantId).toBeNull();
    expect(baseRes.unitPriceInclTaxMinor).toBe(2500);
    expect(baseRes.secondaryUnitPriceInclTaxMinor).toBe(91_250);
  });

  it('lists sales orders with party names and revenue KPI summary in <= 2 D1 queries and isolates tenants', async () => {
    const posModule = await import('../src/index.js');
    expect('posOrdersListCommand' in posModule).toBe(true);
    const { posOrdersListCommand } = posModule as typeof import('../src/index.js') & {
      posOrdersListCommand: typeof posKioskSmartCheckCommand;
    };

    const counted = wrapD1WithCounter(env.DB);
    const ctxA = makePosCtx(counted.db, env.BRANCH_DO);
    const resA = await posOrdersListCommand.handler(
      ctxA,
      posOrdersListCommand.inputSchema.parse({ limit: 25 }),
    );
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    const typedA = resA as unknown as {
      items: Array<{ orderNumber: string; grandTotalMinor: number }>;
      summary: { totalCount: number; grossRevenueMinor: number };
    };
    expect(typedA.items.length).toBeGreaterThanOrEqual(1);
    expect(typedA.summary.totalCount).toBeGreaterThanOrEqual(1);
    expect(typedA.summary.grossRevenueMinor).toBeGreaterThan(0);

    const ctxB = { ...makePosCtx(env.DB, env.BRANCH_DO), tenantId: 'ten_b', orgId: 'org_b', orgPath: '/org_b' };
    const resB = (await posOrdersListCommand.handler(
      ctxB,
      posOrdersListCommand.inputSchema.parse({ limit: 25 }),
    )) as unknown as { items: unknown[]; summary: { totalCount: number; grossRevenueMinor: number } };
    expect(resB.items).toHaveLength(0);
    expect(resB.summary.totalCount).toBe(0);
    expect(resB.summary.grossRevenueMinor).toBe(0);
  });
});
