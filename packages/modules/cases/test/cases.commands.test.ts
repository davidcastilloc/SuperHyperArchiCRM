import { env } from 'cloudflare:test';
import { legDocketsAndEvents, legMatters, medClinicalNotes, medSupervisionQueue, medTherapyGroupsAndAba } from '@shac/db-d1';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  casesLegalMatterDocketCommand,
  casesMedAbaTrialCommand,
  casesMedSoapNoteCommand,
  modCasesManifest,
} from '../src/index.js';
import { makeCasesCtx, setupCasesD1 } from './test-helpers.js';

describe('@shac/mod-cases commands on workerd', () => {
  beforeAll(async () => {
    await setupCasesD1(env.DB);
  });

  it('exposes modCasesManifest with 3 MCP-enabled commands', () => {
    expect(modCasesManifest.id).toBe('cases');
    expect(modCasesManifest.commands).toHaveLength(3);
    for (const cmd of modCasesManifest.commands) {
      expect(cmd.moduleId).toBe('cases');
      expect(cmd.mcp?.expose).toBe(true);
    }
  });

  it('creates a SOAP note, queues supervision, and co-signs in med_supervision_queue', async () => {
    const { ctx } = makeCasesCtx(env.DB);

    const created = await casesMedSoapNoteCommand.handler(ctx, {
      clientMutationId: 'soap-create-1',
      patientPartyId: 'patient_1',
      authorStaffId: 'staff_assoc_1',
      supervisorStaffId: 'staff_sup_1',
      noteFormat: 'SOAP',
      subjective: 'Patient reports improved sleep.',
      objective: 'Alert and oriented x3.',
      assessment: 'GAD in partial remission.',
      plan: 'Continue weekly CBT.',
      icd10Codes: ['F41.1'],
      cptCodes: ['90837'],
      flagged: false,
      isConfidential: false,
      visibleToGuardian: true,
      customFields: {},
    });

    expect(created.status).toBe('PENDING_COSIGN');
    expect(created.isLocked).toBe(false);
    expect(created.supervisionQueueId).toBeTruthy();
    expect(created.supervisionStatus).toBe('pending');

    const replay = await casesMedSoapNoteCommand.handler(ctx, {
      clientMutationId: 'soap-create-1',
      patientPartyId: 'patient_1',
      authorStaffId: 'staff_assoc_1',
      supervisorStaffId: 'staff_sup_1',
      noteFormat: 'SOAP',
      subjective: 'Patient reports improved sleep.',
      objective: 'Alert and oriented x3.',
      assessment: 'GAD in partial remission.',
      plan: 'Continue weekly CBT.',
      icd10Codes: ['F41.1'],
      cptCodes: ['90837'],
      flagged: false,
      isConfidential: false,
      visibleToGuardian: true,
      customFields: {},
    });
    expect(replay.id).toBe(created.id);

    const cosigned = await casesMedSoapNoteCommand.handler(ctx, {
      clientMutationId: 'soap-cosign-1',
      clinicalNoteId: created.id,
      cosignStatus: 'approved',
      supervisorStaffId: 'staff_sup_1',
      feedback: 'Well documented.',
      patientPartyId: 'patient_1',
      noteFormat: 'SOAP',
      icd10Codes: [],
      cptCodes: [],
      flagged: false,
      isConfidential: false,
      visibleToGuardian: true,
      customFields: {},
    });

    expect(cosigned.status).toBe('COSIGNED');
    expect(cosigned.isLocked).toBe(true);
    expect(cosigned.supervisionStatus).toBe('approved');
    expect(cosigned.supervisorCosignedById).toBe('staff_sup_1');

    const [noteRow] = await ctx.db
      .select()
      .from(medClinicalNotes)
      .where(eq(medClinicalNotes.id, created.id));
    expect(noteRow?.status).toBe('COSIGNED');
    expect(noteRow?.isLocked).toBe(true);

    const [supRow] = await ctx.db
      .select()
      .from(medSupervisionQueue)
      .where(eq(medSupervisionQueue.clinicalNoteId, created.id));
    expect(supRow?.status).toBe('approved');
    expect(supRow?.feedback).toBe('Well documented.');
  });

  it('records an ABA trial in med_therapy_groups_and_aba', async () => {
    const { ctx } = makeCasesCtx(env.DB);

    const trial = await casesMedAbaTrialCommand.handler(ctx, {
      clientMutationId: 'aba-trial-1',
      recordKind: 'aba_trial',
      groupOrSessionId: 'sess_aba_1',
      patientPartyId: 'patient_1',
      titleOrBehavior: 'Tacting 3D shapes',
      antecedent: 'Therapist holds up cube',
      consequence: 'Verbal praise + token',
      promptLevel: 'gestural',
      isCorrectTrial: true,
      score: 1,
      durationSec: 45,
      payload: { target: 'cube' },
      customFields: {},
    });

    expect(trial.recordKind).toBe('aba_trial');
    expect(trial.isCorrectTrial).toBe(true);

    const [row] = await ctx.db
      .select()
      .from(medTherapyGroupsAndAba)
      .where(eq(medTherapyGroupsAndAba.id, trial.id));
    expect(row?.titleOrBehavior).toBe('Tacting 3D shapes');
    expect(row?.promptLevel).toBe('gestural');
  });

  it('creates a legal matter with linked court docket and enforces idempotency', async () => {
    const { ctx } = makeCasesCtx(env.DB);

    const matter = await casesLegalMatterDocketCommand.handler(ctx, {
      clientMutationId: 'legal-matter-1',
      referenceNumber: 'MAT-2026-001',
      clientPartyId: 'patient_1',
      practiceArea: 'Commercial Litigation',
      title: 'Acme v. Beta Corp',
      billingMode: 'retainer_trust',
      status: 'OPEN',
      docket: {
        caseNumber: '1:26-cv-00412',
        caseTitle: 'Acme Corp v. Beta Corp',
        courtName: 'SDNY',
        judgeName: 'Hon. M. Rivera',
        filingStatus: 'ACTIVE',
        entriesAndDeadlines: [
          {
            entryDate: 1763300000,
            kind: 'filing_deadline',
            summary: 'Answer due',
            fatalDueAt: 1765000000,
          },
        ],
      },
      customFields: {},
    });

    expect(matter.docketId).toBeTruthy();
    expect(matter.caseNumber).toBe('1:26-cv-00412');

    const [matterRow] = await ctx.db
      .select()
      .from(legMatters)
      .where(eq(legMatters.id, matter.id));
    expect(matterRow?.referenceNumber).toBe('MAT-2026-001');

    const [docketRow] = await ctx.db
      .select()
      .from(legDocketsAndEvents)
      .where(eq(legDocketsAndEvents.matterId, matter.id));
    expect(docketRow?.courtName).toBe('SDNY');
  });

  it('enforces 404 on missing records and 403 on cross-tenant / cross-org isolation', async () => {
    const { ctx: eastCtx } = makeCasesCtx(env.DB);
    const { ctx: ten2Ctx } = makeCasesCtx(env.DB, {
      tenantId: 'ten_2',
      orgId: 'org_2',
      orgPath: '/org_2',
    });

    await expect(
      casesMedAbaTrialCommand.handler(eastCtx, {
        clientMutationId: 'missing-party-1',
        recordKind: 'aba_trial',
        patientPartyId: 'non_existent_party',
        titleOrBehavior: 'Test',
        durationSec: 0,
        payload: {},
        customFields: {},
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await expect(
      casesMedAbaTrialCommand.handler(eastCtx, {
        clientMutationId: 'cross-org-1',
        recordKind: 'aba_trial',
        patientPartyId: 'client_west',
        titleOrBehavior: 'Test',
        durationSec: 0,
        payload: {},
        customFields: {},
      }),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      casesLegalMatterDocketCommand.handler(ten2Ctx, {
        clientMutationId: 'cross-tenant-1',
        referenceNumber: 'MAT-2026-X',
        clientPartyId: 'patient_1',
        practiceArea: 'Civil',
        title: 'Cross Tenant',
        billingMode: 'hourly',
        status: 'OPEN',
        customFields: {},
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
