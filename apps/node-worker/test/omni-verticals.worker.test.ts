import { env } from 'cloudflare:test';
import { generateEd25519KeyPair, signJwtEdDsa } from '@shac/kernel';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../packages/db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import migration0004Sql from '../../../packages/db-d1/migrations/0004_phase6_spaces_leases.sql?raw';
import migration0005Sql from '../../../packages/db-d1/migrations/0005_phase7_services_cases_finance_portal.sql?raw';
import migration0006Sql from '../../../packages/db-d1/migrations/0006_phase8_physical_iot.sql?raw';
import { invalidateProfileCache, workerApp, type WorkerEnv } from '../src/router.js';
import { applySqlScript, makeProfile, seedTenantsAndOrgs } from './test-helpers.js';

describe('@shac/node-worker Omni-Vertical SuperCRM routes', () => {
  let publicKeyJwkJson: string;
  let privateKeyJwk: JsonWebKey;
  let tokenTen1: string;

  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await applySqlScript(env.DB, migration0004Sql);
    await applySqlScript(env.DB, migration0005Sql);
    await applySqlScript(env.DB, migration0006Sql);
    await seedTenantsAndOrgs(env.DB);
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(
        makeProfile([
          'core', 'iam', 'customers', 'catalog', 'pos', 'wms',
          'spaces', 'leases', 'services', 'cases', 'finance', 'portal', 'automation', 'physical',
        ]),
      ),
    );
    const keys = await generateEd25519KeyPair();
    privateKeyJwk = keys.privateKeyJwk;
    publicKeyJwkJson = JSON.stringify(keys.publicKeyJwk);
    tokenTen1 = await signJwtEdDsa(
      {
        sub: 'usr_omni_1',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        actorType: 'staff',
        perms: ['*'],
      },
      keys.privateKeyJwk,
      600,
    );
  });

  beforeEach(() => {
    invalidateProfileCache();
  });

  function makeTestEnv(): WorkerEnv {
    return { ...env, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson } as WorkerEnv;
  }

  it('imports CSV products, records cycle counts & fleet dispatch, and logs quick POS returns', async () => {
    const testEnv = makeTestEnv();

    const csvRes = await workerApp.request(
      'http://localhost/api/wms/catalog-csv-import',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          rows: [
            { sku: 'CSV-001', name: 'Termómetro Infrarrojo', basePriceMinor: 2499 },
            { sku: 'CSV-002', name: 'Oxímetro Digital', basePriceMinor: 1850 },
          ],
        }),
      },
      testEnv,
    );
    expect(csvRes.status).toBe(201);
    const csvBody = (await csvRes.json()) as { ok: boolean; importedCount: number };
    expect(csvBody.importedCount).toBe(2);

    const ccRes = await workerApp.request(
      'http://localhost/api/wms/cycle-counts',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          warehouseId: 'wh_main',
          productId: 'CSV-001',
          measuredValue: 48,
          normMin: 50,
          status: 'variance_detected',
        }),
      },
      testEnv,
    );
    expect(ccRes.status).toBe(201);

    const fleetRes = await workerApp.request(
      'http://localhost/api/wms/fleet-dispatch',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          vehicleCode: 'VAN-04',
          licensePlate: 'AG492KL',
          orderId: 'ORD-2026-101',
          epodRecipientName: 'Farmacia Central',
          status: 'en_route',
        }),
      },
      testEnv,
    );
    expect(fleetRes.status).toBe(201);

    const retRes = await workerApp.request(
      'http://localhost/api/pos/returns-quick',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          orderNumber: 'ORD-2026-101',
          reason: 'Empaque averiado',
          refundMinor: 1850,
          currency: 'USD',
        }),
      },
      testEnv,
    );
    expect(retRes.status).toBe(201);

    const overviewRes = await workerApp.request(
      'http://localhost/api/wms/fleet-and-qc',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(overviewRes.status).toBe(200);
    const overview = (await overviewRes.json()) as {
      cycleCounts: unknown[];
      fleetTrips: unknown[];
      quickReturns: unknown[];
    };
    expect(overview.cycleCounts).toHaveLength(1);
    expect(overview.fleetTrips).toHaveLength(1);
    expect(overview.quickReturns).toHaveLength(1);
  });

  it('creates Clinical EHR encounter with AI Scribe SOAP, eRx prescription, and RCM claim scrubber', async () => {
    const testEnv = makeTestEnv();

    const encRes = await workerApp.request(
      'http://localhost/api/clinical/encounters',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          patientPartyId: 'pty_pat_1',
          chiefComplaint: 'Cefalea tensional y control hipertensivo',
          vitals: { bpSystolic: 145, bpDiastolic: 92, heartRate: 88, tempC: 37.1, spo2Pct: 98 },
          dictationText: 'Paciente refiere cefalea frontal de 48h. Se indica paracetamol y control en 7 días.',
        }),
      },
      testEnv,
    );
    expect(encRes.status).toBe(201);
    const encBody = (await encRes.json()) as { encounterId: string; noteId: string; soap: { assessment: string } };
    expect(encBody.encounterId).toBeTruthy();
    expect(encBody.noteId).toBeTruthy();
    expect(encBody.soap.assessment.length).toBeGreaterThan(0);

    const rxRes = await workerApp.request(
      'http://localhost/api/clinical/prescriptions',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          patientPartyId: 'pty_pat_1',
          medicationName: 'Paracetamol 500mg',
          dosage: '1 tableta',
          sigInstructions: 'Cada 8 horas por 5 días',
        }),
      },
      testEnv,
    );
    expect(rxRes.status).toBe(201);

    const rcmRes = await workerApp.request(
      'http://localhost/api/clinical/labs-and-rcm',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'rcm_claim',
          patientPartyId: 'pty_pat_1',
          titleOrModality: 'Consulta Medicina Interna',
          totalChargeMinor: 12000,
          insurerPaidMinor: 9000,
          diagnosisCodes: [],
        }),
      },
      testEnv,
    );
    expect(rcmRes.status).toBe(201);
    const rcmBody = (await rcmRes.json()) as { patientResponsibilityMinor: number; scrubberWarnings: string[] };
    expect(rcmBody.patientResponsibilityMinor).toBe(3000);
    expect(rcmBody.scrubberWarnings.length).toBeGreaterThan(0);

    const ovRes = await workerApp.request(
      'http://localhost/api/clinical/overview',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(ovRes.status).toBe(200);
    const ov = (await ovRes.json()) as { encounters: unknown[]; notes: unknown[]; prescriptions: unknown[]; rcmClaims: unknown[] };
    expect(ov.encounters).toHaveLength(1);
    expect(ov.prescriptions).toHaveLength(1);
    expect(ov.rcmClaims).toHaveLength(1);
  });

  it('logs billable legal time entries, runs AI contract & conflict review, and fetches legal overview', async () => {
    const testEnv = makeTestEnv();

    const timeRes = await workerApp.request(
      'http://localhost/api/legal/time-entries',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          matterId: 'mat_001',
          durationMinutes: 90,
          hourlyRateMinor: 20000,
          description: 'Redacción de contrato marco de suministro',
        }),
      },
      testEnv,
    );
    expect(timeRes.status).toBe(201);
    const timeBody = (await timeRes.json()) as { amountMinor: number };
    expect(timeBody.amountMinor).toBe(30000);

    const reviewRes = await workerApp.request(
      'http://localhost/api/legal/ai-contract-review',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          opposingPartyName: 'Inversiones Norte S.A.',
          contractText: 'Cláusula de penalidad unilateral del 50% y renuncia de jurisdicción sin arbitraje.',
        }),
      },
      testEnv,
    );
    expect(reviewRes.status).toBe(200);
    const reviewBody = (await reviewRes.json()) as { riskScore: number; flaggedClauses: string[]; conflictsFound: unknown[] };
    expect(reviewBody.riskScore).toBeGreaterThan(0);
    expect(reviewBody.flaggedClauses.length).toBeGreaterThan(0);

    const ovRes = await workerApp.request(
      'http://localhost/api/legal/overview',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(ovRes.status).toBe(200);
    const ov = (await ovRes.json()) as { timeEntries: unknown[] };
    expect(ov.timeEntries).toHaveLength(1);
  });

  it('transitions hospitality housekeeping room states and manages condo hub items + votes', async () => {
    const testEnv = makeTestEnv();

    const hkRes = await workerApp.request(
      'http://localhost/api/hospitality/housekeeping',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          unitId: 'room_101',
          taskKind: 'CHECKOUT_CLEANING',
          targetUnitStatus: 'CLEAN',
          priority: 'HIGH',
        }),
      },
      testEnv,
    );
    expect(hkRes.status).toBe(201);

    const condoRes = await workerApp.request(
      'http://localhost/api/condo/hub-items',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          itemKind: 'community_poll',
          title: 'Horario de piscina fines de semana',
          details: { options: ['Hasta 9pm', 'Hasta 11pm'], votes: [0, 0] },
        }),
      },
      testEnv,
    );
    expect(condoRes.status).toBe(201);
    const createdPoll = (await condoRes.json()) as { id: string };

    const voteRes = await workerApp.request(
      `http://localhost/api/condo/hub-items/${createdPoll.id}/vote`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({ optionIndex: 1 }),
      },
      testEnv,
    );
    expect(voteRes.status).toBe(200);
    const voteBody = (await voteRes.json()) as { votes: number[] };
    expect(voteBody.votes[1]).toBe(1);

    const hospOv = await workerApp.request(
      'http://localhost/api/hospitality/overview',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(hospOv.status).toBe(200);
    const condoOv = await workerApp.request(
      'http://localhost/api/condo/overview',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(condoOv.status).toBe(200);
  });

  it('registers physical IoT devices, toggles lock states, and returns Helios security overview', async () => {
    const testEnv = makeTestEnv();

    const devRes = await workerApp.request(
      'http://localhost/api/physical/devices/upsert-or-toggle',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          deviceCode: 'LOCK-GARITA-01',
          name: 'Cerradura Portón Principal',
          deviceKind: 'SMART_DOOR_LOCK',
          lockState: 'UNLOCKED',
          batteryPct: 92,
        }),
      },
      testEnv,
    );
    expect(devRes.status).toBe(201);
    const devBody = (await devRes.json()) as { ok: boolean; lockState: string };
    expect(devBody.lockState).toBe('UNLOCKED');

    const ovRes = await workerApp.request(
      'http://localhost/api/physical/overview',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(ovRes.status).toBe(200);
    const ov = (await ovRes.json()) as { devices: Array<{ device_code: string; lock_state: string }> };
    expect(ov.devices).toHaveLength(1);
    expect(ov.devices[0]?.lock_state).toBe('UNLOCKED');
  });

  it('manages GAAP Chart of Accounts, AP Vendor Bills, and Bank Reconciliations with exact integer balances', async () => {
    const testEnv = makeTestEnv();

    const coaRes = await workerApp.request(
      'http://localhost/api/finance/coa',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          accountCode: '1100-AR-TRADE',
          name: 'Cuentas por Cobrar Comerciales',
          classification: 'asset',
          normalBalance: 'debit',
          currentBalanceMinor: 450000,
        }),
      },
      testEnv,
    );
    expect(coaRes.status).toBe(201);

    const billRes = await workerApp.request(
      'http://localhost/api/finance/ap-bills',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          billOrExpenseNo: 'BILL-2026-088',
          category: 'INVENTORY_SUPPLY',
          totalMinor: 125000,
          paidMinor: 25000,
          currency: 'USD',
        }),
      },
      testEnv,
    );
    expect(billRes.status).toBe(201);
    const billBody = (await billRes.json()) as { balanceDueMinor: number; status: string };
    expect(billBody.balanceDueMinor).toBe(100000);
    expect(billBody.status).toBe('PARTIAL');

    const reconRes = await workerApp.request(
      'http://localhost/api/finance/reconciliations',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          financialAccountId: 'acc_usd_main',
          statementBalanceMinor: 890000,
          bookBalanceMinor: 890000,
        }),
      },
      testEnv,
    );
    expect(reconRes.status).toBe(201);
    const reconBody = (await reconRes.json()) as { differenceMinor: number; status: string };
    expect(reconBody.differenceMinor).toBe(0);
    expect(reconBody.status).toBe('RECONCILED');

    const ovRes = await workerApp.request(
      'http://localhost/api/finance/overview',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(ovRes.status).toBe(200);
    const ov = (await ovRes.json()) as {
      accounts: unknown[];
      apBills: unknown[];
      reconciliations: unknown[];
    };
    expect(ov.accounts.length).toBeGreaterThanOrEqual(1);
    expect(ov.apBills).toHaveLength(1);
    expect(ov.reconciliations).toHaveLength(1);
  });

  it('manages Legal e-Discovery Bates holds, AI briefs, citations, and attorney Bar/CLE ethics renewals', async () => {
    const testEnv = makeTestEnv();

    const holdRes = await workerApp.request(
      'http://localhost/api/legal/ediscovery-hold',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          matterId: 'EXP-2026-01',
          title: 'Correos Junta Directiva Q3',
          custodian: 'Carlos Mendoza (CFO)',
          privilegeTag: 'PRIVILEGED',
          snippetText: 'Acuerdo confidencial de precios y exclusividad territorial.',
        }),
      },
      testEnv,
    );
    expect(holdRes.status).toBe(201);
    const holdBody = (await holdRes.json()) as { batesNumber: string; sha256Hash: string };
    expect(holdBody.batesNumber).toMatch(/^BATES-2026-/);
    expect(holdBody.sha256Hash).toHaveLength(64);

    const briefRes = await workerApp.request(
      'http://localhost/api/legal/ai-brief',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          matterId: 'EXP-2026-01',
          title: 'Escrito de Medidas Cautelares',
          courtName: 'Juzgado Superior Mercantil',
          keyArguments: 'Fumus boni iuris y periculum in mora por incumplimiento de entrega.',
        }),
      },
      testEnv,
    );
    expect(briefRes.status).toBe(201);
    const briefBody = (await briefRes.json()) as { id: string; draftedBrief: string };
    expect(briefBody.draftedBrief.toUpperCase()).toContain('JUZGADO SUPERIOR MERCANTIL');

    const ethRes = await workerApp.request(
      'http://localhost/api/legal/citations-and-ethics',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          recordKind: 'ethics_license',
          title: 'Dra. Elena Santander · Inpreabogado #94821',
          jurisdiction: 'Nacional / Sala Civil',
          statusTag: 'COMPLIANT',
          cleCompletedHours: 24,
          cleRequiredHours: 20,
        }),
      },
      testEnv,
    );
    expect(ethRes.status).toBe(201);

    const listRes = await workerApp.request(
      'http://localhost/api/legal/ediscovery-ethics',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      ediscoveryHolds: unknown[];
      briefs: unknown[];
      ethicsAndCitations: unknown[];
    };
    expect(listBody.ediscoveryHolds).toHaveLength(1);
    expect(listBody.briefs).toHaveLength(1);
    expect(listBody.ethicsAndCitations).toHaveLength(1);
  });

  it('serves wms_locations, wms vehicles, B2B orders/quotes, and AI copilot under distro-wms preset', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify({
        deploymentId: 'dep_distro',
        tenantId: 'ten_1',
        editionPreset: 'distro-wms',
        regionPack: 've',
        activeModules: ['core', 'iam', 'customers', 'catalog', 'wms', 'regional', 'finance', 'portal', 'services'],
        vocabulary: {
          partySingular: 'Cuenta Mayorista',
          partyPlural: 'Cuentas Mayoristas',
          orderSingular: 'Orden de Despacho',
          branchSingular: 'CEDI',
          spaceSingular: 'Andén',
          caseSingular: 'RMA',
        },
        currency: {
          baseCurrency: 'USD',
          operatingCurrencies: ['USD', 'VES'],
          rateSource: 'bcv',
          enforceAccountCurrencyMatch: true,
        },
        entitlements: {
          maxBranches: 5,
          maxPosRegisters: 4,
          maxSpacesOrUnits: 50,
          aiCopilotEnabled: true,
          customEntitiesLimit: 20,
        },
        federation: {
          enabled: false,
          nodeDid: 'did:shac:node:dep_distro',
          publishPublicCatalog: false,
          acceptPeerB2BOrders: false,
          consolidateLowStockHours: 24,
          allowedSupplierDids: [],
        },
        updatedAt: new Date().toISOString(),
      }),
    );
    invalidateProfileCache();
    const testEnv = makeTestEnv();

    const createLoc = await workerApp.request(
      'http://localhost/api/wms/locations',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({ locationCode: 'BIN-A1-01', name: 'Pasillo A Estante 1', locationKind: 'internal' }),
      },
      testEnv,
    );
    expect(createLoc.status).toBe(201);

    const listLocs = await workerApp.request(
      'http://localhost/api/wms/locations',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(listLocs.status).toBe(200);
    const locsJson = (await listLocs.json()) as { items: Array<{ code: string }> };
    expect(locsJson.items.some((l) => l.code === 'BIN-A1-01')).toBe(true);

    const createVeh = await workerApp.request(
      'http://localhost/api/wms/vehicles',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({ vehicleCode: 'VEH-FRIO-1', plateNumber: 'AB123CD', driverName: 'Carlos', isColdChain: true }),
      },
      testEnv,
    );
    expect(createVeh.status).toBe(201);

    const quoteRes = await workerApp.request(
      'http://localhost/api/pos/quotes',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({ currency: 'USD', totalMinor: 25000 }),
      },
      testEnv,
    );
    expect(quoteRes.status).toBe(201);

    const ordersRes = await workerApp.request(
      'http://localhost/api/pos/orders',
      { method: 'GET', headers: { authorization: `Bearer ${tokenTen1}` } },
      testEnv,
    );
    expect(ordersRes.status).toBe(200);

    const aiRes = await workerApp.request(
      'http://localhost/api/automation/ai-chat',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenTen1}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'Resumen de inventario' }),
      },
      testEnv,
    );
    expect(aiRes.status).toBe(200);
  });

  it('saves AI Scribe SOAP notes as DRAFT, parses JSON cleanly, signs via /notes/:id/sign, and isolates orgPath', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['core', 'iam', 'customers', 'cases', 'services', 'finance', 'portal', 'automation'])),
    );
    invalidateProfileCache();
    const aiMockEnv = {
      ...makeTestEnv(),
      AI: {
        async run() {
          return {
            response: JSON.stringify({
              subjective: 'Cefalea frontal de 48h',
              objective: 'PA 120/80 mmHg',
              assessment: 'Migraña sin aura',
              plan: 'Sumatriptán 50mg PRN',
              icd10: ['G43.0'],
            }),
          };
        },
      },
    } as unknown as WorkerEnv;

    const tokenOrg2 = await signJwtEdDsa(
      { sub: 'usr_doc_2', tenantId: 'ten_1', orgId: 'org_2', orgPath: '/org_1/org_2', actorType: 'staff', perms: ['*'] },
      privateKeyJwk as never,
      600,
    );
    const tokenOrg3 = await signJwtEdDsa(
      { sub: 'usr_doc_3', tenantId: 'ten_1', orgId: 'org_3', orgPath: '/org_1/org_3', actorType: 'staff', perms: ['*'] },
      privateKeyJwk as never,
      600,
    );

    const encRes = await workerApp.request(
      'http://localhost/api/clinical/encounters',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenOrg2}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          patientPartyId: 'pty_pat_org2',
          chiefComplaint: 'Cefalea intensa',
          vitals: { bpSystolic: 120, bpDiastolic: 80, heartRate: 72 },
          dictationText: 'Paciente refiere cefalea frontal',
        }),
      },
      aiMockEnv,
    );
    expect(encRes.status).toBe(201);
    const encBody = (await encRes.json()) as { noteId: string; soap: { assessment: string } };
    expect(encBody.soap.assessment).toBe('Migraña sin aura');
    expect(encBody.soap.assessment).not.toContain('{');

    const org3Overview = await workerApp.request(
      'http://localhost/api/clinical/overview',
      { method: 'GET', headers: { authorization: `Bearer ${tokenOrg3}` } },
      aiMockEnv,
    );
    expect(org3Overview.status).toBe(200);
    const org3Data = (await org3Overview.json()) as { notes: Array<{ id: string; status: string }> };
    expect(org3Data.notes.some((n) => n.id === encBody.noteId)).toBe(false);

    const org2Overview = await workerApp.request(
      'http://localhost/api/clinical/overview',
      { method: 'GET', headers: { authorization: `Bearer ${tokenOrg2}` } },
      aiMockEnv,
    );
    const org2Data = (await org2Overview.json()) as { notes: Array<{ id: string; status: string }> };
    expect(org2Data.notes.find((n) => n.id === encBody.noteId)?.status).toBe('DRAFT');

    const signRes = await workerApp.request(
      `http://localhost/api/clinical/notes/${encBody.noteId}/sign`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenOrg2}`, 'content-type': 'application/json' },
        body: JSON.stringify({ assessment: 'Migraña sin aura confirmada' }),
      },
      aiMockEnv,
    );
    expect(signRes.status).toBe(200);
    const signBody = (await signRes.json()) as { status: string };
    expect(signBody.status).toBe('SIGNED');
  });
});
