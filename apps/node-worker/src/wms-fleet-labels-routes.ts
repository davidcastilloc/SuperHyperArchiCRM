import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const CsvImportSchema = z.object({
  rows: z.array(
    z.object({
      sku: z.string().min(1).max(64),
      name: z.string().min(1).max(160),
      basePriceMinor: z.number().int().nonnegative(),
      primaryCurrency: z.string().length(3).default('USD'),
    }),
  ).min(1).max(50),
});

const CycleCountSchema = z.object({
  warehouseId: z.string().min(1),
  productId: z.string().min(1),
  measuredValue: z.number().int(),
  normMin: z.number().int().default(0),
  status: z.string().min(1).default('completed'),
});

const FleetDispatchSchema = z.object({
  vehicleCode: z.string().min(1).max(40),
  licensePlate: z.string().min(1).max(32),
  orderId: z.string().min(1).max(80),
  epodRecipientName: z.string().max(120).optional(),
  status: z.string().min(1).default('en_route'),
});

const QuickReturnSchema = z.object({
  orderNumber: z.string().min(1).max(80),
  reason: z.string().min(1).max(240),
  refundMinor: z.number().int().nonnegative(),
  currency: z.string().length(3).default('USD'),
});

/** Mounts CSV Bulk Import, Cycle Counts/Adjustments, Fleet ePOD Dispatch, and POS Quick Returns. */
export function createWmsFleetLabelsRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/wms/fleet-and-qc', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'wms', 'wms.inventory.read');
      const [ccRes, fleetRes, retRes] = await c.env.DB.batch([
        c.env.DB.prepare(
          `SELECT id, warehouse_id, product_id, measured_value, norm_min, status, created_at
           FROM wms_qc_and_cycle_counts WHERE tenant_id = ?1 AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 50`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, vehicle_code, license_plate, order_id, epod_recipient_name, status, created_at
           FROM wms_fleet_and_deliveries WHERE tenant_id = ?1 AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 50`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, return_number, original_order_id, refund_currency, refund_amount_minor, physical_status, financial_status, created_at
           FROM com_returns_and_credit_memos WHERE tenant_id = ?1 AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 50`,
        ).bind(auth.actor.tenantId),
      ]);
      return c.json({
        cycleCounts: ccRes?.results ?? [],
        fleetTrips: fleetRes?.results ?? [],
        quickReturns: retRes?.results ?? [],
      });
    })
    .post('/wms/catalog-csv-import', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'catalog', 'catalog.products.write');
      const parsed = CsvImportSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid CSV rows', parsed.error.flatten());
      const nowSec = Math.floor(Date.now() / 1000);
      const stmts = parsed.data.rows.map((row) =>
        c.env.DB.prepare(
          `INSERT INTO cat_products
            (id, tenant_id, org_id, sku, name, base_price_minor, standard_price_minor, primary_currency, is_active, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, 1, ?8, ?8)
           ON CONFLICT(tenant_id, sku) DO UPDATE SET
             name = excluded.name, base_price_minor = excluded.base_price_minor, updated_at = excluded.updated_at, deleted_at = NULL`,
        ).bind(crypto.randomUUID(), auth.actor.tenantId, auth.actor.orgId, row.sku.trim(), row.name.trim(), row.basePriceMinor, row.primaryCurrency, nowSec),
      );
      await c.env.DB.batch(stmts);
      return c.json({ ok: true, importedCount: parsed.data.rows.length }, 201);
    })
    .post('/wms/cycle-counts', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'wms', 'wms.inventory.write');
      const parsed = CycleCountSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid cycle count', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO wms_qc_and_cycle_counts
          (id, tenant_id, org_id, record_kind, warehouse_id, product_id, measured_value, norm_min, status, inspector_user_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'cycle_count', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.warehouseId, d.productId, d.measuredValue, d.normMin, d.status, auth.actor.id || 'usr_system', nowSec).run();
      return c.json({ id, ...d }, 201);
    })
    .post('/wms/fleet-dispatch', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'wms', 'wms.inventory.write');
      const parsed = FleetDispatchSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid fleet dispatch', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO wms_fleet_and_deliveries
          (id, tenant_id, org_id, record_kind, vehicle_code, license_plate, order_id, epod_recipient_name, status, departed_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'delivery_trip', ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?9)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.vehicleCode.trim(), d.licensePlate.trim().toUpperCase(), d.orderId.trim(), d.epodRecipientName ?? null, d.status, nowSec).run();
      return c.json({ id, ...d }, 201);
    })
    .post('/pos/returns-quick', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'pos', 'pos.sales.write');
      const parsed = QuickReturnSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid quick return', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      const returnNo = `RET-${String(nowSec).slice(-6)}`;
      await c.env.DB.prepare(
        `INSERT INTO com_returns_and_credit_memos
          (id, tenant_id, org_id, return_number, original_order_id, return_type, physical_status, financial_status, items_json, refund_currency, refund_amount_minor, authorized_by_user_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pos_quick', 'received', 'refunded', ?6, ?7, ?8, ?9, ?10, ?10)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, returnNo, d.orderNumber.trim(), JSON.stringify([{ reason: d.reason }]), d.currency, d.refundMinor, auth.actor.id || 'usr_system', nowSec).run();
      return c.json({ id, returnNumber: returnNo, ...d }, 201);
    });
}
