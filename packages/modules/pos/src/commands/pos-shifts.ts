import type { ClosePosShiftResult, OpenPosShiftResult } from '@shac/actor-branch';
import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  posCashClosings,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand } from '@shac/kernel';
import type { z } from 'zod';
import {
  callBranchDoJson,
  computeCommandRequestHash,
  normalizeCurrencyMap,
  resolveScopedTargetOrg,
} from '../lib/pos-helpers.js';
import {
  posShiftsCloseInputSchema,
  posShiftsCloseOutputSchema,
  posShiftsOpenInputSchema,
  posShiftsOpenOutputSchema,
} from './pos-schemas.js';

function formatPlainTextClosingReport(
  result: ClosePosShiftResult,
  observations?: string,
): string {
  const lines = [
    `SHIFT CLOSING ${result.shiftId} (REG ${result.registerId})`,
    `CASHIER: ${result.cashierName} (${result.cashierUserId})`,
    `TICKETS: ${result.totalTickets} | DURATION_SEC: ${result.shiftDurationSec}`,
    `EXPECTED: ${JSON.stringify(result.expectedBalancesMinor)}`,
    `ACTUAL: ${JSON.stringify(result.actualCountedBalancesMinor)}`,
    `DISCREPANCY: ${JSON.stringify(result.discrepancyBalancesMinor)}`,
  ];
  if (observations) {
    lines.push(`OBSERVATIONS: ${observations}`);
  }
  return lines.join('\n');
}

export const posShiftsOpenCommand = defineCommand<
  typeof posShiftsOpenInputSchema,
  z.infer<typeof posShiftsOpenOutputSchema>,
  ShacD1Database
