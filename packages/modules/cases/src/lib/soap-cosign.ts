import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  iamOrganizations,
  medClinicalNotes,
  medSupervisionQueue,
  type ShacD1Database,
} from '@shac/db-d1';
import {
  AppError,
  computeAuditEntryHashHex,
  GENESIS_AUDIT_HASH,
  type ExecutionContext,
} from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import { parseJsonRecord, verifyScopedRow } from './scope-helpers.js';

export interface SoapNoteOutput {
  id: string;
  tenantId: string;
  orgId: string;
  encounterId: string;
  patientPartyId: string;
  authorStaffId: string;
  noteFormat: string;
  status: string;
  isLocked: boolean;
  supervisionQueueId: string | null;
  supervisionStatus: string | null;
  supervisorCosignedById: string | null;
  customFields: Record<string, unknown>;
  createdAt: number;
}

export async function cosignSoapNote(
  ctx: ExecutionContext<ShacD1Database>,
  params: {
    targetOrgId: string;
    clinicalNoteId: string;
    cosignStatus: 'approved' | 'changes_requested';
    supervisorStaffId?: string;
    feedback?: string;
    clientMutationId: string;
    requestHash: string;
    nowSec: number;
  },
): Promise<SoapNoteOutput> {
  const existingNotes = await ctx.db
    .select({
      id: medClinicalNotes.id,
      tenantId: medClinicalNotes.tenantId,
      orgId: medClinicalNotes.orgId,
      encounterId: medClinicalNotes.encounterId,
      patientPartyId: medClinicalNotes.patientPartyId,
      authorStaffId: medClinicalNotes.authorStaffId,
      noteFormat: medClinicalNotes.noteFormat,
      customFields: medClinicalNotes.customFields,
      createdAt: medClinicalNotes.createdAt,
      orgTreePath: iamOrganizations.treePath,
    })
    .from(medClinicalNotes)
    .leftJoin(
      iamOrganizations,
      and(
        eq(medClinicalNotes.orgId, iamOrganizations.id),
        eq(medClinicalNotes.tenantId, iamOrganizations.tenantId),
        isNull(iamOrganizations.deletedAt),
      ),
    )
    .where(
      and(
        eq(medClinicalNotes.id, params.clinicalNoteId),
        isNull(medClinicalNotes.deletedAt),
      ),
    )
    .limit(1);

  const note = existingNotes[0];
  verifyScopedRow(ctx, note, 'Clinical note');
  if (!note) {
    throw new AppError('NOT_FOUND', 404, 'Clinical note not found');
  }

  const supervisorId = params.supervisorStaffId ?? ctx.actor.id;
  const isApproved = params.cosignStatus === 'approved';
  const nextNoteStatus = isApproved ? 'COSIGNED' : 'CHANGES_REQUESTED';

  const result: SoapNoteOutput = {
    id: note.id,
    tenantId: note.tenantId,
    orgId: note.orgId,
    encounterId: note.encounterId,
    patientPartyId: note.patientPartyId,
    authorStaffId: note.authorStaffId,
    noteFormat: note.noteFormat,
    status: nextNoteStatus,
    isLocked: isApproved,
    supervisionQueueId: null,
    supervisionStatus: params.cosignStatus,
    supervisorCosignedById: supervisorId,
    customFields: parseJsonRecord(note.customFields),
    createdAt: note.createdAt,
  };
  const responseJson = JSON.stringify(result);
  await computeAuditEntryHashHex({
    orgId: params.targetOrgId,
    streamKey: 'clinical:soap',
    seqNo: params.nowSec,
    actorId: supervisorId,
    action: nextNoteStatus,
    targetId: note.id,
    occurredAtMs: params.nowSec * 1000,
    prevHashHex: GENESIS_AUDIT_HASH,
    payload: result,
  });

  await ctx.db.batch([
    ctx.db
      .update(medClinicalNotes)
      .set({
        supervisorCosignedById: supervisorId,
        cosignedAt: params.nowSec,
        isLocked: isApproved,
        status: nextNoteStatus,
        updatedAt: params.nowSec,
      })
      .where(
        and(
          eq(medClinicalNotes.id, note.id),
          eq(medClinicalNotes.tenantId, note.tenantId),
        ),
      ),
    ctx.db
      .update(medSupervisionQueue)
      .set({
        supervisorStaffId: supervisorId,
        status: params.cosignStatus,
        feedback: params.feedback ?? null,
        reviewedAt: params.nowSec,
        updatedAt: params.nowSec,
      })
      .where(
        and(
          eq(medSupervisionQueue.clinicalNoteId, note.id),
          eq(medSupervisionQueue.tenantId, note.tenantId),
        ),
      ),
    buildIdempotencyInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: params.targetOrgId,
      clientMutationId: params.clientMutationId,
      commandId: 'cases.med.soap_note',
      requestHash: params.requestHash,
      responseJson,
      nowSec: params.nowSec,
    }),
    buildActionLogInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: params.targetOrgId,
      actor: ctx.actor,
      commandId: 'cases.med.soap_note',
      resourceKind: 'med_clinical_note',
      resourceId: note.id,
      targetPartyId: note.patientPartyId,
      snapshotAfterJson: responseJson,
      nowSec: params.nowSec,
    }),
  ]);

  return result;
}
