import {
  AppError,
  sha256Hex,
  verifyPasswordPbkdf2,
  type ProfileLoader,
} from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from './command-registry.js';

const LOGIN_TTL_SECONDS = 12 * 3600;
const CASHIER_PIN_TTL_SECONDS = 8 * 3600;
const LOCK_DURATION_SECONDS = 15 * 60;
const MAX_FAILED_ATTEMPTS = 5;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  branchId: z.string().min(1),
});

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4}(\d{2})?$/),
  branchId: z.string().min(1),
  mode: z.enum(['cashier', 'delegation']),
});

const delegationSessionSchema = z.object({
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  orgId: z.string().min(1),
  orgPath: z.string().min(1),
  perms: z.array(z.string()),
  delegatedById: z.string().min(1),
  expiresAt: z.number().int(),
});

function parseUserPerms(preferencesJson: string): string[] {
  try {
    const parsed = JSON.parse(preferencesJson) as { perms?: unknown };
    if (Array.isArray(parsed.perms)) {
      return parsed.perms.filter((p): p is string => typeof p === 'string');
    }
  } catch {
    // Fail-closed: corrupt preferencesJson grants no permissions
  }
  return [];
}

function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return `shac_sess_${hex}`;
}

async function issueSession(
  kv: KVNamespace,
  payload: {
    userId: string;
    fullName: string;
    tenantId: string;
    orgId: string;
    orgPath: string;
    branchName: string;
    actorType: 'staff' | 'delegated_staff';
    perms: string[];
    delegatedById?: string;
  },
  ttlSeconds: number,
) {
  const token = generateSessionToken();
  const tokenHash = await sha256Hex(token);
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + ttlSeconds;

  await kv.put(
    `session:${tokenHash}`,
    JSON.stringify({
      userId: payload.userId,
      tenantId: payload.tenantId,
      orgId: payload.orgId,
      orgPath: payload.orgPath,
      actorType: payload.actorType,
      perms: payload.perms,
      ...(payload.delegatedById ? { delegatedById: payload.delegatedById } : {}),
      expiresAt,
    }),
    { expirationTtl: ttlSeconds },
  );

  return {
    token,
    expiresAt,
    actor: {
      id: payload.userId,
      fullName: payload.fullName,
      type: payload.actorType,
      tenantId: payload.tenantId,
      orgId: payload.orgId,
      orgPath: payload.orgPath,
      branchName: payload.branchName,
      perms: payload.perms,
      ...(payload.delegatedById ? { delegatedById: payload.delegatedById } : {}),
    },
  };
}