>({
  id: 'pos.shifts.open',
  moduleId: 'pos',
  method: 'POST',
  path: '/api/pos/shifts/open',
  summary: 'Open an exclusive multi-currency POS shift in BranchInventoryDO',
  requiredPermission: 'pos.shifts.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Open an exclusive POS register shift with integer multi-currency initial drawer balances',
  },
  inputSchema: posShiftsOpenInputSchema,
  outputSchema: posShiftsOpenOutputSchema,
  async handler(ctx, input) {
    const initialBalancesMinor = normalizeCurrencyMap(input.initialBalancesMinor);
    const cashierUserId = input.cashierUserId ?? ctx.actor.id;
    const requestHash = await computeCommandRequestHash('pos.shifts.open', {
      orgId: input.orgId ?? null,
      shiftId: input.shiftId ?? null,
      registerId: input.registerId,
      cashierUserId,
      cashierName: input.cashierName,
      initialBalancesMinor,
    });

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      posShiftsOpenOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    const doResult = await callBranchDoJson<OpenPosShiftResult>(
      ctx,
      targetOrgId,
      '/pos-shift',
      {
        clientMutationId: input.clientMutationId,
        shiftId: input.shiftId,
        registerId: input.registerId,
        cashierUserId,
        cashierName: input.cashierName,
        initialBalancesMinor,
        openedAt: input.openedAt,
      },
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const output = posShiftsOpenOutputSchema.parse(doResult);
    const responseJson = JSON.stringify(output);

    await ctx.db.batch([
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'pos.shifts.open',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'pos.shifts.open',
        resourceKind: 'pos_shift',
        resourceId: output.shiftId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return output;
  },
});

export const posShiftsCloseCommand = defineCommand<
  typeof posShiftsCloseInputSchema,
  z.infer<typeof posShiftsCloseOutputSchema>,
  ShacD1Database
>({
  id: 'pos.shifts.close',
  moduleId: 'pos',
  method: 'POST',
  path: '/api/pos/shifts/close',
  summary: 'Close an open POS shift in BranchInventoryDO and save blind closing in D1',
  requiredPermission: 'pos.shifts.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Close the active POS register shift in BranchInventoryDO and persist pos_cash_closings in D1',
  },
  inputSchema: posShiftsCloseInputSchema,
  outputSchema: posShiftsCloseOutputSchema,
  async handler(ctx, input) {
    const actualCountedBalancesMinor = normalizeCurrencyMap(
      input.actualCountedBalancesMinor,
    );
    const requestHash = await computeCommandRequestHash('pos.shifts.close', {
      orgId: input.orgId ?? null,
      shiftId: input.shiftId ?? null,
      registerId: input.registerId ?? null,
      actualCountedBalancesMinor,
      observations: input.observations ?? null,
    });

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      posShiftsCloseOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    const doResult = await callBranchDoJson<ClosePosShiftResult>(
      ctx,
      targetOrgId,
      '/pos-close',
      {
        clientMutationId: input.clientMutationId,
        shiftId: input.shiftId,
        registerId: input.registerId,
        actualCountedBalancesMinor,
        closedByUserId: ctx.actor.id,
        observations: input.observations,
        closedAt: input.closedAt,
      },
    );

    const nowSec = Math.floor(Date.now() / 1000);
    const closingId = crypto.randomUUID();
    const plainTextReport =
      input.plainTextReport ??
      formatPlainTextClosingReport(doResult, input.observations);

    const output: z.infer<typeof posShiftsCloseOutputSchema> = {
      id: closingId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      shiftId: doResult.shiftId,
      registerId: doResult.registerId,
      cashierUserId: doResult.cashierUserId,
      cashierName: doResult.cashierName,
      status: 'CLOSED',
      openedAt: doResult.openedAt,
      closedAt: doResult.closedAt,
      shiftDurationSec: doResult.shiftDurationSec,
      totalTickets: doResult.totalTickets,
      initialBalancesMinor: doResult.initialBalancesMinor,
      salesByCurrencyMinor: doResult.salesByCurrencyMinor,
      salesByMethodMinor: doResult.salesByMethodMinor,
      expensesByCurrencyMinor: doResult.expensesByCurrencyMinor,
      expectedBalancesMinor: doResult.expectedBalancesMinor,
      actualCountedBalancesMinor: doResult.actualCountedBalancesMinor,
      discrepancyBalancesMinor: doResult.discrepancyBalancesMinor,
      auditStatus: 'pending',
      plainTextReport,
      outboxSeqId: doResult.outboxSeqId,
    };
    const responseJson = JSON.stringify(output);

    await ctx.db.batch([
      ctx.db
        .insert(posCashClosings)
        .values({
          id: closingId,
          tenantId: ctx.tenantId,
          orgId: targetOrgId,
          shiftId: doResult.shiftId,
          registerId: doResult.registerId,
          cashierUserId: doResult.cashierUserId,
          openedAt: doResult.openedAt,
          closedAt: doResult.closedAt,
          shiftDurationSec: doResult.shiftDurationSec,
          initialBalancesJson: JSON.stringify(doResult.initialBalancesMinor),
          expectedBalancesJson: JSON.stringify(doResult.expectedBalancesMinor),
          actualCountedBalancesJson: JSON.stringify(
            doResult.actualCountedBalancesMinor,
          ),
          discrepancyBalancesJson: JSON.stringify(
            doResult.discrepancyBalancesMinor,
          ),
          salesByCurrencyJson: JSON.stringify(doResult.salesByCurrencyMinor),
          salesByMethodJson: JSON.stringify(doResult.salesByMethodMinor),
          expensesByCurrencyJson: JSON.stringify(
            doResult.expensesByCurrencyMinor,
          ),
          topPartiesJson: '[]',
          totalTickets: doResult.totalTickets,
          auditStatus: 'pending',
          observations: input.observations ?? null,
          plainTextReport,
          createdAt: nowSec,
          updatedAt: nowSec,
        })
        .onConflictDoNothing({
          target: [posCashClosings.tenantId, posCashClosings.shiftId],
        }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'pos.shifts.close',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'pos.shifts.close',
        resourceKind: 'pos_cash_closing',
        resourceId: closingId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return output;
  },
});
