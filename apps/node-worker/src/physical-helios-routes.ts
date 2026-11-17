import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const UpsertDeviceSchema = z.object({
  deviceCode: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  deviceKind: z.enum(['SMART_DOOR_LOCK', 'IP_CAMERA', 'LPR_GATE', 'SMART_LOCKER', 'LAN_SENSOR']).default('SMART_DOOR_LOCK'),
  lockState: z.enum(['LOCKED', 'UNLOCKED']).default('LOCKED'),
  batteryPct: z.number().int().min(0).max(100).default(100),
});

/** Mounts Helios Physical Security Console: Devices/Locks, Video Wall Clips, LPR Gates, Passes, Lockers & Tamper Alerts. */
export function createPhysicalHeliosRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/physical/overview', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'physical', 'physical.passes.read');
      const [devRes, passRes, lprRes, lockerRes, clipRes, tamperRes] = await c.env.DB.batch([
        c.env.DB.prepare(
          `SELECT id, device_code, name, device_kind, battery_pct, lock_state, watchdog_status, last_heartbeat_at
           FROM phy_devices_and_locks WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, pass_kind, holder_name, license_plate, status, valid_until
           FROM phy_access_passes WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, gate_id, license_plate, confidence_bps, decision, occurred_at
           FROM phy_lpr_plate_events WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY occurred_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, bank_code, compartment_code, compartment_size, door_state, occupancy_status
           FROM phy_smart_lockers WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY bank_code, compartment_code LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, camera_device_id, clip_kind, r2_key, sha256_hash, duration_sec, recorded_at, status
           FROM phy_media_clips WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY recorded_at DESC LIMIT 24`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, device_id, alert_kind, severity, description, status, occurred_at
           FROM phy_tamper_alerts WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY occurred_at DESC LIMIT 30`,
        ).bind(auth.actor.tenantId),
      ]);
      return c.json({
        devices: devRes?.results ?? [],
        passes: passRes?.results ?? [],
        lprEvents: lprRes?.results ?? [],
        lockers: lockerRes?.results ?? [],
        clips: clipRes?.results ?? [],
        tamperAlerts: tamperRes?.results ?? [],
      });
    })
    .post('/physical/devices/upsert-or-toggle', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'physical', 'physical.passes.write');
      const parsed = UpsertDeviceSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid device input', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO phy_devices_and_locks
          (id, tenant_id, org_id, device_code, name, device_kind, battery_pct, lock_state, last_heartbeat_at, watchdog_status, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'ONLINE', 1, ?9, ?9)
         ON CONFLICT(tenant_id, device_code) DO UPDATE SET
           lock_state = excluded.lock_state, battery_pct = excluded.battery_pct, last_heartbeat_at = excluded.last_heartbeat_at, updated_at = excluded.updated_at`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.deviceCode.trim().toUpperCase(), d.name.trim(), d.deviceKind, d.batteryPct, d.lockState, nowSec).run();
      return c.json({ ok: true, id, ...d }, 201);
    });
}
