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
});
