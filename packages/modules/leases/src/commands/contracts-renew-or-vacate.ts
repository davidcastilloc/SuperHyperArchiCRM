import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  leaseContractsAndRenewals,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertLeaseInScope } from '../lib/scope-helpers.js';
import { computeSplitRentShares } from '../split-rent.js';

const renewOrVacateInputSchema = z.discriminatedUnion('action', [
  z.object({
    clientMutationId: z.string().min(1).max(128),
    leaseId: z.string().min(1),
    action: z.literal('renewal_offer'),
    renewalLeaseNumber: z.string().min(1).max(64).optional(),
    newStartDate: z.number().int().positive(),
    newEndDate: z.number().int().positive(),
    newMonthlyRentMinor: z.number().int().nonnegative(),
    renewalIncentives: z.record(z.unknown()).default({}),
    splitRentShares: z
      .array(
        z.object({
          partyId: z.string().min(1),
          shareBps: z.number().int().min(0).max(10_000),
          label: z.string().max(80).optional(),
        }),
      )
      .optional(),
  }),
  z.object({
    clientMutationId: z.string().min(1).max(128),
    leaseId: z.string().min(1),
    action: z.literal('vacate_notice'),
    intendedMoveOut: z.number().int().positive(),
    forwardingAddress: z.string().min(1).max(400),
    moveInOutInspectionR2Key: z.string().max(256).nullable().optional(),
  }),
]);

const renewOrVacateOutputSchema = z.object({
  id: z.string(),
  sourceLeaseId: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  action: z.enum(['renewal_offer', 'vacate_notice']),
  recordKind: z.string(),
  status: z.string(),
  monthlyRentMinor: z.number().int().nonnegative().optional(),
  vacateNotice: z.record(z.unknown()).optional(),
  renewalIncentives: z.record(z.unknown()).optional(),
  updatedAt: z.number().int(),
});

export const leasesContractsRenewOrVacateCommand = defineCommand<
  typeof renewOrVacateInputSchema,
  z.infer<typeof renewOrVacateOutputSchema>,
  ShacD1Database
>({
  id: 'leases.contracts.renew_or_vacate',
  moduleId: 'leases',
  method: 'POST',
  path: '/api/leases/contracts/renew-or-vacate',
  summary:
    'Issue a lease renewal_offer or record a tenant vacate_notice on an active lease',
  requiredPermission: 'leases.contracts.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Create a renewal_offer record or attach a vacate_notice to an existing scoped lease',
  },
  inputSchema: renewOrVacateInputSchema,
  outputSchema: renewOrVacateOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'leases.contracts.renew_or_vacate',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      renewOrVacateOutputSchema,
    );
    if (replay) return replay;

    const existing = await assertLeaseInScope(ctx, input.leaseId);
    const nowSec = Math.floor(Date.now() / 1000);

    if (input.action === 'renewal_offer') {
      if (input.newEndDate <= input.newStartDate) {
        throw new AppError(
          'VALIDATION_ERROR',
          400,
          'newEndDate must be strictly greater than newStartDate',
        );
      }
      const offerId = crypto.randomUUID();
      const leaseNumber =
        input.renewalLeaseNumber ?? `${existing.leaseNumber}-REN-${offerId.slice(0, 6)}`;
      const shares = computeSplitRentShares(
        input.newMonthlyRentMinor,
        input.splitRentShares ?? [
          { partyId: existing.primaryPartyId, shareBps: 10_000 },
        ],
      );

      const result: z.infer<typeof renewOrVacateOutputSchema> = {
        id: offerId,
        sourceLeaseId: existing.id,
        tenantId: existing.tenantId,
        orgId: existing.orgId,
        action: 'renewal_offer',
        recordKind: 'renewal_offer',
        status: 'OFFERED',
        monthlyRentMinor: input.newMonthlyRentMinor,
        renewalIncentives: input.renewalIncentives,
        updatedAt: nowSec,
      };
      const responseJson = JSON.stringify(result);

      await ctx.db.batch([
        ctx.db.insert(leaseContractsAndRenewals).values({
          id: offerId,
          tenantId: existing.tenantId,
          orgId: existing.orgId,
          recordKind: 'renewal_offer',
          leaseNumber,
          unitId: existing.unitId,
          primaryPartyId: existing.primaryPartyId,
          occupantsJson: existing.occupantsJson,
          startDate: input.newStartDate,
          endDate: input.newEndDate,
          monthlyRentMinor: input.newMonthlyRentMinor,
          recurringBreakdownJson: existing.recurringBreakdownJson,
          securityDepositEscrowMinor: existing.securityDepositEscrowMinor,
          gracePeriodDays: existing.gracePeriodDays,
          lateFeeMinor: existing.lateFeeMinor,
          autopayEnabled: existing.autopayEnabled,
          autopayDayOfMonth: existing.autopayDayOfMonth,
          splitRentSharesJson: JSON.stringify(shares),
          renewalIncentivesJson: JSON.stringify(input.renewalIncentives),
          vacateNoticeJson: '{}',
          status: 'OFFERED',
          customFields: existing.customFields,
          version: 1,
          createdAt: nowSec,
          updatedAt: nowSec,
        }),
        buildIdempotencyInsert(ctx.db, {
          tenantId: ctx.tenantId,
          orgId: existing.orgId,
          clientMutationId: input.clientMutationId,
          commandId: 'leases.contracts.renew_or_vacate',
          requestHash,
          responseJson,
          nowSec,
        }),
        buildActionLogInsert(ctx.db, {
          tenantId: ctx.tenantId,
          orgId: existing.orgId,
          actor: ctx.actor,
          commandId: 'leases.contracts.renew_or_vacate',
          resourceKind: 'lease_renewal_offer',
          resourceId: offerId,
          targetPartyId: existing.primaryPartyId,
          snapshotAfterJson: responseJson,
          nowSec,
        }),
      ]);

      return result;
    }

    const vacateNotice = {
      intendedMoveOut: input.intendedMoveOut,
      forwardingAddress: input.forwardingAddress,
      moveInOutInspectionR2Key: input.moveInOutInspectionR2Key ?? null,
    };

    const result: z.infer<typeof renewOrVacateOutputSchema> = {
      id: existing.id,
      sourceLeaseId: existing.id,
      tenantId: existing.tenantId,
      orgId: existing.orgId,
      action: 'vacate_notice',
      recordKind: existing.recordKind,
      status: 'VACATE_NOTICE',
      vacateNotice,
      updatedAt: nowSec,
    };
    const responseJson = JSON.stringify(result);

    await ctx.db.batch([
      ctx.db
        .update(leaseContractsAndRenewals)
        .set({
          vacateNoticeJson: JSON.stringify(vacateNotice),
          status: 'VACATE_NOTICE',
          version: existing.version + 1,
          updatedAt: nowSec,
        })
        .where(
          and(
            eq(leaseContractsAndRenewals.id, existing.id),
            eq(leaseContractsAndRenewals.tenantId, existing.tenantId),
          ),
        ),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: existing.orgId,
        clientMutationId: input.clientMutationId,
        commandId: 'leases.contracts.renew_or_vacate',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: existing.orgId,
        actor: ctx.actor,
        commandId: 'leases.contracts.renew_or_vacate',
        resourceKind: 'lease_contract',
        resourceId: existing.id,
        targetPartyId: existing.primaryPartyId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return result;
  },
});
