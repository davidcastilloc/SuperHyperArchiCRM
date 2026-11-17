import { env } from 'cloudflare:test';
import { wrapD1WithCounter } from '@shac/db-d1';
import { generateEd25519KeyPair, signJwtEdDsa } from '@shac/kernel';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sql0001 from '../../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import sql0002 from '../../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import sql0003 from '../../../../packages/db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import sql0004 from '../../../../packages/db-d1/migrations/0004_phase6_spaces_leases.sql?raw';
import sql0005 from '../../../../packages/db-d1/migrations/0005_phase7_services_cases_finance_portal.sql?raw';
import { invalidateProfileCache, workerApp, type WorkerEnv } from '../router.js';
import { callMcpTool, callWorkerJson, mockCtx } from '../../test/phase3-helpers.js';
import { seedPhase7Fixture, SVG_SIG } from '../../test/phase7-helpers.js';
import { applySqlScript, makeProfile, seedTenantsAndOrgs } from '../../test/test-helpers.js';

describe('@shac/node-worker Phase 7 workerd integration (services, cases, finance, portal, automation, mcp)', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let publicKeyJwkJson: string;
  let tokenTen1: string;

  beforeAll(async () => {
    await applySqlScript(env.DB, sql0001);
    await applySqlScript(env.DB, sql0002);
    await applySqlScript(env.DB, sql0003);
    await applySqlScript(env.DB, sql0004);
    await applySqlScript(env.DB, sql0005);
    await seedTenantsAndOrgs(env.DB);
    await seedPhase7Fixture(env.DB, nowSec);

    const keys = await generateEd25519KeyPair();
    publicKeyJwkJson = JSON.stringify(keys.publicKeyJwk);
    tokenTen1 = await signJwtEdDsa(
      {
        sub: 'usr_p7_1',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        actorType: 'staff',
        perms: ['iam.*', 'services.*', 'cases.*', 'finance.*', 'portal.*', 'automation.*'],
      },
      keys.privateKeyJwk,
      600,
    );
  });

  beforeEach(() => {
    invalidateProfileCache();
  });

  it('enforces 403 MODULE_NOT_ENABLED for Phase 7 modules without touching D1', async () => {
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['iam'])));
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = { ...env, DB: counted.db, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    const res = await callWorkerJson<{ error: { code: string } }>(
      workerApp,
      testEnv,
      '/api/portal/records',
      tokenTen1,
    );
    expect(res.status).toBe(403);
    expect(res.data.error.code).toBe('MODULE_NOT_ENABLED');
    expect(counted.getQueryCount()).toBe(0);
  });

  it('runs services, cases (SOAP co-sign), finance (Trust 422 overdraft & GAAP), portal (is_confidential=0), and automation (rules + proposal card)', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam', 'services', 'cases', 'finance', 'portal', 'automation'])),
    );
    const testEnv: WorkerEnv = { ...env, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    const wo = await callWorkerJson<{ id: string; status: string }>(
      workerApp,
      testEnv,
      '/api/services/work-orders',
      tokenTen1,
      { clientMutationId: 'p7-wo-1', partyId: 'pty_p7_1', initialDiagnosis: 'Pantalla rota' },
    );
    expect(wo.status).toBe(200);
    expect(wo.data.status).toBe('OPEN');

    const rma = await callWorkerJson<{ id: string; status: string }>(
      workerApp,
      testEnv,
      '/api/services/rma',
      tokenTen1,
      { clientMutationId: 'p7-rma-1', partyId: 'pty_p7_1', originalOrderId: wo.data.id },
    );
    expect(rma.status).toBe(200);
    expect(rma.data.status).toBe('REQUESTED');

    const evv = await callWorkerJson<{ geofenceCompliant: boolean }>(
      workerApp,
      testEnv,
      '/api/services/evv',
      tokenTen1,
      {
        clientMutationId: 'p7-evv-1',
        parentRecordId: wo.data.id,
        partyId: 'pty_p7_1',
        staffId: 'usr_p7_1',
        targetLatMicros: 10_480_600,
        targetLngMicros: -66_903_600,
        clockInLatMicros: 10_480_700,
        clockInLngMicros: -66_903_600,
        clockInAt: nowSec,
        clientOrCaregiverSignatureSvg: SVG_SIG,
        staffSignatureSvg: SVG_SIG,
      },
    );
    expect(evv.status).toBe(200);
    expect(evv.data.geofenceCompliant).toBe(true);

    const soapCreate = await callWorkerJson<{ id: string; status: string }>(
      workerApp,
      testEnv,
      '/api/cases/med/soap-notes',
      tokenTen1,
      { clientMutationId: 'p7-soap-1', patientPartyId: 'pty_p7_1', subjective: 'Dolor leve', flagged: true },
    );
    expect(soapCreate.status).toBe(200);

    const soapCosign = await callWorkerJson<{ supervisionStatus: string | null }>(
      workerApp,
      testEnv,
      '/api/cases/med/soap-notes',
      tokenTen1,
      {
        clientMutationId: 'p7-soap-2',
        patientPartyId: 'pty_p7_1',
        clinicalNoteId: soapCreate.data.id,
        cosignStatus: 'approved',
      },
    );
    expect(soapCosign.status).toBe(200);
    expect(soapCosign.data.supervisionStatus).toBe('approved');

    const aba = await callWorkerJson<{ id: string }>(
      workerApp,
      testEnv,
      '/api/cases/med/aba-trials',
      tokenTen1,
      { clientMutationId: 'p7-aba-1', patientPartyId: 'pty_p7_1', titleOrBehavior: 'Contacto visual', isCorrectTrial: true },
    );
    expect(aba.status).toBe(200);

    const matter = await callWorkerJson<{ referenceNumber: string }>(
      workerApp,
      testEnv,
      '/api/cases/legal/matters',
      tokenTen1,
      {
        clientMutationId: 'p7-mat-1',
        referenceNumber: 'MAT-P7-001',
        clientPartyId: 'pty_p7_1',
        practiceArea: 'civil',
        title: 'Contrato arrendamiento',
      },
    );
    expect(matter.status).toBe(200);
    expect(matter.data.referenceNumber).toBe('MAT-P7-001');

    const deposit = await callWorkerJson<{ ledgerId: string; balanceMinor: number }>(
      workerApp,
      testEnv,
      '/api/finance/trust/transact',
      tokenTen1,
      {
        clientMutationId: 'p7-tr-1',
        partyId: 'pty_p7_1',
        matterOrLeaseId: 'mat_p7_1',
        bankAccountId: 'bank_iolta_1',
        txKind: 'DEPOSIT',
        amountMinor: 50_000,
        description: 'Retainer inicial',
      },
    );
    expect(deposit.status).toBe(200);
    expect(deposit.data.balanceMinor).toBe(50_000);

    const overdraft = await callWorkerJson<{ error: { code: string } }>(
      workerApp,
      testEnv,
      '/api/finance/trust/transact',
      tokenTen1,
      {
        clientMutationId: 'p7-tr-2',
        ledgerId: deposit.data.ledgerId,
        txKind: 'DISBURSEMENT',
        amountMinor: 80_000,
        description: 'Sobregiro prohibido',
      },
    );
    expect(overdraft.status).toBe(422);
    expect(overdraft.data.error.code).toBe('TRUST_OVERDRAFT_BLOCKED');

    const journal = await callWorkerJson<{ status: string }>(
      workerApp,
      testEnv,
      '/api/finance/journal/post',
      tokenTen1,
      {
        clientMutationId: 'p7-je-1',
        entryNumber: 'JE-P7-001',
        entryDate: nowSec,
        fiscalYear: 2026,
        fiscalPeriod: 11,
        description: 'Asiento Trust',
        lines: [
          { accountCode: '1010', debitMinor: 50_000, creditMinor: 0 },
          { accountCode: '2010', debitMinor: 0, creditMinor: 50_000 },
        ],
      },
    );
    expect(journal.status).toBe(200);
    expect(journal.data.status).toBe('posted');

    const portal = await callWorkerJson<{
      attachments: Array<{ id: string; isConfidential: boolean }>;
      messages: Array<{ id: string; isConfidential: boolean }>;
    }>(workerApp, testEnv, '/api/portal/records?partyId=pty_p7_1', tokenTen1);
    expect(portal.status).toBe(200);
    expect(portal.data.attachments.map((a) => a.id)).toEqual(['att_p7_pub']);
    expect(portal.data.messages.map((m) => m.id)).toEqual(['msg_p7_pub']);

    const evalRes = await callWorkerJson<{ matchedRules: Array<{ ruleCode: string }> }>(
      workerApp,
      testEnv,
      '/api/automation/rules/evaluate',
      tokenTen1,
      { entityType: 'work_order', lifecycleEvent: 'on_create', payload: { priority: 'URGENT' } },
    );
    expect(evalRes.status).toBe(200);
    expect(evalRes.data.matchedRules.map((r) => r.ruleCode)).toContain('WO_URGENT_NOTIFY');

    const proposal = await callWorkerJson<{ disposition: string; executionStatus: string }>(
      workerApp,
      testEnv,
      '/api/automation/proposals/decide',
      tokenTen1,
      { clientMutationId: 'p7-prop-1', proposalId: 'prop_p7_1', decision: 'APPROVED', humanConfirmed: true },
    );
    expect(proposal.status).toBe(200);
    expect(proposal.data.executionStatus).toBe('EXECUTED');
  });

  it('exposes Phase 7 tools over /mcp and executes portal.records.list with is_confidential = 0', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam', 'services', 'cases', 'finance', 'portal', 'automation'])),
    );
    const testEnv: WorkerEnv = { ...env, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    const listReq = new Request('https://worker.test/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenTen1}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const listRes = await workerApp.fetch(listReq, testEnv, mockCtx);
    expect(listRes.status).toBe(200);
    const listText = await listRes.text();
    for (const toolName of [
      'services.work_orders.upsert',
      'cases.med.soap_note',
      'finance.trust.transact',
      'portal.records.list',
      'automation.proposals.decide',
    ]) {
      expect(listText).toContain(toolName);
    }

    const mcpPortal = await callMcpTool<{
      attachments: Array<{ id: string }>;
      messages: Array<{ id: string }>;
    }>(workerApp, testEnv, tokenTen1, 'portal.records.list', { partyId: 'pty_p7_1' }, 2);
    expect(mcpPortal.attachments.map((a) => a.id)).toEqual(['att_p7_pub']);
    expect(mcpPortal.messages.map((m) => m.id)).toEqual(['msg_p7_pub']);
  });

  it('atomically updates COA current_balance_minor on journal post and persists AP vendorPartyId + dueAt', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['core', 'iam', 'customers', 'finance'])),
    );
    invalidateProfileCache();
    const testEnv: WorkerEnv = { ...env, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    await callWorkerJson(workerApp, testEnv, '/api/finance/coa', tokenTen1, {
      accountCode: '1010-CASH',
      name: 'Caja General',
      classification: 'asset',
      normalBalance: 'debit',
    });
    await callWorkerJson(workerApp, testEnv, '/api/finance/coa', tokenTen1, {
      accountCode: '4010-REV',
      name: 'Ingresos Operativos',
      classification: 'revenue',
      normalBalance: 'credit',
    });

    const jeRes = await callWorkerJson<{ status: string }>(
      workerApp,
      testEnv,
      '/api/finance/journal/post',
      tokenTen1,
      {
        clientMutationId: 'p7-je-coa-1',
        entryNumber: 'JE-COA-001',
        entryDate: Math.floor(Date.now() / 1000),
        fiscalYear: 2026,
        fiscalPeriod: 11,
        description: 'Venta al contado',
        lines: [
          { accountCode: '1010-CASH', debitMinor: 25_000, creditMinor: 0 },
          { accountCode: '4010-REV', debitMinor: 0, creditMinor: 25_000 },
        ],
      },
    );
    expect(jeRes.status).toBe(200);

    const dueAt = Math.floor(Date.now() / 1000) + 86_400 * 15;
    const apRes = await callWorkerJson<{ id: string }>(
      workerApp,
      testEnv,
      '/api/finance/ap-bills',
      tokenTen1,
      {
        billOrExpenseNo: 'AP-VENDOR-01',
        vendorPartyId: 'pty_p7_1',
        dueAt,
        category: 'SUPPLIES',
        totalMinor: 10_000,
        paidMinor: 0,
        currency: 'USD',
      },
    );
    expect(apRes.status).toBe(201);

    const ov = await callWorkerJson<{
      accounts: Array<{ account_code: string; current_balance_minor: number }>;
      apBills: Array<{ bill_or_expense_no: string; vendor_party_id: string | null; due_date: number | null; vendorName: string | null }>;
      trialBalanceTotals: { totalDebitMinor: number; totalCreditMinor: number; balanced: boolean };
    }>(workerApp, testEnv, '/api/finance/overview', tokenTen1);
    expect(ov.status).toBe(200);
    expect(ov.data.accounts.find((a) => a.account_code === '1010-CASH')?.current_balance_minor).toBe(25_000);
    expect(ov.data.accounts.find((a) => a.account_code === '4010-REV')?.current_balance_minor).toBe(25_000);
    expect(ov.data.trialBalanceTotals.balanced).toBe(true);
    const apRow = ov.data.apBills.find((b) => b.bill_or_expense_no === 'AP-VENDOR-01');
    expect(apRow?.vendor_party_id).toBe('pty_p7_1');
    expect(apRow?.due_date).toBe(dueAt);
  });
});
