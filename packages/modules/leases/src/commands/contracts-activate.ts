import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  leaseContractsAndRenewals,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import {
  buildPartyScopeQuery,
  buildUnitScopeQuery,
  parseJsonRecord,
  resolveScopedTargetOrg,
  verifyScopedRow,
} from '../lib/scope-helpers.js';
import { computeSplitRentShares } from '../split-rent.js';

const splitRentInputItemSchema = z.object({
  partyId: z.string().min(1),
  shareBps: z.number().int().min(0).max(10_000),
  label: z.string().max(80).optional(),
});

const splitRentAllocatedItemSchema = splitRentInputItemSchema.extend({
  amountMinor: z.number().int().nonnegative(),
});

const activateContractInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  leaseNumber: z.string().min(1).max(64),
  unitId: z.string().min(1),
  primaryPartyId: z.string().min(1),
  occupants: z.array(z.record(z.unknown())).default([]),
  startDate: z.number().int().positive(),
  endDate: z.number().int().positive(),
  monthlyRentMinor: z.number().int().nonnegative(),
  recurringBreakdown: z.record(z.number().int().nonnegative()).default({}),
  securityDepositEscrowMinor: z.number().int().nonnegative().default(0),
  gracePeriodDays: z.number().int().min(0).max(60).default(5),
  lateFeeMinor: z.number().int().nonnegative().default(0),
  autopayEnabled: z.boolean().default(false),
  autopayDayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  splitRentShares: z.array(splitRentInputItemSchema).optional(),
  electronicSignatureSvg: z.string().max(65_536).nullable().optional(),
  customFields: z.record(z.unknown()).default({}),
});

const contractOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  recordKind: z.string(),
  leaseNumber: z.string(),
  unitId: z.string(),
  primaryPartyId: z.string(),
  startDate: z.number().int(),
  endDate: z.number().int(),
  monthlyRentMinor: z.number().int().nonnegative(),
  securityDepositEscrowMinor: z.number().int().nonnegative(),
  gracePeriodDays: z.number().int().nonnegative(),
  lateFeeMinor: z.number().int().nonnegative(),
  autopayEnabled: z.boolean(),
  autopayDayOfMonth: z.number().int().nullable(),
  splitRentShares: z.array(splitRentAllocatedItemSchema),
  status: z.string(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const leasesContractsActivateCommand = defineCommand<
  typeof activateContractInputSchema,
  z.infer<typeof contractOutputSchema>,
  ShacD1Database
>({
  id: 'leases.contracts.activate',
  moduleId: 'leases',
  method: 'POST',
  path: '/api/leases/contracts/activate',
  summary:
    'Activate a lease contract with security deposit escrow, Autopay, and exact BigInt Split Rent shares',
  requiredPermission: 'leases.contracts.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Activate an active_lease contract in D1 with escrow, Autopay, and Split Rent shares summing to 10000 bps',
  },
  inputSchema: activateContractInputSchema,
  outputSchema: contractOutputSchema,
  async handler(ctx, input) {
    if (input.endDate <= input.startDate) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'endDate must be strictly greater than startDate',
      );
    }

    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'leases.contracts.activate',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      contractOutputSchema,
    );
    if (replay) return replay;

    const allocatedShares = computeSplitRentShares(
      input.monthlyRentMinor,
      input.splitRentShares ?? [
        { partyId: input.primaryPartyId, shareBps: 10_000 },
      ],
    );

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    const [partyRows, unitRows] = await ctx.db.batch([
      buildPartyScopeQuery(ctx.db, input.primaryPartyId),
      buildUnitScopeQuery(ctx.db, input.unitId),
    ]);

    verifyScopedRow(ctx, partyRows[0], 'Primary party');
    verifyScopedRow(ctx, unitRows[0], 'Unit');

    const leaseId = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const customFieldsJson = JSON.stringify(input.customFields);
    const splitRentSharesJson = JSON.stringify(allocatedShares);
    const autopayDay = input.autopayEnabled
      ? (input.autopayDayOfMonth ?? 1)
      : (input.autopayDayOfMonth ?? null);

    const created: z.infer<typeof contractOutputSchema> = {
      id: leaseId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      recordKind: 'active_lease',
      leaseNumber: input.leaseNumber,
      unitId: input.unitId,
      primaryPartyId: input.primaryPartyId,
      startDate: input.startDate,
      endDate: input.endDate,
      monthlyRentMinor: input.monthlyRentMinor,
      securityDepositEscrowMinor: input.securityDepositEscrowMinor,
      gracePeriodDays: input.gracePeriodDays,
      lateFeeMinor: input.lateFeeMinor,
      autopayEnabled: input.autopayEnabled,
      autopayDayOfMonth: autopayDay,
      splitRentShares: allocatedShares,
      status: 'ACTIVE',
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(leaseContractsAndRenewals).values({
        id: leaseId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        recordKind: 'active_lease',
        leaseNumber: input.leaseNumber,
        unitId: input.unitId,
        primaryPartyId: input.primaryPartyId,
        occupantsJson: JSON.stringify(input.occupants),
        startDate: input.startDate,
        endDate: input.endDate,
        monthlyRentMinor: input.monthlyRentMinor,
        recurringBreakdownJson: JSON.stringify(input.recurringBreakdown),
        securityDepositEscrowMinor: input.securityDepositEscrowMinor,
        gracePeriodDays: input.gracePeriodDays,
        lateFeeMinor: input.lateFeeMinor,
        autopayEnabled: input.autopayEnabled,
        autopayDayOfMonth: autopayDay,
        splitRentSharesJson,
        renewalIncentivesJson: '{}',
        vacateNoticeJson: '{}',
        electronicSignatureSvg: input.electronicSignatureSvg ?? null,
        status: 'ACTIVE',
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'leases.contracts.activate',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'leases.contracts.activate',
        resourceKind: 'lease_contract',
        resourceId: leaseId,
        targetPartyId: input.primaryPartyId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});
