import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const StaffProfileSchema = z.object({
  userId: z.string().min(1),
  employeeNumber: z.string().max(64).optional(),
  departmentName: z.string().max(80).optional(),
  jobTitle: z.string().max(80).optional(),
  specialty: z.string().max(80).optional(),
  hourlyRateMinor: z.number().int().nonnegative().default(0),
});

const TimesheetOrLeaveSchema = z.object({
  recordType: z.enum(['timesheet', 'leave_request', 'shift']).default('timesheet'),
  staffId: z.string().min(1),
  projectOrCaseId: z.string().optional(),
  durationMinutes: z.number().int().nonnegative().default(60),
  hourlyRateMinor: z.number().int().nonnegative().default(0),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected']).default('submitted'),
});

const ProjectSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  budgetKind: z.enum(['hours', 'fixed_minor']).default('hours'),
  budgetValue: z.number().int().nonnegative().default(40),
  hourlyRateMinor: z.number().int().nonnegative().default(5000),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).default('ACTIVE'),
});

/** Mounts Staff profiles, Leave requests, Timesheets, and PSA Projects routes. */
const STAFF_ORG_FILTER =
  `(org_id = ?4 OR org_id IN (SELECT id FROM iam_organizations WHERE tenant_id = ?1 AND (tree_path = ?2 OR tree_path LIKE ?3)))`;

export function createStaffRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/profiles', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.read');
      const res = await c.env.DB.prepare(
        `SELECT id, user_id, employee_number, department_name, job_title, specialty, base_rate_minor, is_active, created_at
         FROM hr_staff_profiles_and_credentials WHERE tenant_id = ?1 AND ${STAFF_ORG_FILTER} AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
      )
        .bind(auth.actor.tenantId, auth.actor.orgPath, `${auth.actor.orgPath}/%`, auth.actor.orgId)
        .all<{
          id: string; user_id: string; employee_number: string | null; department_name: string | null;
          job_title: string | null; specialty: string | null; base_rate_minor: number; is_active: number; created_at: number;
        }>();
      return c.json({
        items: (res.results ?? []).map((s) => ({
          id: s.id,
          userId: s.user_id,
          employeeNumber: s.employee_number,
          departmentName: s.department_name,
          jobTitle: s.job_title,
          specialty: s.specialty,
          baseRateMinor: s.base_rate_minor,
          isActive: Boolean(s.is_active),
          createdAt: s.created_at,
        })),
      });
    })
    .post('/profiles', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.write');
      const parsed = StaffProfileSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid staff profile', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO hr_staff_profiles_and_credentials
          (id, tenant_id, org_id, user_id, employee_number, department_name, job_title, specialty, base_rate_minor, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10)`,
      )
        .bind(id, auth.actor.tenantId, auth.actor.orgId, d.userId, d.employeeNumber ?? null, d.departmentName ?? null, d.jobTitle ?? null, d.specialty ?? null, d.hourlyRateMinor, nowSec)
        .run();
      return c.json({ id, ...d }, 201);
    })
    .get('/timesheets', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.read');
      const res = await c.env.DB.prepare(
        `SELECT id, record_type, staff_id, project_or_case_id, duration_minutes, hourly_rate_minor, gross_pay_minor, status, created_at
         FROM hr_shifts_timesheets_and_payroll WHERE tenant_id = ?1 AND ${STAFF_ORG_FILTER} AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
      )
        .bind(auth.actor.tenantId, auth.actor.orgPath, `${auth.actor.orgPath}/%`, auth.actor.orgId)
        .all<{
          id: string; record_type: string; staff_id: string; project_or_case_id: string | null;
          duration_minutes: number; hourly_rate_minor: number; gross_pay_minor: number; status: string; created_at: number;
        }>();
      return c.json({
        items: (res.results ?? []).map((t) => ({
          id: t.id,
          recordType: t.record_type,
          staffId: t.staff_id,
          projectOrCaseId: t.project_or_case_id,
          durationMinutes: t.duration_minutes,
          hourlyRateMinor: t.hourly_rate_minor,
          grossPayMinor: t.gross_pay_minor,
          status: t.status,
          createdAt: t.created_at,
        })),
      });
    })
    .post('/timesheets', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.write');
      const parsed = TimesheetOrLeaveSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid timesheet/leave payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      const grossMinor = Math.trunc((d.durationMinutes * d.hourlyRateMinor) / 60);
      await c.env.DB.prepare(
        `INSERT INTO hr_shifts_timesheets_and_payroll
          (id, tenant_id, org_id, record_type, staff_id, project_or_case_id, duration_minutes, hourly_rate_minor, gross_pay_minor, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
      )
        .bind(id, auth.actor.tenantId, auth.actor.orgId, d.recordType, d.staffId, d.projectOrCaseId ?? null, d.durationMinutes, d.hourlyRateMinor, grossMinor, d.status, nowSec)
        .run();
      return c.json({ id, ...d, grossPayMinor: grossMinor }, 201);
    })
    .get('/projects', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.read');
      const res = await c.env.DB.prepare(
        `SELECT id, code, name, budget_kind, budget_value, hourly_rate_minor, status, created_at
         FROM psa_projects_and_tasks WHERE tenant_id = ?1 AND ${STAFF_ORG_FILTER} AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
      )
        .bind(auth.actor.tenantId, auth.actor.orgPath, `${auth.actor.orgPath}/%`, auth.actor.orgId)
        .all<{
          id: string; code: string; name: string; budget_kind: string;
          budget_value: number; hourly_rate_minor: number; status: string; created_at: number;
        }>();
      return c.json({
        items: (res.results ?? []).map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          budgetKind: p.budget_kind,
          budgetValue: p.budget_value,
          hourlyRateMinor: p.hourly_rate_minor,
          status: p.status,
          createdAt: p.created_at,
        })),
      });
    })
    .post('/projects', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.write');
      const parsed = ProjectSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid project payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO psa_projects_and_tasks
          (id, tenant_id, org_id, code, name, budget_kind, budget_value, hourly_rate_minor, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
         ON CONFLICT(tenant_id, code) DO UPDATE SET
           name = excluded.name, budget_value = excluded.budget_value, status = excluded.status, updated_at = excluded.updated_at`,
      )
        .bind(id, auth.actor.tenantId, auth.actor.orgId, d.code.trim(), d.name.trim(), d.budgetKind, d.budgetValue, d.hourlyRateMinor, d.status, nowSec)
        .run();
      return c.json({ id, ...d }, 201);
    });
}
