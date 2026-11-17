import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const UnitCreateSchema = z.object({
  unitNumber: z.string().min(1).max(32),
  floorLabel: z.string().max(64).optional(),
  typeName: z.string().min(1).max(80).default('Habitación Estándar'),
  baseRateMinor: z.number().int().nonnegative(),
  capacity: z.number().int().positive().default(2),
});

const FolioActionSchema = z.object({
  action: z.enum(['charge', 'settle']),
  description: z.string().max(160).optional(),
  amountMinor: z.number().int().positive().optional(),
});

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
  unitId: z.string().min(1).optional(),
});

const ORG_SUBTREE_FILTER =
  `(org_id = ?4 OR org_id IN (SELECT id FROM iam_organizations WHERE tenant_id = ?1 AND (tree_path = ?2 OR tree_path LIKE ?3)))`;

/** Mounts Hospitality PMS (Rooms, Housekeeping, Folios) & Condo Resident Hub routes. */
export function createHospitalityCondoRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/hospitality/overview', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'spaces', 'spaces.rack.read');
      const tid = auth.actor.tenantId;
      const op = auth.actor.orgPath;
      const opLike = `${op}/%`;
      const oid = auth.actor.orgId;
      const [unitsRes, hkRes, bookingsRes, foliosRes] = await c.env.DB.batch([
        c.env.DB.prepare(
          `SELECT id, unit_number, floor_label, current_status, monthly_rent_minor, updated_at
           FROM spc_units WHERE tenant_id = ?1 AND ${ORG_SUBTREE_FILTER} AND deleted_at IS NULL ORDER BY unit_number ASC LIMIT 60`,
        ).bind(tid, op, opLike, oid),
        c.env.DB.prepare(
          `SELECT h.id, h.unit_id, u.unit_number AS unitNumber, h.task_kind, h.priority, h.status, h.scheduled_for
           FROM spc_housekeeping_tasks h
           LEFT JOIN spc_units u ON u.id = h.unit_id AND u.tenant_id = h.tenant_id
           WHERE h.tenant_id = ?1 AND (h.org_id = ?4 OR h.org_id IN (SELECT id FROM iam_organizations WHERE tenant_id = ?1 AND (tree_path = ?2 OR tree_path LIKE ?3))) AND h.deleted_at IS NULL
           ORDER BY h.scheduled_for DESC LIMIT 50`,
        ).bind(tid, op, opLike, oid),
        c.env.DB.prepare(
          `SELECT b.id, b.confirmation_code, b.party_id, p.display_name AS guestName, b.unit_id, u.unit_number AS unitNumber, b.total_minor, b.paid_minor, b.status, b.scheduled_start
           FROM spc_bookings_and_appointments b
           LEFT JOIN crm_parties p ON p.id = b.party_id AND p.tenant_id = b.tenant_id
           LEFT JOIN spc_units u ON u.id = b.unit_id AND u.tenant_id = b.tenant_id
           WHERE b.tenant_id = ?1 AND (b.org_id = ?4 OR b.org_id IN (SELECT id FROM iam_organizations WHERE tenant_id = ?1 AND (tree_path = ?2 OR tree_path LIKE ?3))) AND b.deleted_at IS NULL
           ORDER BY b.scheduled_start DESC LIMIT 40`,
        ).bind(tid, op, opLike, oid),
        c.env.DB.prepare(
          `SELECT f.id, f.folio_number, f.booking_id, f.party_id, p.display_name AS guestName, f.unit_id, u.unit_number AS unitNumber, f.currency, f.charges_json, f.total_minor, f.paid_minor, f.balance_minor, f.status
           FROM spc_folios f
           LEFT JOIN crm_parties p ON p.id = f.party_id AND p.tenant_id = f.tenant_id
           LEFT JOIN spc_units u ON u.id = f.unit_id AND u.tenant_id = f.tenant_id
           WHERE f.tenant_id = ?1 AND (f.org_id = ?4 OR f.org_id IN (SELECT id FROM iam_organizations WHERE tenant_id = ?1 AND (tree_path = ?2 OR tree_path LIKE ?3))) AND f.deleted_at IS NULL
           ORDER BY f.updated_at DESC LIMIT 40`,
        ).bind(tid, op, opLike, oid),
      ]);
      return c.json({
        units: unitsRes?.results ?? [],
        housekeeping: hkRes?.results ?? [],
        bookings: bookingsRes?.results ?? [],
        folios: foliosRes?.results ?? [],
      });
    })
    .post('/hospitality/units', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'spaces', 'spaces.bookings.write');
      const parsed = UnitCreateSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid unit payload', parsed.error.flatten());
      const d = parsed.data;
      const nowSec = Math.floor(Date.now() / 1000);
      const typeCode = d.typeName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 24) || 'STD';
      let unitType = await c.env.DB.prepare(
        `SELECT id FROM spc_unit_types WHERE tenant_id = ?1 AND code = ?2 AND deleted_at IS NULL LIMIT 1`,
      ).bind(auth.actor.tenantId, typeCode).first<{ id: string }>();

      const typeId = unitType?.id ?? crypto.randomUUID();
      if (!unitType) {
        await c.env.DB.prepare(
          `INSERT INTO spc_unit_types (id, tenant_id, org_id, code, name, space_category, max_occupancy, base_rate_minor, rate_period, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'hotel_room', ?6, ?7, 'night', ?8, ?8)`,
        ).bind(typeId, auth.actor.tenantId, auth.actor.orgId, typeCode, d.typeName.trim(), d.capacity, d.baseRateMinor, nowSec).run();
      }

      const unitId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO spc_units (id, tenant_id, org_id, unit_type_id, unit_number, floor_label, current_status, monthly_rent_minor, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'AVAILABLE', ?7, ?8, ?8)`,
      ).bind(unitId, auth.actor.tenantId, auth.actor.orgId, typeId, d.unitNumber.trim(), d.floorLabel?.trim() ?? null, d.baseRateMinor, nowSec).run();
      return c.json({ ok: true, id: unitId, unitNumber: d.unitNumber.trim(), baseRateMinor: d.baseRateMinor }, 201);
    })
    .post('/hospitality/folios/:id/charge-or-settle', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'spaces', 'spaces.bookings.write');
      const folioId = c.req.param('id').trim();
      const parsed = FolioActionSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid folio action', parsed.error.flatten());
      const folio = await c.env.DB.prepare(
        `SELECT id, charges_json, total_minor, paid_minor, balance_minor, status
         FROM spc_folios WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL LIMIT 1`,
      ).bind(folioId, auth.actor.tenantId).first<{
        id: string; charges_json: string; total_minor: number; paid_minor: number; balance_minor: number; status: string;
      }>();
      if (!folio) throw new AppError('NOT_FOUND', 404, `Folio '${folioId}' not found`);

      const nowSec = Math.floor(Date.now() / 1000);
      if (parsed.data.action === 'charge') {
        const amt = parsed.data.amountMinor ?? 0;
        if (amt <= 0) throw new AppError('VALIDATION_ERROR', 400, 'amountMinor must be positive for charge');
        const charges = JSON.parse(folio.charges_json || '[]') as Array<Record<string, unknown>>;
        charges.push({ description: parsed.data.description?.trim() || 'Cargo adicional', amountMinor: amt, chargedAt: nowSec });
        const nextTotal = folio.total_minor + amt;
        const nextBal = folio.balance_minor + amt;
        await c.env.DB.prepare(
          `UPDATE spc_folios SET charges_json = ?1, total_minor = ?2, balance_minor = ?3, status = 'OPEN', updated_at = ?4 WHERE id = ?5 AND tenant_id = ?6`,
        ).bind(JSON.stringify(charges), nextTotal, nextBal, nowSec, folioId, auth.actor.tenantId).run();
        return c.json({ ok: true, id: folioId, totalMinor: nextTotal, balanceMinor: nextBal, status: 'OPEN' }, 200);
      }

      await c.env.DB.prepare(
        `UPDATE spc_folios SET paid_minor = total_minor, balance_minor = 0, status = 'CLOSED', updated_at = ?1 WHERE id = ?2 AND tenant_id = ?3`,
      ).bind(nowSec, folioId, auth.actor.tenantId).run();
      return c.json({ ok: true, id: folioId, totalMinor: folio.total_minor, balanceMinor: 0, status: 'CLOSED' }, 200);
    })
    .post('/hospitality/housekeeping', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'spaces', 'spaces.bookings.write');
      const parsed = HousekeepingSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid housekeeping payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      const isDirtyOrMaint = d.targetUnitStatus === 'DIRTY' || d.targetUnitStatus === 'MAINTENANCE';
      const taskStatus = isDirtyOrMaint ? 'PENDING' : 'COMPLETED';

      const stmts = [
        c.env.DB.prepare(
          `INSERT INTO spc_housekeeping_tasks
            (id, tenant_id, org_id, unit_id, task_kind, priority, scheduled_for, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7, ?7)`,
        ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.unitId, d.taskKind, d.priority, nowSec, taskStatus),
        c.env.DB.prepare(
          `UPDATE spc_units SET current_status = ?1, last_cleaned_at = ?2, updated_at = ?2
           WHERE (id = ?3 OR unit_number = ?3) AND tenant_id = ?4`,
        ).bind(d.targetUnitStatus, nowSec, d.unitId, auth.actor.tenantId),
      ];
      if (!isDirtyOrMaint) {
        stmts.push(
          c.env.DB.prepare(
            `UPDATE spc_housekeeping_tasks SET status = 'COMPLETED', updated_at = ?1
             WHERE unit_id = ?2 AND tenant_id = ?3 AND status = 'PENDING'`,
          ).bind(nowSec, d.unitId, auth.actor.tenantId),
        );
      }
      await c.env.DB.batch(stmts);
      return c.json({ ok: true, id, taskStatus, ...d }, 201);
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

      const details = JSON.parse(row.body_or_details_json || '{}') as { options?: string[]; votes?: number[]; votedUnits?: string[] };
      const voterKey = parsed.data.unitId?.trim() || auth.actor.id;
      const votedUnits = Array.isArray(details.votedUnits) ? [...details.votedUnits] : [];
      if (voterKey && votedUnits.includes(voterKey)) {
        throw new AppError('DUPLICATE_VOTE', 409, 'Esta unidad o usuario ya emitió su voto en esta asamblea');
      }
      if (voterKey) votedUnits.push(voterKey);

      const votes = Array.isArray(details.votes) ? [...details.votes] : (details.options ?? []).map(() => 0);
      if (parsed.data.optionIndex >= votes.length) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid poll option index');
      }
      votes[parsed.data.optionIndex] = (votes[parsed.data.optionIndex] ?? 0) + 1;
      const nextJson = JSON.stringify({ ...details, votes, votedUnits });
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `UPDATE condo_community_hub SET body_or_details_json = ?1, updated_at = ?2 WHERE id = ?3 AND tenant_id = ?4`,
      ).bind(nextJson, nowSec, itemId, auth.actor.tenantId).run();
      return c.json({ ok: true, id: itemId, votes }, 200);
    });
}
