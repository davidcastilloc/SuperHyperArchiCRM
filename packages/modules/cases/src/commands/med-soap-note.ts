import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  medClinicalNotes,
  medSupervisionQueue,
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
import { cosignSoapNote } from '../lib/soap-cosign.js';

const soapNoteInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  clinicalNoteId: z.string().min(1).optional(),
  cosignStatus: z.enum(['approved', 'changes_requested']).optional(),
  supervisorStaffId: z.string().min(1).optional(),
  feedback: z.string().max(4000).optional(),
  flagged: z.boolean().default(false),
  flagReason: z.string().max(500).optional(),
  encounterId: z.string().min(1).optional(),
  patientPartyId: z.string().min(1),
  authorStaffId: z.string().min(1).optional(),
  noteFormat: z
    .enum(['SOAP', 'STEPPED', 'VISUAL_BODY_MAP', 'DAP_THERAPY', 'PROCEDURE', 'DISCHARGE'])
    .default('SOAP'),
  specialty: z.string().max(120).nullable().optional(),
  subjective: z.string().max(16_000).optional(),
  objective: z.string().max(16_000).optional(),
  assessment: z.string().max(16_000).optional(),
  plan: z.string().max(16_000).optional(),
  icd10Codes: z.array(z.string().min(1)).default([]),
  cptCodes: z.array(z.string().min(1)).default([]),
  isConfidential: z.boolean().default(false),
  visibleToGuardian: z.boolean().default(true),
  customFields: z.record(z.unknown()).default({}),
});

const soapNoteOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  encounterId: z.string(),
  patientPartyId: z.string(),
  authorStaffId: z.string(),
  noteFormat: z.string(),
  status: z.string(),
  isLocked: z.boolean(),
  supervisionQueueId: z.string().nullable(),
  supervisionStatus: z.string().nullable(),
  supervisorCosignedById: z.string().nullable(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
});

export const casesMedSoapNoteCommand = defineCommand<
  typeof soapNoteInputSchema,
  z.infer<typeof soapNoteOutputSchema>,
  ShacD1Database
>({
  id: 'cases.med.soap_note',
  moduleId: 'cases',
  method: 'POST',
  path: '/api/cases/med/soap-notes',
  summary: 'Create a clinical SOAP note and optionally queue or record supervisor co-sign',
  requiredPermission: 'cases.med.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Create a clinical SOAP note in med_clinical_notes and queue or co-sign in med_supervision_queue',
  },
  inputSchema: soapNoteInputSchema,
  outputSchema: soapNoteOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'cases.med.soap_note',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      soapNoteOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);
    const nowSec = Math.floor(Date.now() / 1000);

    if (input.clinicalNoteId && input.cosignStatus) {
      return cosignSoapNote(ctx, {
        targetOrgId,
        clinicalNoteId: input.clinicalNoteId,
        cosignStatus: input.cosignStatus,
        supervisorStaffId: input.supervisorStaffId,
        feedback: input.feedback,
        clientMutationId: input.clientMutationId,
        requestHash,
        nowSec,
      });
    }

    const partyRows = await buildPartyScopeQuery(ctx.db, input.patientPartyId);
    verifyScopedRow(ctx, partyRows[0], 'Patient party');

    const noteId = crypto.randomUUID();
    const encounterId = input.encounterId ?? `enc_${crypto.randomUUID()}`;
    const authorStaffId = input.authorStaffId ?? ctx.actor.id;
    const customFieldsJson = JSON.stringify(input.customFields);
    const needsCosign = Boolean(input.supervisorStaffId);
    const supervisionQueueId = needsCosign ? crypto.randomUUID() : null;
    const status = needsCosign ? 'PENDING_COSIGN' : 'SIGNED';

    const created: z.infer<typeof soapNoteOutputSchema> = {
      id: noteId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      encounterId,
      patientPartyId: input.patientPartyId,
      authorStaffId,
      noteFormat: input.noteFormat,
      status,
      isLocked: !needsCosign,
      supervisionQueueId,
      supervisionStatus: needsCosign ? 'pending' : null,
      supervisorCosignedById: null,
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
    };
    const responseJson = JSON.stringify(created);

    const statements: [
      Parameters<ShacD1Database['batch']>[0][number],
      ...Parameters<ShacD1Database['batch']>[0][number][],
    ] = [
      ctx.db.insert(medClinicalNotes).values({
        id: noteId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        encounterId,
        patientPartyId: input.patientPartyId,
        authorStaffId,
        noteFormat: input.noteFormat,
        specialty: input.specialty ?? null,
        subjective: input.subjective ?? null,
        objective: input.objective ?? null,
        assessment: input.assessment ?? null,
        plan: input.plan ?? null,
        icd10CodesJson: JSON.stringify(input.icd10Codes),
        cptCodesJson: JSON.stringify(input.cptCodes),
        isConfidential: input.isConfidential,
        visibleToGuardian: input.visibleToGuardian,
        isLocked: !needsCosign,
        signedByStaffId: authorStaffId,
        signedAt: nowSec,
        status,
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'cases.med.soap_note',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'cases.med.soap_note',
        resourceKind: 'med_clinical_note',
        resourceId: noteId,
        targetPartyId: input.patientPartyId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ];

    if (supervisionQueueId && input.supervisorStaffId) {
      statements.push(
        ctx.db.insert(medSupervisionQueue).values({
          id: supervisionQueueId,
          tenantId: ctx.tenantId,
          orgId: targetOrgId,
          associateStaffId: authorStaffId,
          supervisorStaffId: input.supervisorStaffId,
          patientPartyId: input.patientPartyId,
          clinicalNoteId: noteId,
          flagged: input.flagged,
          flagReason: input.flagReason ?? null,
          status: 'pending',
          submittedAt: nowSec,
          customFields: '{}',
          version: 1,
          createdAt: nowSec,
          updatedAt: nowSec,
        }),
      );
    }

    await ctx.db.batch(statements);
    return created;
  },
});
