import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  buildNextAuditChainInsert,
  checkIdempotency,
  legDocketsAndEvents,
  legMatters,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import {
  buildPartyScopeQuery,
  parseJsonRecord,
  resolveScopedTargetOrg,
  verifyScopedRow,
} from '../lib/scope-helpers.js';

const docketEntrySchema = z.object({
  entryDate: z.number().int().positive(),
  kind: z.enum(['hearing', 'filing_deadline', 'ruling']),
  summary: z.string().min(1).max(2000),
  fatalDueAt: z.number().int().positive().nullable().optional(),
});

const legalMatterDocketInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  referenceNumber: z.string().min(1).max(120),
  clientPartyId: z.string().min(1),
  leadLawyerStaffId: z.string().min(1).optional(),
  practiceArea: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  billingMode: z
    .enum(['hourly', 'flat_fee', 'contingency', 'retainer_trust'])
    .default('hourly'),
  conflictCheckId: z.string().min(1).nullable().optional(),
  openedAt: z.number().int().positive().optional(),
  status: z.enum(['OPEN', 'PENDING', 'CLOSED', 'ARCHIVED']).default('OPEN'),
  docket: z
    .object({
      caseNumber: z.string().min(1).max(120),
      caseTitle: z.string().min(1).max(300),
      courtName: z.string().min(1).max(200),
      judgeName: z.string().max(200).nullable().optional(),
      filingStatus: z.string().min(1).max(80).default('ACTIVE'),
      entriesAndDeadlines: z.array(docketEntrySchema).default([]),
    })
    .optional(),
  customFields: z.record(z.unknown()).default({}),
});

const legalMatterDocketOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  referenceNumber: z.string(),
  clientPartyId: z.string(),
  leadLawyerStaffId: z.string(),
  practiceArea: z.string(),
  title: z.string(),
  billingMode: z.string(),
  status: z.string(),
  docketId: z.string().nullable(),
  caseNumber: z.string().nullable(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const casesLegalMatterDocketCommand = defineCommand<
  typeof legalMatterDocketInputSchema,
  z.infer<typeof legalMatterDocketOutputSchema>,
  ShacD1Database
>({
  id: 'cases.legal.matter_docket',
  moduleId: 'cases',
  method: 'POST',
  path: '/api/cases/legal/matters',
  summary: 'Open a legal matter and optionally attach a court docket and deadline entries',
  requiredPermission: 'cases.legal.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Create a legal matter in leg_matters and optionally attach a court docket in leg_dockets_and_events',
  },
  inputSchema: legalMatterDocketInputSchema,
  outputSchema: legalMatterDocketOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'cases.legal.matter_docket',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      legalMatterDocketOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);
    const partyRows = await buildPartyScopeQuery(ctx.db, input.clientPartyId);
    verifyScopedRow(ctx, partyRows[0], 'Client party');

    const matterId = crypto.randomUUID();
    const docketId = input.docket ? crypto.randomUUID() : null;
    const nowSec = Math.floor(Date.now() / 1000);
    const openedAt = input.openedAt ?? nowSec;
    const leadLawyerStaffId = input.leadLawyerStaffId ?? ctx.actor.id;
    const customFieldsJson = JSON.stringify(input.customFields);

    const created: z.infer<typeof legalMatterDocketOutputSchema> = {
      id: matterId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      referenceNumber: input.referenceNumber,
      clientPartyId: input.clientPartyId,
      leadLawyerStaffId,
      practiceArea: input.practiceArea,
      title: input.title,
      billingMode: input.billingMode,
      status: input.status,
      docketId,
      caseNumber: input.docket?.caseNumber ?? null,
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };
    const responseJson = JSON.stringify(created);

    const statements: [
      Parameters<ShacD1Database['batch']>[0][number],
      ...Parameters<ShacD1Database['batch']>[0][number][],
    ] = [
      ctx.db.insert(legMatters).values({
        id: matterId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        referenceNumber: input.referenceNumber,
        clientPartyId: input.clientPartyId,
        leadLawyerStaffId,
        practiceArea: input.practiceArea,
        title: input.title,
        description: input.description ?? null,
        billingMode: input.billingMode,
        conflictCheckId: input.conflictCheckId ?? null,
        openedAt,
        status: input.status,
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'cases.legal.matter_docket',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'cases.legal.matter_docket',
        resourceKind: 'leg_matter',
        resourceId: matterId,
        targetPartyId: input.clientPartyId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ];

    if (docketId && input.docket) {
      statements.push(
        ctx.db.insert(legDocketsAndEvents).values({
          id: docketId,
          tenantId: ctx.tenantId,
          orgId: targetOrgId,
          matterId,
          caseNumber: input.docket.caseNumber,
          caseTitle: input.docket.caseTitle,
          courtName: input.docket.courtName,
          judgeName: input.docket.judgeName ?? null,
          filingStatus: input.docket.filingStatus,
          entriesAndDeadlinesJson: JSON.stringify(input.docket.entriesAndDeadlines),
          customFields: '{}',
          version: 1,
          createdAt: nowSec,
          updatedAt: nowSec,
        }),
      );
    }

    const auditChainStmt = await buildNextAuditChainInsert(ctx.db, {
      orgId: targetOrgId,
      streamKey: 'legal:docket',
      actorId: ctx.actor.id,
      action: 'LEGAL_MATTER_DOCKET',
      targetId: matterId,
      occurredAtMs: nowSec * 1000,
      payload: created,
    });
    if (auditChainStmt) {
      statements.push(auditChainStmt.stmt);
    }

    await ctx.db.batch(statements);
    return created;
  },
});
