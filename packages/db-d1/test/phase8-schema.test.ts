import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import migration0001Sql from '../migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../migrations/0003_phase3_pos_wms_regional.sql?raw';
import migration0004Sql from '../migrations/0004_phase6_spaces_leases.sql?raw';
import migration0005Sql from '../migrations/0005_phase7_services_cases_finance_portal.sql?raw';
import migration0006Sql from '../migrations/0006_phase8_physical_iot.sql?raw';
import {
  createD1Client,
  iamOrganizations,
  iamTenants,
  phyAccessPasses,
  phyDevicesAndLocks,
  phyLockerReservations,
  phyLprGates,
  phyLprPlateEvents,
  phyMediaClips,
  phySmartLockers,
  phyTamperAlerts,
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

describe('@shac/db-d1 Phase 8 workerd Domain 12 Physical IoT & LPR schema', () => {
  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await applySqlScript(env.DB, migration0004Sql);
    await applySqlScript(env.DB, migration0005Sql);
    await applySqlScript(env.DB, migration0006Sql);
  });

  it('creates all 8 Phase 8 tables and merges all 109 schemas into Drizzle client', async () => {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    ).all<{ name: string }>();
    const names = new Set(result.results.map((r) => r.name));
    const expectedTables = [
      'phy_devices_and_locks',
      'phy_access_passes',
      'phy_smart_lockers',
      'phy_locker_reservations',
      'phy_lpr_gates',
      'phy_lpr_plate_events',
      'phy_media_clips',
      'phy_tamper_alerts',
    ];

    for (const tbl of expectedTables) {
      expect(names.has(tbl), `missing table ${tbl}`).toBe(true);
    }

    const db = createD1Client(env.DB);
    expect(Object.keys(db.query).length).toBeGreaterThanOrEqual(109);
  });

  it('supports inserts and reads across all 8 Domain 12 tables', async () => {
    const db = createD1Client(env.DB);
    const now = 1763400000;
    const base = { tenantId: 'ten_p8', orgId: 'org_p8', createdAt: now, updatedAt: now };

    await db.batch([
      db.insert(iamTenants).values({
        id: 'ten_p8',
        slug: 'ten-p8',
        name: 'Phase 8 Tenant',
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(iamOrganizations).values({
        id: 'org_p8',
        tenantId: 'ten_p8',
        rootId: 'org_p8',
        treePath: '/org_p8',
        slug: 'physical-hq',
        name: 'Physical IoT HQ',
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(phyDevicesAndLocks).values({
        ...base,
        id: 'dev_lock_1',
        unitId: 'unit_101',
        deviceCode: 'LOCK-101',
        name: 'Suite 101 Smart Lock',
        deviceKind: 'SMART_DOOR_LOCK',
        vendorDriver: 'smartlock_cloud',
        batteryPct: 92,
        lockState: 'LOCKED',
        dualPathMode: true,
      }),
      db.insert(phyAccessPasses).values({
        ...base,
        id: 'pass_1',
        unitId: 'unit_101',
        passKind: 'VISITOR_TEMP',
        holderName: 'Carlos Mendoza',
        licensePlate: 'P884XYZ',
        pinOrQrHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        allowedDeviceIdsJson: '["dev_lock_1"]',
        validFrom: now,
        validUntil: now + 86400,
      }),
      db.insert(phySmartLockers).values({
        ...base,
        id: 'lkr_1',
        deviceId: 'dev_lock_1',
        bankCode: 'LOBBY-A',
        compartmentCode: 'A-01',
        compartmentSize: 'LARGE',
        occupancyStatus: 'RESERVED',
      }),
      db.insert(phyLockerReservations).values({
        ...base,
        id: 'lres_1',
        lockerId: 'lkr_1',
        unitId: 'unit_101',
        carrierName: 'FedEx',
        trackingNumber: 'FDX-998877',
        pickupQrOrPinHash: 'a1b2c3d4e5f6',
        reservedFrom: now,
        expiresAt: now + 172800,
        status: 'READY_FOR_PICKUP',
      }),
      db.insert(phyLprGates).values({
        ...base,
        id: 'gate_north',
        gateCode: 'GATE-N1',
        name: 'North LPR Barrier',
        laneDirection: 'ENTRY',
        whitelistMode: 'STRICT',
        notifyChannel: 'whatsapp',
        notifyTarget: '+15550101',
      }),
      db.insert(phyLprPlateEvents).values({
        ...base,
        id: 'lpr_evt_1',
        gateId: 'gate_north',
        passId: 'pass_1',
        licensePlate: 'P884XYZ',
        confidenceBps: 9850,
        decision: 'ALLOWED',
        latencyMs: 9,
        doormanNotified: true,
        occurredAt: now,
      }),
      db.insert(phyMediaClips).values({
        ...base,
        id: 'clip_1',
        cameraDeviceId: 'cam_north',
        linkedEventId: 'lpr_evt_1',
        clipKind: 'LPR_CAPTURE',
        r2Key: 'clips/ten_p8/2026/11/16/clip_1.mp4',
        sha256Hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        durationSec: 15,
        sizeBytes: 1048576,
        recordedAt: now,
      }),
      db.insert(phyTamperAlerts).values({
        ...base,
        id: 'tamper_1',
        deviceId: 'dev_lock_1',
        alertKind: 'ENCLOSURE_OPEN',
        severity: 'CRITICAL',
        description: 'Rear tamper switch triggered on LOCK-101',
        evidenceClipId: 'clip_1',
        occurredAt: now,
      }),
    ]);

    const [device] = await db
      .select()
      .from(phyDevicesAndLocks)
      .where(and(eq(phyDevicesAndLocks.tenantId, 'ten_p8'), eq(phyDevicesAndLocks.id, 'dev_lock_1')));
    expect(device?.dualPathMode).toBe(true);
    expect(device?.batteryPct).toBe(92);

    const [pass] = await db
      .select()
      .from(phyAccessPasses)
      .where(eq(phyAccessPasses.id, 'pass_1'));
    expect(pass?.licensePlate).toBe('P884XYZ');

    const [locker] = await db
      .select()
      .from(phySmartLockers)
      .where(eq(phySmartLockers.id, 'lkr_1'));
    expect(locker?.compartmentCode).toBe('A-01');

    const [res] = await db
      .select()
      .from(phyLockerReservations)
      .where(eq(phyLockerReservations.id, 'lres_1'));
    expect(res?.status).toBe('READY_FOR_PICKUP');

    const [gate] = await db
      .select()
      .from(phyLprGates)
      .where(eq(phyLprGates.id, 'gate_north'));
    expect(gate?.notifyChannel).toBe('whatsapp');

    const [plateEvt] = await db
      .select()
      .from(phyLprPlateEvents)
      .where(eq(phyLprPlateEvents.id, 'lpr_evt_1'));
    expect(plateEvt?.latencyMs).toBe(9);
    expect(plateEvt?.doormanNotified).toBe(true);

    const [clip] = await db
      .select()
      .from(phyMediaClips)
      .where(eq(phyMediaClips.id, 'clip_1'));
    expect(clip?.durationSec).toBe(15);

    const [tamper] = await db
      .select()
      .from(phyTamperAlerts)
      .where(eq(phyTamperAlerts.id, 'tamper_1'));
    expect(tamper?.severity).toBe('CRITICAL');
  });
});