/** Mounts /bootstrap, /login, /pin, and /logout under /api/auth. */
export function createAuthRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/bootstrap', async (c) => {
      const profile = await profileLoader.load(c.env.CONFIG_KV);
      const res = await c.env.DB.prepare(
        'SELECT id, name, tree_path AS orgPath FROM iam_organizations WHERE tenant_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY depth ASC, name ASC',
      )
        .bind(profile.tenantId)
        .all<{ id: string; name: string; orgPath: string }>();

      return c.json(
        {
          tenantId: profile.tenantId,
          editionPreset: profile.editionPreset,
          activeModules: profile.activeModules,
          vocabulary: profile.vocabulary,
          branches: res.results ?? [],
        },
        200,
      );
    })
    .post('/login', async (c) => {
      let rawBody: unknown;
      try {
        rawBody = await c.req.json();
      } catch {
        throw new AppError('BAD_REQUEST', 400, 'Invalid JSON request body');
      }
      const parsed = loginSchema.safeParse(rawBody);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid login payload', parsed.error.flatten());
      }

      const profile = await profileLoader.load(c.env.CONFIG_KV);
      const emailHash = await sha256Hex(parsed.data.email.trim().toLowerCase());
      const nowSec = Math.floor(Date.now() / 1000);

      const [userRes, orgRes] = await c.env.DB.batch([
        c.env.DB.prepare(
          'SELECT id, full_name, password_hash_webcrypto, failed_login_attempts, locked_until, preferences_json FROM iam_users WHERE tenant_id = ? AND email_hash = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1',
        ).bind(profile.tenantId, emailHash),
        c.env.DB.prepare(
          'SELECT id, name, tree_path FROM iam_organizations WHERE tenant_id = ? AND id = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1',
        ).bind(profile.tenantId, parsed.data.branchId),
      ]);

      const user = (userRes?.results?.[0] ?? null) as {
        id: string;
        full_name: string;
        password_hash_webcrypto: string | null;
        failed_login_attempts: number;
        locked_until: number | null;
        preferences_json: string;
      } | null;
      const org = (orgRes?.results?.[0] ?? null) as {
        id: string;
        name: string;
        tree_path: string;
      } | null;

      if (!user || !user.password_hash_webcrypto || !org) {
        throw new AppError('UNAUTHORIZED', 401, 'Invalid credentials or branch');
      }

      if (user.locked_until && user.locked_until > nowSec) {
        throw new AppError('ACCOUNT_LOCKED', 423, 'Account temporarily locked');
      }

      const valid = await verifyPasswordPbkdf2(
        parsed.data.password,
        user.password_hash_webcrypto,
      );
      if (!valid) {
        const nextAttempts = user.failed_login_attempts + 1;
        const lockedUntil =
          nextAttempts >= MAX_FAILED_ATTEMPTS ? nowSec + LOCK_DURATION_SECONDS : null;
        await c.env.DB.prepare(
          'UPDATE iam_users SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
        )
          .bind(nextAttempts, lockedUntil, nowSec, user.id, profile.tenantId)
          .run();
        throw new AppError('UNAUTHORIZED', 401, 'Invalid credentials');
      }

      await c.env.DB.prepare(
        'UPDATE iam_users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
      )
        .bind(nowSec, nowSec, user.id, profile.tenantId)
        .run();

      const session = await issueSession(
        c.env.SESSION_KV,
        {
          userId: user.id,
          fullName: user.full_name,
          tenantId: profile.tenantId,
          orgId: org.id,
          orgPath: org.tree_path,
          branchName: org.name,
          actorType: 'staff',
          perms: parseUserPerms(user.preferences_json),
        },
        LOGIN_TTL_SECONDS,
      );
      return c.json(session, 200);
    })
    .post('/pin', async (c) => {
      let rawBody: unknown;
      try {
        rawBody = await c.req.json();
      } catch {
        throw new AppError('BAD_REQUEST', 400, 'Invalid JSON request body');
      }
      const parsed = pinSchema.safeParse(rawBody);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid PIN payload', parsed.error.flatten());
      }

      const profile = await profileLoader.load(c.env.CONFIG_KV);
      const pinHash = await sha256Hex(parsed.data.pin);
      const nowSec = Math.floor(Date.now() / 1000);

      if (parsed.data.mode === 'delegation') {
        const raw = await c.env.SESSION_KV.get(`delegation:${pinHash}`, 'text');
        if (!raw) {
          throw new AppError('INVALID_DELEGATION_PIN', 401, 'Invalid delegation PIN');
        }
        const deleg = delegationSessionSchema.safeParse(JSON.parse(raw));
        if (
          !deleg.success ||
          deleg.data.expiresAt <= nowSec ||
          deleg.data.tenantId !== profile.tenantId ||
          deleg.data.orgId !== parsed.data.branchId
        ) {
          throw new AppError('INVALID_DELEGATION_PIN', 401, 'Delegation PIN expired or invalid for branch');
        }
        const orgRow = await c.env.DB.prepare(
          'SELECT name FROM iam_organizations WHERE tenant_id = ? AND id = ? LIMIT 1',
        )
          .bind(profile.tenantId, deleg.data.orgId)
          .first<{ name: string }>();

        const session = await issueSession(
          c.env.SESSION_KV,
          {
            userId: deleg.data.userId,
            fullName: 'Operador Delegado',
            tenantId: deleg.data.tenantId,
            orgId: deleg.data.orgId,
            orgPath: deleg.data.orgPath,
            branchName: orgRow?.name ?? deleg.data.orgId,
            actorType: 'delegated_staff',
            perms: deleg.data.perms,
            delegatedById: deleg.data.delegatedById,
          },
          Math.max(60, deleg.data.expiresAt - nowSec),
        );
        return c.json(session, 200);
      }

      const [userRes, orgRes] = await c.env.DB.batch([
        c.env.DB.prepare(
          'SELECT id, full_name, preferences_json FROM iam_users WHERE tenant_id = ? AND floor_pin_hash = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1',
        ).bind(profile.tenantId, pinHash),
        c.env.DB.prepare(
          'SELECT id, name, tree_path FROM iam_organizations WHERE tenant_id = ? AND id = ? AND is_active = 1 AND deleted_at IS NULL LIMIT 1',
        ).bind(profile.tenantId, parsed.data.branchId),
      ]);

      const user = (userRes?.results?.[0] ?? null) as {
        id: string;
        full_name: string;
        preferences_json: string;
      } | null;
      const org = (orgRes?.results?.[0] ?? null) as {
        id: string;
        name: string;
        tree_path: string;
      } | null;

      if (!user || !org) {
        throw new AppError('UNAUTHORIZED', 401, 'Invalid cashier PIN or branch');
      }

      const session = await issueSession(
        c.env.SESSION_KV,
        {
          userId: user.id,
          fullName: user.full_name,
          tenantId: profile.tenantId,
          orgId: org.id,
          orgPath: org.tree_path,
          branchName: org.name,
          actorType: 'staff',
          perms: parseUserPerms(user.preferences_json),
        },
        CASHIER_PIN_TTL_SECONDS,
      );
      return c.json(session, 200);
    })
    .post('/logout', async (c) => {
      const authHeader = c.req.header('Authorization');
      if (authHeader?.startsWith('Bearer shac_sess_')) {
        const token = authHeader.slice('Bearer '.length).trim();
        const hash = await sha256Hex(token);
        await c.env.SESSION_KV.delete(`session:${hash}`);
      }
      return c.json({ ok: true }, 200);
    });
}
