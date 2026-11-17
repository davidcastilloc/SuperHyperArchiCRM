import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const HousekeepingSchema = z.object({
  unitId: z.string().min(1),
  taskKind: z.string().min(1).default('CHECKOUT_CLEANING'),
  targetUnitStatus: z.enum(['AVAILABLE', 'CLEAN', 'DIRTY', 'INSPECTED', 'OCCUPIED', 'MAINTENANCE']).default('CLEAN'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
});

const CondoHubItemSchema = z.object({
  itemKind: z.enum(['visitor_pass', 'package_delivery', 'parking_pet', 'amenity_booking', 'community_poll', 'announcement']),
  title: z.string().min(1).max(160),
  unitId: z.string().optional(),
  details: z.record(z.unknown()).default({}),
});

const VoteSchema = z.object({
  optionIndex: z.number().int().nonnegative(),
});

/** Mounts Hospitality PMS (Rooms, Housekeeping, Folios) & Condo Resident Hub routes. */
export function createHospitalityCondoRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/hospitality/overview', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'spaces', 'spaces.rack.read');
      const [unitsRes, hkRes, bookingsRes, foliosRes] = await c.env.DB.batch([
        c.env.DB.prepare(
          `SELECT id, unit_number, floor_label, current_status, monthly_rent_minor, updated_at
           FROM spc_units WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY unit_number ASC LIMIT 60`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, unit_id, task_kind, priority, status, scheduled_for
           FROM spc_housekeeping_tasks WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY scheduled_for DESC LIMIT 50`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, confirmation_code, party_id, unit_id, total_minor, paid_minor, status, scheduled_start
           FROM spc_bookings_and_appointments WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY scheduled_start DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, folio_number, booking_id, currency, total_minor, balance_minor, status
           FROM spc_folios WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
      ]);
      return c.json({
        units: unitsRes?.results ?? [],
        housekeeping: hkRes?.results ?? [],
        bookings: bookingsRes?.results ?? [],
        folios: foliosRes?.results ?? [],
      });
    })
    .post('/hospitality/housekeeping', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'spaces', 'spaces.bookings.write');
      const parsed = HousekeepingSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid housekeeping payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO spc_housekeeping_tasks
            (id, tenant_id, org_id, unit_id, task_kind, priority, scheduled_for, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'COMPLETED', ?7, ?7)`,
        ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.unitId, d.taskKind, d.priority, nowSec),
        c.env.DB.prepare(
          `UPDATE spc_units SET current_status = ?1, last_cleaned_at = ?2, updated_at = ?2
           WHERE (id = ?3 OR unit_number = ?3) AND tenant_id = ?4`,
        ).bind(d.targetUnitStatus, nowSec, d.unitId, auth.actor.tenantId),
      ]);
      return c.json({ ok: true, id, ...d }, 201);
    })
    .get('/condo/overview', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'leases', 'leases.contracts.read');
      const [leasesRes, appsRes, hubRes] = await c.env.DB.batch([
        c.env.DB.prepare(
          `SELECT id, lease_number, unit_id, primary_party_id, monthly_rent_minor, autopay_enabled, status
           FROM lease_contracts_and_renewals WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, applicant_party_id, target_unit_id, proposed_rent_minor, status, created_at
           FROM lease_applications WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, item_kind, unit_id, title, body_or_details_json, status, created_at
           FROM condo_community_hub WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 60`,
        ).bind(auth.actor.tenantId),
      ]);
      return c.json({
        leases: leasesRes?.results ?? [],
        applications: appsRes?.results ?? [],
        hubItems: hubRes?.results ?? [],
      });
    })
    .post('/condo/hub-items', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'leases', 'leases.community.write');
      const parsed = CondoHubItemSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid condo hub item', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO condo_community_hub
          (id, tenant_id, org_id, item_kind, unit_id, title, body_or_details_json, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ACTIVE', ?8, ?8)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.itemKind, d.unitId ?? null, d.title.trim(), JSON.stringify(d.details), nowSec).run();
      return c.json({ ok: true, id, ...d }, 201);
    })
    .post('/condo/hub-items/:id/vote', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'leases', 'leases.community.write');
      const itemId = c.req.param('id');
      const parsed = VoteSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid vote payload', parsed.error.flatten());

      const row = await c.env.DB.prepare(
        `SELECT body_or_details_json FROM condo_community_hub WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL LIMIT 1`,
      ).bind(itemId, auth.actor.tenantId).first<{ body_or_details_json: string }>();
      if (!row) throw new AppError('NOT_FOUND', 404, 'Poll not found');

      const details = JSON.parse(row.body_or_details_json || '{}') as { options?: string[]; votes?: number[] };
      const votes = Array.isArray(details.votes) ? [...details.votes] : (details.options ?? []).map(() => 0);
      if (parsed.data.optionIndex >= votes.length) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid poll option index');
      }
      votes[parsed.data.optionIndex] = (votes[parsed.data.optionIndex] ?? 0) + 1;
      const nextJson = JSON.stringify({ ...details, votes });
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `UPDATE condo_community_hub SET body_or_details_json = ?1, updated_at = ?2 WHERE id = ?3 AND tenant_id = ?4`,
      ).bind(nextJson, nowSec, itemId, auth.actor.tenantId).run();

      return c.json({ ok: true, id: itemId, votes }, 200);
    });
}
