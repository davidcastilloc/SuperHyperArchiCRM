import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  leaseApplications,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import {
  buildPartyScopeQuery,
  buildUnitScopeQuery,
  parseJsonRecord,
  resolveScopedTargetOrg,
  verifyScopedRow,
} from '../lib/scope-helpers.js';

const submitApplicationInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  applicantPartyId: z.string().min(1),
  targetUnitId: z.string().min(1),
  applicationKind: z.enum(['NEW_LEASE', 'UNIT_TRANSFER']).default('NEW_LEASE'),
  desiredMoveIn: z.number().int().positive(),
  termMonths: z.number().int().min(1).max(120).default(12),
  proposedRentMinor: z.number().int().nonnegative(),
  screeningScore: z.number().int().min(0).max(1000).nullable().optional(),
  stepsTimeline: z.array(z.record(z.unknown())).default([]),
  coApplicant: z.record(z.unknown()).default({}),
  petSummary: z.record(z.unknown()).default({}),
  signatureSvg: z.string().max(65_536).nullable().optional(),
  customFields: z.record(z.unknown()).default({}),
});

const applicationOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  applicantPartyId: z.string(),
  targetUnitId: z.string(),
  applicationKind: z.enum(['NEW_LEASE', 'UNIT_TRANSFER']),
  desiredMoveIn: z.number().int(),
  termMonths: z.number().int(),
  proposedRentMinor: z.number().int().nonnegative(),
  screeningScore: z.number().int().nullable(),
  status: z.string(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const leasesApplicationsSubmitCommand = defineCommand<
  typeof submitApplicationInputSchema,
  z.infer<typeof applicationOutputSchema>,
  ShacD1Database
>({
  id: 'leases.applications.submit',
  moduleId: 'leases',
  method: 'POST',
  path: '/api/leases/applications',
  summary: 'Submit a leasing application for a residential or commercial unit',
  requiredPermission: 'leases.applications.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Submit a NEW_LEASE or UNIT_TRANSFER leasing application with integer proposedRentMinor',
  },
  inputSchema: submitApplicationInputSchema,
  outputSchema: applicationOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'leases.applications.submit',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      applicationOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    const [partyRows, unitRows] = await ctx.db.batch([
      buildPartyScopeQuery(ctx.db, input.applicantPartyId),
      buildUnitScopeQuery(ctx.db, input.targetUnitId),
    ]);

    verifyScopedRow(ctx, partyRows[0], 'Applicant party');
    verifyScopedRow(ctx, unitRows[0], 'Target unit');

    const applicationId = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const customFieldsJson = JSON.stringify(input.customFields);

    const created: z.infer<typeof applicationOutputSchema> = {
      id: applicationId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      applicantPartyId: input.applicantPartyId,
      targetUnitId: input.targetUnitId,
      applicationKind: input.applicationKind,
      desiredMoveIn: input.desiredMoveIn,
      termMonths: input.termMonths,
      proposedRentMinor: input.proposedRentMinor,
      screeningScore: input.screeningScore ?? null,
      status: 'SUBMITTED',
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(leaseApplications).values({
        id: applicationId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        applicantPartyId: input.applicantPartyId,
        targetUnitId: input.targetUnitId,
        applicationKind: input.applicationKind,
        desiredMoveIn: input.desiredMoveIn,
        termMonths: input.termMonths,
        proposedRentMinor: input.proposedRentMinor,
        screeningScore: created.screeningScore,
        stepsTimelineJson: JSON.stringify(input.stepsTimeline),
        coApplicantJson: JSON.stringify(input.coApplicant),
        petSummaryJson: JSON.stringify(input.petSummary),
        signatureSvg: input.signatureSvg ?? null,
        status: 'SUBMITTED',
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'leases.applications.submit',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'leases.applications.submit',
        resourceKind: 'lease_application',
        resourceId: applicationId,
        targetPartyId: input.applicantPartyId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});
