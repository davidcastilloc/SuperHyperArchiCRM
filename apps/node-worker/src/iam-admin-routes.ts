import {
  AppError,
  hashPasswordPbkdf2,
  sha256Hex,
  type ProfileLoader,
} from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const CreateUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(120),
  realm: z.enum(['staff', 'portal', 'admin']).default('staff'),
  defaultOrgId: z.string().min(1).optional(),
  allowedOrgIds: z.array(z.string().min(1)).optional(),
  password: z.string().min(8).max(128).optional(),
  floorPin: z.string().regex(/^\d{4}$/).optional(),
  perms: z.array(z.string()).default(['customers.read']),
});

const CustomRecordSchema = z.object({
  entitySlug: z.string().regex(/^[a-z0-9_-]{2,48}$/),
  code: z.string().min(1).max(64),
  title: z.string().min(1).max(180),
  data: z.record(z.unknown()).default({}),
});

/** Mounts IAM Users, API Keys, Audit Logs, and Custom Records endpoints. */
export function createIamAdminRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/iam/users', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.read');
      const res = await c.env.DB.prepare(
        `SELECT id, default_org_id, realm, email, full_name, is_active, last_login_at, created_at
         FROM iam_users WHERE tenant_id = ?1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
      )
        .bind(auth.actor.tenantId)
        .all<{
          id: string;
          default_org_id: string;
          realm: string;
          email: string;
          full_name: string;
          is_active: number;
          last_login_at: number | null;
          created_at: number;
        }>();
      return c.json({
        items: (res.results ?? []).map((u) => ({
          id: u.id,
          defaultOrgId: u.default_org_id,
          realm: u.realm,
          email: u.email,
          fullName: u.full_name,
          isActive: Boolean(u.is_active),
          lastLoginAt: u.last_login_at,
          createdAt: u.created_at,
        })),
      });
    })
    .post('/iam/users', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.write');
      const parsed = CreateUserSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid user payload', parsed.error.flatten());
      }
      const d = parsed.data;
      const emailNorm = d.email.trim().toLowerCase();
      const emailHash = await sha256Hex(emailNorm);
      const pwHash = d.password ? await hashPasswordPbkdf2(d.password) : null;
      const pinHash = d.floorPin ? await sha256Hex(d.floorPin) : null;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      const orgId = d.defaultOrgId || auth.actor.orgId;

      await c.env.DB.prepare(
        `INSERT INTO iam_users
          (id, tenant_id, default_org_id, realm, email, email_hash, full_name, password_hash_webcrypto, floor_pin_hash, is_verified, preferences_json, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, 1, ?11, ?11)
         ON CONFLICT(tenant_id, email_hash) DO UPDATE SET
           default_org_id = excluded.default_org_id,
           full_name = excluded.full_name,
           realm = excluded.realm,
           password_hash_webcrypto = COALESCE(excluded.password_hash_webcrypto, iam_users.password_hash_webcrypto),
           floor_pin_hash = COALESCE(excluded.floor_pin_hash, iam_users.floor_pin_hash),
           preferences_json = excluded.preferences_json,
           updated_at = excluded.updated_at`,
      )
        .bind(
          id,
          auth.actor.tenantId,
          orgId,
          d.realm,
          emailNorm,
          emailHash,
          d.fullName.trim(),
          pwHash,
          pinHash,
          JSON.stringify({ perms: d.perms, ...(d.allowedOrgIds ? { allowedOrgIds: d.allowedOrgIds } : {}) }),
          nowSec,
        )
        .run();

      return c.json({ id, email: emailNorm, fullName: d.fullName.trim(), realm: d.realm, defaultOrgId: orgId }, 201);
    })
    .get('/iam/api-keys', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.read');
      const res = await c.env.DB.prepare(
        `SELECT id, org_id, name, key_prefix, permissions_json, created_by, last_used_at, created_at
         FROM iam_api_keys WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT 50`,
      )
        .bind(auth.actor.tenantId)
        .all<{
          id: string;
          org_id: string;
          name: string;
          key_prefix: string;
          permissions_json: string;
          created_by: string;
          last_used_at: number | null;
          created_at: number;
        }>();
      return c.json({
        items: (res.results ?? []).map((k) => ({
          id: k.id,
          orgId: k.org_id,
          name: k.name,
          keyPrefix: k.key_prefix,
          permissionsJson: k.permissions_json,
          createdBy: k.created_by,
          lastUsedAt: k.last_used_at,
          createdAt: k.created_at,
        })),
      });
    })
    .get('/system/audit-logs', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'core', 'iam.orgs.read');
      const res = await c.env.DB.prepare(
        `SELECT id, org_id, log_stream, actor_id, command_id, resource_kind, resource_id, created_at
         FROM kernel_action_logs WHERE tenant_id = ?1
         ORDER BY created_at DESC LIMIT 100`,
      )
        .bind(auth.actor.tenantId)
        .all<{
          id: string;
          org_id: string;
          log_stream: string;
          actor_id: string;
          command_id: string;
          resource_kind: string;
          resource_id: string;
          created_at: number;
        }>();
      return c.json({
        items: (res.results ?? []).map((l) => ({
          id: l.id,
          orgId: l.org_id,
          logStream: l.log_stream,
          actorId: l.actor_id,
          commandId: l.command_id,
          resourceKind: l.resource_kind,
          resourceId: l.resource_id,
          createdAt: l.created_at,
        })),
      });
    })
    .get('/system/custom-records', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'core', 'iam.orgs.read');
      const slug = c.req.query('entitySlug');
      const stmt = slug
        ? c.env.DB.prepare(
            `SELECT id, entity_slug, code, title, data_json, created_at
             FROM kernel_custom_records WHERE tenant_id = ?1 AND entity_slug = ?2 AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 100`,
          ).bind(auth.actor.tenantId, slug)
        : c.env.DB.prepare(
            `SELECT id, entity_slug, code, title, data_json, created_at
             FROM kernel_custom_records WHERE tenant_id = ?1 AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 100`,
          ).bind(auth.actor.tenantId);
      const res = await stmt.all<{
        id: string;
        entity_slug: string;
        code: string;
        title: string;
        data_json: string;
        created_at: number;
      }>();
      return c.json({
        items: (res.results ?? []).map((r) => ({
          id: r.id,
          entitySlug: r.entity_slug,
          code: r.code,
          title: r.title,
          data: JSON.parse(r.data_json || '{}') as Record<string, unknown>,
          createdAt: r.created_at,
        })),
      });
    })
    .post('/system/custom-records', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'core', 'iam.orgs.write');
      const parsed = CustomRecordSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid custom record payload', parsed.error.flatten());
      }
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO kernel_custom_records (id, tenant_id, org_id, entity_slug, code, title, data_json, version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)
         ON CONFLICT(tenant_id, entity_slug, code) DO UPDATE SET
           title = excluded.title, data_json = excluded.data_json, updated_at = excluded.updated_at`,
      )
        .bind(id, auth.actor.tenantId, auth.actor.orgId, d.entitySlug, d.code.trim(), d.title.trim(), JSON.stringify(d.data), nowSec)
        .run();
      return c.json({ id, entitySlug: d.entitySlug, code: d.code.trim(), title: d.title.trim(), data: d.data }, 201);
    });
}
