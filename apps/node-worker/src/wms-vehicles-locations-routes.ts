import { createD1Client } from '@shac/db-d1';
import {
  AppError,
  authenticateRequest,
  type AuthenticatedActor,
  type ProfileLoader,
  type TenantMarketProfile,
} from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv, WorkerEnv } from './command-registry.js';

const WmsLocationSchema = z.object({
  locationCode: z.string().min(1).max(48),
  name: z.string().min(1).max(120),
  locationKind: z
    .enum(['warehouse', 'zone', 'bin', 'dock', 'asn', 'internal', 'vendor', 'customer', 'quarantine'])
    .default('internal'),
});

const WmsVehicleSchema = z.object({
  vehicleCode: z.string().min(1).max(48),
  plateNumber: z.string().min(1).max(24),
  driverName: z.string().max(120).optional(),
  isColdChain: z.boolean().default(false),
});

export async function authenticateAnyModule(
  env: WorkerEnv,
  rawHeaders: Headers,
  profileLoader: ProfileLoader,
  allowedModules: readonly string[],
  requiredPermission: string,
): Promise<{ profile: TenantMarketProfile; actor: AuthenticatedActor }> {
  const profile = await profileLoader.load(env.CONFIG_KV);
  if (!allowedModules.some((m) => profile.activeModules.includes(m))) {
    throw new AppError(
      'MODULE_NOT_ENABLED',
      403,
      `None of modules [${allowedModules.join(', ')}] enabled in active market profile`,
    );
  }
  const jwk = env.JWT_PUBLIC_KEY_JWK
    ? (JSON.parse(env.JWT_PUBLIC_KEY_JWK) as JsonWebKey)
    : { kty: 'OKP' };
  const actor = await authenticateRequest(rawHeaders, env.SESSION_KV, jwk);
  const perms = actor.perms;
  const parts = requiredPermission.split('.');
  const allowed =
    perms.includes('*') ||
    perms.includes(requiredPermission) ||
    parts.some((_, idx) => idx > 0 && perms.includes(`${parts.slice(0, idx).join('.')}.*`));
  if (!allowed) {
    throw new AppError('FORBIDDEN', 403, `Missing required permission: ${requiredPermission}`);
  }
  return { profile, actor };
}

export function createD1ContextFromAuth(
  env: WorkerEnv,
  profile: TenantMarketProfile,
  actor: AuthenticatedActor,
  requestId: string,
) {
  return {
    db: createD1Client(env.DB),
    tenantId: actor.tenantId,
    orgId: actor.orgId,
    orgPath: actor.orgPath,
    actor,
    profile,
    requestId,
    now: new Date(),
  };
}

/** Mounts real wms_locations and wms_fleet_and_deliveries (vehicles) endpoints. */
export function createWmsVehiclesLocationsRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/wms/locations', async (c) => {
      const auth = await authenticateAnyModule(
        c.env, c.req.raw.headers, profileLoader, ['wms', 'catalog', 'pos'], 'wms.pickings.read',
      );
      const res = await c.env.DB.prepare(
        `SELECT id, warehouse_id, barcode, complete_name, location_kind, is_active, created_at
         FROM wms_locations WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`,
      ).bind(auth.actor.tenantId).all<{
        id: string;
        warehouse_id: string | null;
        barcode: string | null;
        complete_name: string;
        location_kind: string;
        is_active: number;
        created_at: number;
      }>();
      return c.json({
        items: (res.results ?? []).map((l) => ({
          id: l.id,
          warehouseId: l.warehouse_id ?? 'wh_main',
          code: l.barcode ?? l.id.slice(0, 8),
          name: l.complete_name,
          locationKind: l.location_kind,
          isActive: Boolean(l.is_active),
          createdAt: l.created_at,
        })),
      });
    })
    .post('/wms/locations', async (c) => {
      const auth = await authenticateAnyModule(
        c.env, c.req.raw.headers, profileLoader, ['wms', 'catalog'], 'wms.pickings.write',
      );
      const parsed = WmsLocationSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid WMS location', parsed.error.flatten());
      }
      const d = parsed.data;
      const nowSec = Math.floor(Date.now() / 1000);
      const whRow = await c.env.DB.prepare(
        `SELECT id FROM wms_warehouses_and_zones WHERE tenant_id = ?1 AND org_id = ?2 AND deleted_at IS NULL LIMIT 1`,
      ).bind(auth.actor.tenantId, auth.actor.orgId).first<{ id: string }>();
      let warehouseId = whRow?.id;
      if (!warehouseId) {
        warehouseId = `wh_${crypto.randomUUID().slice(0, 8)}`;
        await c.env.DB.prepare(
          `INSERT INTO wms_warehouses_and_zones (id, tenant_id, org_id, code, name, is_primary, is_active, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'WH-MAIN', 'Bodega Principal', 1, 1, ?4, ?4)`,
        ).bind(warehouseId, auth.actor.tenantId, auth.actor.orgId, nowSec).run();
      }
      const id = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO wms_locations (id, tenant_id, org_id, warehouse_id, complete_name, barcode, location_kind, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)`,
      ).bind(
        id, auth.actor.tenantId, auth.actor.orgId, warehouseId, d.name.trim(), d.locationCode.trim(), d.locationKind, nowSec,
      ).run();
      return c.json({ id, warehouseId, ...d }, 201);
    })
    .get('/wms/vehicles', async (c) => {
      const auth = await authenticateAnyModule(
        c.env, c.req.raw.headers, profileLoader, ['wms', 'catalog'], 'wms.pickings.read',
      );
      const res = await c.env.DB.prepare(
        `SELECT id, vehicle_code, license_plate, is_refrigerated, epod_recipient_name, status, created_at
         FROM wms_fleet_and_deliveries WHERE tenant_id = ?1 AND record_kind = 'vehicle' AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
      ).bind(auth.actor.tenantId).all<{
        id: string;
        vehicle_code: string | null;
        license_plate: string | null;
        is_refrigerated: number;
        epod_recipient_name: string | null;
        status: string;
        created_at: number;
      }>();
      return c.json({
        items: (res.results ?? []).map((v) => ({
          id: v.id,
          vehicleCode: v.vehicle_code ?? v.id,
          plateNumber: v.license_plate ?? '',
          driverName: v.epod_recipient_name ?? '',
          isColdChain: Boolean(v.is_refrigerated),
          status: v.status,
          createdAt: v.created_at,
        })),
      });
    })
    .post('/wms/vehicles', async (c) => {
      const auth = await authenticateAnyModule(
        c.env, c.req.raw.headers, profileLoader, ['wms'], 'wms.pickings.write',
      );
      const parsed = WmsVehicleSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid vehicle payload', parsed.error.flatten());
      }
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO wms_fleet_and_deliveries
          (id, tenant_id, org_id, record_kind, vehicle_code, license_plate, is_refrigerated, epod_recipient_name, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'vehicle', ?4, ?5, ?6, ?7, 'available', ?8, ?8)`,
      ).bind(
        id, auth.actor.tenantId, auth.actor.orgId, d.vehicleCode.trim().toUpperCase(),
        d.plateNumber.trim().toUpperCase(), d.isColdChain ? 1 : 0, d.driverName?.trim() ?? null, nowSec,
      ).run();
      return c.json({ id, ...d }, 201);
    });
}
