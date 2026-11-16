import { env } from 'cloudflare:test';
import {
  comReturnsAndCreditMemos,
  finAccounts,
  posCashClosings,
} from '@shac/db-d1';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import {
  posKioskSmartCheckCommand,
  posReturnsSettleCommand,
  posSalesCheckoutCommand,
  posShiftsCloseCommand,
  posShiftsOpenCommand,
} from '../src/index.js';
import {
  applySqlScript,
  makePosCtx,
  seedAmoxBranchLots,
  seedPosFixtures,
  seedTenantsAndOrgs,
} from './test-helpers.js';

describe('@shac/mod-pos 2-phase returns, shift closing & isolation on workerd', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let shiftId = '';
  let orderId = '';

  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await seedTenantsAndOrgs(env.DB);
    await seedPosFixtures(env.DB, nowSec);
    await seedAmoxBranchLots(env.BRANCH_DO);

    const ctx = makePosCtx(env.DB, env.BRANCH_DO);
    const shift = await posShiftsOpenCommand.handler(
      ctx,
      posShiftsOpenCommand.inputSchema.parse({
        clientMutationId: 'ret-suite-open',
        registerId: 'REG-RET-1',
        cashierName: 'Luis Cajero',
        initialBalancesMinor: { USD: 10_000 },
      }),
    );
    shiftId = shift.shiftId;

    const sale = await posSalesCheckoutCommand.handler(
      ctx,
      posSalesCheckoutCommand.inputSchema.parse({
        clientMutationId: 'ret-suite-sale',
        shiftId,
        orderCurrency: 'USD',
        items: [{ productId: 'prod_amox', qty: 1 }],
        payments: [
          {
            financialAccountId: 'acc_usd_cash',
            currency: 'USD',
            methodCode: 'USD_CASH',
            amountMinor: 2500,
          },
        ],
      }),
    );
    orderId = sale.orderId;
  });

  it('enforces Cuenta=Moneda on returns, executes 2-phase DO+D1 restock & credit memo, and closes shift', async () => {
    const ctx = makePosCtx(env.DB, env.BRANCH_DO);

    await expect(
      posReturnsSettleCommand.handler(
        ctx,
        posReturnsSettleCommand.inputSchema.parse({
          clientMutationId: 'ret-suite-mismatch',
          originalOrderId: orderId,
          settlementMode: 'refund_account',
          refundCurrency: 'VES',
          refundAmountMinor: 36_500,
          refundAccountId: 'acc_usd_cash',
          items: [{ productId: 'prod_amox', qty: 1, disposition: 'RESTOCK' }],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'ERR_CURRENCY_ACCOUNT_MISMATCH',
      status: 422,
    });

    const refunded = await posReturnsSettleCommand.handler(
      ctx,
      posReturnsSettleCommand.inputSchema.parse({
        clientMutationId: 'ret-suite-refund',
        originalOrderId: orderId,
        shiftId,
        returnType: 'partial',
        settlementMode: 'refund_account',
        refundCurrency: 'USD',
        refundAmountMinor: 1000,
        refundAccountId: 'acc_usd_cash',
        items: [
          {
            productId: 'prod_amox',
            lotId: 'LOT-POS-EARLY',
            qty: 1,
            disposition: 'RESTOCK',
          },
        ],
      }),
    );
    expect(refunded.physicalStatus).toBe('inspected_restocked');
    expect(refunded.financialStatus).toBe('refunded_cash_bank');

    const creditMemo = await posReturnsSettleCommand.handler(
      ctx,
      posReturnsSettleCommand.inputSchema.parse({
        clientMutationId: 'ret-suite-cm',
        originalOrderId: orderId,
        shiftId,
        returnType: 'partial',
        settlementMode: 'credit_memo',
        refundCurrency: 'USD',
        refundAmountMinor: 500,
        items: [{ productId: 'prod_amox', qty: 1, disposition: 'QUARANTINE' }],
      }),
    );
    expect(creditMemo.financialStatus).toBe('credit_memo_issued');

    const stub = env.BRANCH_DO.get(env.BRANCH_DO.idFromName('ten_a:org_a'));
    const bal = await stub.getBalances('prod_amox');
    expect(bal.totalAvailableQty).toBe(15);
    expect(bal.totalOnHandQty).toBe(16);

    const [usdAcct] = await ctx.db
      .select({ bal: finAccounts.currentBalanceMinor })
      .from(finAccounts)
      .where(eq(finAccounts.id, 'acc_usd_cash'));
    expect(usdAcct?.bal).toBe(11_500);

    const [retRow] = await ctx.db
      .select({ id: comReturnsAndCreditMemos.id })
      .from(comReturnsAndCreditMemos)
      .where(eq(comReturnsAndCreditMemos.id, refunded.returnId));
    expect(retRow?.id).toBe(refunded.returnId);

    const closed = await posShiftsCloseCommand.handler(
      ctx,
      posShiftsCloseCommand.inputSchema.parse({
        clientMutationId: 'ret-suite-close',
        shiftId,
        actualCountedBalancesMinor: { USD: 12_500 },
        observations: 'Arqueo exacto',
      }),
    );
    expect(closed.status).toBe('CLOSED');
    expect(closed.totalTickets).toBe(1);
    expect(closed.discrepancyBalancesMinor).toEqual({ USD: 0 });

    const [closingRow] = await ctx.db
      .select({ id: posCashClosings.id })
      .from(posCashClosings)
      .where(eq(posCashClosings.shiftId, shiftId));
    expect(closingRow?.id).toBe(closed.id);

    await expect(
      posSalesCheckoutCommand.handler(
        ctx,
        posSalesCheckoutCommand.inputSchema.parse({
          clientMutationId: 'ret-suite-after-close',
          shiftId,
          orderCurrency: 'USD',
          items: [{ productId: 'prod_amox', qty: 1 }],
          payments: [
            {
              financialAccountId: 'acc_usd_cash',
              currency: 'USD',
              methodCode: 'USD_CASH',
              amountMinor: 2500,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'SHIFT_NOT_OPEN', status: 409 });
  });

  it('enforces multi-tenant 404 and org subtree 403 boundaries across POS commands', async () => {
    const ctxTenA = makePosCtx(env.DB, env.BRANCH_DO);
    const ctxTenB = makePosCtx(env.DB, env.BRANCH_DO, { tenantId: 'ten_b' });

    await expect(
      posKioskSmartCheckCommand.handler(
        ctxTenB,
        posKioskSmartCheckCommand.inputSchema.parse({ code: 'AMOX-500' }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await expect(
      posReturnsSettleCommand.handler(
        ctxTenB,
        posReturnsSettleCommand.inputSchema.parse({
          clientMutationId: 'ret-cross-tenant',
          originalOrderId: orderId,
          refundCurrency: 'USD',
          refundAmountMinor: 100,
          items: [{ productId: 'prod_amox', qty: 1, disposition: 'RESTOCK' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await expect(
      posSalesCheckoutCommand.handler(
        ctxTenA,
        posSalesCheckoutCommand.inputSchema.parse({
          clientMutationId: 'sale-cross-org-acct',
          registerId: 'REG-RET-1',
          orderCurrency: 'USD',
          items: [{ productId: 'prod_amox', qty: 1 }],
          payments: [
            {
              financialAccountId: 'acc_org_other_usd',
              currency: 'USD',
              methodCode: 'USD_CASH',
              amountMinor: 2500,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ORG_SCOPE', status: 403 });

    await expect(
      posShiftsOpenCommand.handler(
        ctxTenA,
        posShiftsOpenCommand.inputSchema.parse({
          clientMutationId: 'open-cross-org',
          orgId: 'org_a_other',
          registerId: 'REG-OTHER',
          cashierName: 'Out of Scope',
          initialBalancesMinor: { USD: 0 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ORG_SCOPE', status: 403 });
  });
});
