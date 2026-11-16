import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import migration0001Sql from '../migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../migrations/0003_phase3_pos_wms_regional.sql?raw';
import migration0004Sql from '../migrations/0004_phase6_spaces_leases.sql?raw';
import migration0005Sql from '../migrations/0005_phase7_services_cases_finance_portal.sql?raw';
import {
  autoBusinessRules,
  autoInboxOps,
  autoWorkflows,
  commThreadsAndMessages,
  createD1Client,
  docAttachments,
  docFormsAndSubmissions,
  evvFieldVisits,
  finChartOfAccountsAndPeriods,
  finJournalEntries,
  finTrustEscrowLedgers,
  iamOrganizations,
  iamTenants,
  kernelAiProposals,
  legDocketsAndEvents,
  legMatters,
  legTimeEntries,
  medClinicalNotes,
  medEncountersAndVitals,
  medSupervisionQueue,
  medTherapyGroupsAndAba,
  srvWarrantyClaimsRma,
  srvWorkOrders,
} from '../src/index.js';

async function applySqlScript(db: D1Database, sqlText: string): Promise<void> {
  const statements = sqlText
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
}

describe('@shac/db-d1 Phase 7 workerd Domains 8-11 schema', () => {
  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await applySqlScript(env.DB, migration0004Sql);
    await applySqlScript(env.DB, migration0005Sql);
  });

  it('creates all 37 Phase 7 tables and merges all 101 schemas into Drizzle client', async () => {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    ).all<{ name: string }>();
    const names = new Set(result.results.map((r) => r.name));
    const expectedTables = [
      'srv_work_orders', 'srv_preventive_schedules', 'srv_warranty_claims_rma',
      'psa_projects_and_tasks', 'evv_field_visits', 'leg_matters',
      'leg_dockets_and_events', 'leg_time_entries', 'med_patient_chart_items',
      'med_encounters_and_vitals', 'med_clinical_notes', 'med_prescriptions_and_erx',
      'med_labs_and_imaging', 'med_referrals_prior_auth_and_hie',
      'med_therapy_groups_and_aba', 'med_supervision_queue', 'med_patient_insurances',
      'med_rcm_claims_and_era', 'fin_trust_escrow_ledgers',
      'fin_chart_of_accounts_and_periods', 'fin_journal_entries',
      'fin_ap_bills_and_expenses', 'fin_bank_reconciliations',
      'fin_fixed_assets_and_budgets', 'doc_attachments', 'doc_collaborative_pages',
      'doc_forms_and_submissions', 'comm_channels', 'comm_threads_and_messages',
      'comm_voice_ai_and_calls', 'comm_notifications', 'auto_business_rules',
      'auto_workflows', 'auto_workflow_instances_and_tasks', 'auto_inbox_ops',
      'kernel_ai_proposals', 'int_webhooks_and_sync_jobs',
    ];
    for (const tbl of expectedTables) {
      expect(names.has(tbl), `missing table ${tbl}`).toBe(true);
    }
    const db = createD1Client(env.DB);
    expect(Object.keys(db.query)).toHaveLength(101);
  });

  it('supports integer-exact inserts across Services, Cases, Finance, Portal & Automation', async () => {
    const db = createD1Client(env.DB);
    const now = 1763500000;
    const base = { tenantId: 'ten_p7', orgId: 'org_p7', createdAt: now, updatedAt: now };

    await db.batch([
      db.insert(iamTenants).values({
        id: 'ten_p7', slug: 'ten-p7', name: 'Phase 7 Tenant', createdAt: now, updatedAt: now,
      }),
      db.insert(iamOrganizations).values({
        id: 'org_p7', tenantId: 'ten_p7', rootId: 'org_p7', treePath: '/org_p7',
        slug: 'hq-p7', name: 'Phase 7 HQ', createdAt: now, updatedAt: now,
      }),
      db.insert(srvWorkOrders).values({
        ...base, id: 'wo_1', ticketNumber: 'WO-1001', laborCostMinor: 15_000, partsCostMinor: 4_500,
      }),
      db.insert(srvWarrantyClaimsRma).values({
        ...base, id: 'rma_1', claimNumber: 'RMA-1001', partyId: 'pty_1', vendorRecoveredMinor: 4_500,
      }),
      db.insert(evvFieldVisits).values({
        ...base, id: 'evv_1', parentRecordId: 'wo_1', staffId: 'stf_1',
        targetLatMicros: 25_761_681, targetLngMicros: -80_191_788,
        clockInLatMicros: 25_761_690, clockInLngMicros: -80_191_780,
        distanceMeters: 2, geofenceCompliant: true, clockInAt: now,
        clientOrCaregiverSignatureSvg: '<svg/>', staffSignatureSvg: '<svg/>',
      }),
      db.insert(legMatters).values({
        ...base, id: 'mat_1', referenceNumber: 'LEG-2026-01', clientPartyId: 'pty_1',
        leadLawyerStaffId: 'stf_law_1', practiceArea: 'Commercial', title: 'Acme v. Beta', openedAt: now,
      }),
      db.insert(legDocketsAndEvents).values({
        ...base, id: 'doc_1', matterId: 'mat_1', caseNumber: '2026-CV-001',
        caseTitle: 'Acme v. Beta', courtName: '11th Circuit',
      }),
      db.insert(legTimeEntries).values({
        ...base, id: 'te_1', matterId: 'mat_1', staffId: 'stf_law_1', entryDate: now,
        durationMinutes: 60, hourlyRateMinor: 35_000, amountMinor: 35_000, description: 'Motion review',
      }),
      db.insert(medEncountersAndVitals).values({
        ...base, id: 'enc_1', patientPartyId: 'pty_pat_1', providerStaffId: 'stf_doc_1', startedAt: now,
      }),
      db.insert(medClinicalNotes).values({
        ...base, id: 'note_1', encounterId: 'enc_1', patientPartyId: 'pty_pat_1',
        authorStaffId: 'stf_doc_1', subjective: 'Follow-up visit',
      }),
      db.insert(medSupervisionQueue).values({
        ...base, id: 'sup_1', associateStaffId: 'stf_doc_1', supervisorStaffId: 'stf_sup_1',
        patientPartyId: 'pty_pat_1', clinicalNoteId: 'note_1', submittedAt: now,
      }),
      db.insert(medTherapyGroupsAndAba).values({
        ...base, id: 'aba_1', patientPartyId: 'pty_pat_1', therapistStaffId: 'stf_doc_1',
        titleOrBehavior: 'Eye contact prompt', isCorrectTrial: true, occurredAt: now,
      }),
      db.insert(finChartOfAccountsAndPeriods).values({
        ...base, id: 'coa_1000', accountCode: '1000', name: 'Operating Cash',
      }),
      db.insert(finTrustEscrowLedgers).values({
        ...base, id: 'trust_1', partyId: 'pty_1', matterOrLeaseId: 'mat_1',
        bankAccountId: 'fin_acc_trust', balanceMinor: 100_000,
      }),
      db.insert(finJournalEntries).values({
        ...base, id: 'je_1', entryNumber: 'JE-0001', entryDate: now, fiscalYear: 2026,
        fiscalPeriod: 11, description: 'Retainer deposit', totalDebitMinor: 100_000,
        totalCreditMinor: 100_000, status: 'posted',
      }),
      db.insert(docAttachments).values({
        ...base, id: 'att_pub', entityType: 'matter', recordId: 'mat_1', fileName: 'public.pdf',
        mimeType: 'application/pdf', r2ObjectKey: 'docs/public.pdf', sha256Hash: 'abc',
        isConfidential: false, uploadedByUserId: 'usr_1',
      }),
      db.insert(docAttachments).values({
        ...base, id: 'att_priv', entityType: 'matter', recordId: 'mat_1', fileName: 'privileged.pdf',
        mimeType: 'application/pdf', r2ObjectKey: 'docs/privileged.pdf', sha256Hash: 'def',
        isConfidential: true, uploadedByUserId: 'usr_1',
      }),
      db.insert(docFormsAndSubmissions).values({ ...base, id: 'form_1', formSlug: 'hipaa-consent' }),
      db.insert(commThreadsAndMessages).values({
        ...base, id: 'msg_1', senderId: 'usr_1', body: 'Portal update', isConfidential: false, sentAt: now,
      }),
      db.insert(autoBusinessRules).values({
        ...base, id: 'rule_1', ruleCode: 'RULE-01', name: 'Auto-assign RMA',
        entityType: 'rma', lifecycleEvent: 'created',
      }),
      db.insert(autoWorkflows).values({ ...base, id: 'wf_1', workflowCode: 'WF-01' }),
      db.insert(autoInboxOps).values({
        ...base, id: 'inbox_1', senderEmailOrHandle: 'client@example.com',
        subject: 'Need RMA', rawBody: 'Device broken',
      }),
      db.insert(kernelAiProposals).values({
        ...base, id: 'prop_1', ownerUserId: 'usr_1', agentId: 'inbox-ops', modelId: 'gemini-4',
        targetCommandId: 'services.rma.claim', confidenceBps: 9_200,
      }),
    ]);

    const publicDocs = await db
      .select()
      .from(docAttachments)
      .where(and(eq(docAttachments.tenantId, 'ten_p7'), eq(docAttachments.isConfidential, false)));
    expect(publicDocs).toHaveLength(1);
    expect(publicDocs[0]?.id).toBe('att_pub');

    const trust = await db
      .select()
      .from(finTrustEscrowLedgers)
      .where(eq(finTrustEscrowLedgers.id, 'trust_1'));
    expect(trust[0]?.balanceMinor).toBe(100_000);
  });

  it('enforces CHECK (balance_minor >= 0) on fin_trust_escrow_ledgers', async () => {
    const db = createD1Client(env.DB);
    const now = 1763500000;
    await expect(
      db.insert(finTrustEscrowLedgers).values({
        id: 'trust_neg', tenantId: 'ten_p7', orgId: 'org_p7', partyId: 'pty_1',
        matterOrLeaseId: 'mat_1', bankAccountId: 'fin_acc_trust', balanceMinor: -1,
        createdAt: now, updatedAt: now,
      }),
    ).rejects.toThrow();
  });
});
