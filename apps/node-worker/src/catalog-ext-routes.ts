import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';
import { authenticateAnyModule, createWmsVehiclesLocationsRoutes } from './wms-vehicles-locations-routes.js';

const CategorySchema = z.object({
  kind: z.enum(['product_category', 'dictionary', 'brand']).default('product_category'),
  code: z.string().min(1).max(48),
  name: z.string().min(1).max(120),
});

const VariantSchema = z.object({
  productId: z.string().min(1),
  sku: z.string().min(1).max(64),
  presentationName: z.string().min(1).max(80).default('UNIDAD'),
  barcode: z.string().max(64).optional(),
  overridePriceMinor: z.number().int().nonnegative().optional(),
});

const PromotionSchema = z.object({
  name: z.string().min(1).max(120),
  couponCode: z.string().min(2).max(40),
  discountBps: z.number().int().min(1).max(10_000).default(1000),
  maxUses: z.number().int().positive().default(100),
});

const QuoteSchema = z.object({
  partyId: z.string().optional(),
  totalMinor: z.number().int().positive(),
  currency: z.string().default('USD'),
});

/** Mounts Categories, Variants, Promotions/Coupons, Quotes, and WMS Locations/Vehicles routes. */
export function createCatalogExtRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/catalog/categories', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'catalog', 'catalog.products.read');
      const res = await c.env.DB.prepare(
        `SELECT id, kind, code, name, is_active, created_at FROM cat_categories_and_dictionaries
         WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY sort_order ASC, created_at DESC LIMIT 100`,
      ).bind(auth.actor.tenantId).all<{ id: string; kind: string; code: string; name: string; is_active: number; created_at: number }>();
      return c.json({ items: (res.results ?? []).map((r) => ({ id: r.id, kind: r.kind, code: r.code, name: r.name, isActive: Boolean(r.is_active), createdAt: r.created_at })) });
    })
    .post('/catalog/categories', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'catalog', 'catalog.products.write');
      const parsed = CategorySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid category', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO cat_categories_and_dictionaries (id, tenant_id, org_id, kind, code, name, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)
         ON CONFLICT(tenant_id, kind, code) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.kind, d.code.trim(), d.name.trim(), nowSec).run();
      return c.json({ id, ...d }, 201);
    })
    .get('/catalog/variants', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'catalog', 'catalog.products.read');
      const res = await c.env.DB.prepare(
        `SELECT id, product_id, sku, barcode, presentation_name, override_price_minor, created_at
         FROM cat_variants_and_presentations WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`,
      ).bind(auth.actor.tenantId).all<{ id: string; product_id: string; sku: string; barcode: string | null; presentation_name: string; override_price_minor: number | null; created_at: number }>();
      return c.json({ items: (res.results ?? []).map((v) => ({ id: v.id, productId: v.product_id, sku: v.sku, barcode: v.barcode, presentationName: v.presentation_name, overridePriceMinor: v.override_price_minor, createdAt: v.created_at })) });
    })
    .post('/catalog/variants', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'catalog', 'catalog.products.write');
      const parsed = VariantSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid variant', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO cat_variants_and_presentations (id, tenant_id, org_id, product_id, sku, barcode, presentation_name, override_price_minor, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.productId, d.sku.trim(), d.barcode ?? null, d.presentationName.trim(), d.overridePriceMinor ?? null, nowSec).run();
      return c.json({ id, ...d }, 201);
    })
    .get('/catalog/promotions', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'catalog', 'catalog.products.read');
      const res = await c.env.DB.prepare(
        `SELECT id, name, coupon_code, benefits_json, max_uses, used_count, is_active, created_at
         FROM cat_promotions_and_coupons WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`,
      ).bind(auth.actor.tenantId).all<{ id: string; name: string; coupon_code: string | null; benefits_json: string; max_uses: number | null; used_count: number; is_active: number; created_at: number }>();
      return c.json({ items: (res.results ?? []).map((p) => ({ id: p.id, name: p.name, couponCode: p.coupon_code, benefitsJson: p.benefits_json, maxUses: p.max_uses, usedCount: p.used_count, isActive: Boolean(p.is_active), createdAt: p.created_at })) });
    })
    .post('/catalog/promotions', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'catalog', 'catalog.products.write');
      const parsed = PromotionSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid promotion', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO cat_promotions_and_coupons (id, tenant_id, org_id, name, coupon_code, benefits_json, max_uses, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.name.trim(), d.couponCode.trim().toUpperCase(), JSON.stringify({ discountBps: d.discountBps }), d.maxUses, nowSec).run();
      return c.json({ id, ...d }, 201);
    })
    .post('/pos/quotes', async (c) => {
      const auth = await authenticateAnyModule(
        c.env, c.req.raw.headers, profileLoader, ['pos', 'wms', 'catalog'], 'pos.sales.write',
      );
      const parsed = QuoteSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid quote', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      const quoteNo = `QT-${String(nowSec).slice(-6)}`;
      await c.env.DB.prepare(
        `INSERT INTO com_orders (id, tenant_id, org_id, order_number, order_kind, party_id, currency, grand_total_minor, status, fulfillment_status, payment_status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'quote', ?5, ?6, ?7, 'confirmed', 'unfulfilled', 'unpaid', ?8, ?8)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, quoteNo, d.partyId ?? null, d.currency, d.totalMinor, nowSec).run();
      return c.json({ id, orderNumber: quoteNo, grandTotalMinor: d.totalMinor, currency: d.currency }, 201);
    })
    .route('/', createWmsVehiclesLocationsRoutes(profileLoader));
}
