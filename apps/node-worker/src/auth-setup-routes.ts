import {
  buildMarketProfileFromPreset,
  EditionPresetIdSchema,
  getEditionCatalogSummary,
  RegionPackIdSchema,
} from '@shac/editions';
import {
  AppError,
  authenticateRequest,
  hashPasswordPbkdf2,
  sha256Hex,
  type ProfileLoader,
  type TenantMarketProfile,
} from '@shac/kernel';
import type { Context } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from './command-registry.js';

const LOGIN_TTL_SECONDS = 12 * 3600;

export const SetupSchema = z.object({
  companyName: z.string().min(1).max(120),
  branchName: z.string().min(1).max(120),
  editionPreset: EditionPresetIdSchema,
  regionPack: RegionPackIdSchema.default('ve'),
  adminName: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  floorPin: z.string().regex(/^\d{4}$/).optional(),
  initialUsdToLocalRate: z.number().positive().optional(),
});

export interface ParsedUserPrefs {
  perms: string[];
  allowedOrgIds: string[];
}

export function parseUserPrefs(preferencesJson: string): ParsedUserPrefs {
  try {
    const parsed = JSON.parse(preferencesJson) as { perms?: unknown; allowedOrgIds?: unknown };
    const perms = Array.isArray(parsed.perms)
      ? parsed.perms.filter((p): p is string => typeof p === 'string')
      : [];
    const allowedOrgIds = Array.isArray(parsed.allowedOrgIds)
      ? parsed.allowedOrgIds.filter((id): id is string => typeof id === 'string')
      : [];
    return { perms, allowedOrgIds };
  } catch {
    return { perms: [], allowedOrgIds: [] };
  }
}

export async function issueSession(
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
  ttlSeconds: number = LOGIN_TTL_SECONDS,
) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  const token = `shac_sess_${hex}`;
  const tokenHash = await sha256Hex(token);
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

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

/** Enforces AGENTS.md §5.1 hierarchical orgPath ceiling for non-wildcard staff. */
export async function assertUserBranchScope(
  db: D1Database,
  tenantId: string,
  defaultOrgId: string,
  targetOrg: { id: string; tree_path: string },
  prefs: ParsedUserPrefs,
): Promise<void> {
  if (prefs.perms.includes('*') || prefs.allowedOrgIds.includes(targetOrg.id)) return;
  if (defaultOrgId === targetOrg.id) return;
  const rootOrg = await db
    .prepare('SELECT tree_path FROM iam_organizations WHERE tenant_id = ?1 AND id = ?2 AND deleted_at IS NULL LIMIT 1')
    .bind(tenantId, defaultOrgId)
    .first<{ tree_path: string }>();
  const rootPath = rootOrg?.tree_path ?? '';
  const allowed = rootPath.length > 0 && (targetOrg.tree_path === rootPath || targetOrg.tree_path.startsWith(`${rootPath}/`));
  if (!allowed) {
    throw new AppError('FORBIDDEN_ORG_SCOPE', 403, 'User is not authorized for this branch');
  }
}

export async function handleBootstrap(c: Context<HonoEnv>, profileLoader: ProfileLoader) {
  const userCountRow = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM iam_users WHERE deleted_at IS NULL').first<{ cnt: number }>();
  const userCount = Number(userCountRow?.cnt ?? 0);

  let profile: TenantMarketProfile | null = null;
  try {
    profile = await profileLoader.load(c.env.CONFIG_KV);
  } catch (err) {
    if (userCount > 0) throw err;
  }

  if (userCount === 0) {
    const catalog = getEditionCatalogSummary();
    const fallback = buildMarketProfileFromPreset({
      deploymentId: profile?.deploymentId ?? 'dep_local',
      tenantId: profile?.tenantId ?? 'ten_1',
      editionPreset: profile?.editionPreset ?? 'retail-pos',
      regionPack: profile?.regionPack ?? 've',
    });
    const active = profile ?? fallback;
    return c.json({
      needsSetup: true,
      hasProvisionedProfile: Boolean(profile),
      tenantId: active.tenantId,
      editionPreset: active.editionPreset,
      activeModules: active.activeModules,
      vocabulary: active.vocabulary,
      branches: [] as Array<{ id: string; name: string; orgPath: string }>,
      catalog,
    }, 200);
  }

  if (!profile) throw new AppError('PROFILE_UNAVAILABLE', 503, 'Tenant market profile is missing from CONFIG_KV');

  const res = await c.env.DB.prepare(
    'SELECT id, name, tree_path AS orgPath FROM iam_organizations WHERE tenant_id = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY depth ASC, name ASC',
  ).bind(profile.tenantId).all<{ id: string; name: string; orgPath: string }>();

  return c.json({
    needsSetup: false,
    hasProvisionedProfile: true,
    tenantId: profile.tenantId,
    editionPreset: profile.editionPreset,
    activeModules: profile.activeModules,
    vocabulary: profile.vocabulary,
    branches: res.results ?? [],
  }, 200);
}

export async function handleInitialSetup(c: Context<HonoEnv>, profileLoader: ProfileLoader) {
  const rawBody = await c.req.json().catch(() => null);
  const parsed = SetupSchema.safeParse(rawBody);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid setup payload', parsed.error.flatten());
  const d = parsed.data;

  const userCountRow = await c.env.DB.prepare('SELECT COUNT(*) AS cnt FROM iam_users WHERE deleted_at IS NULL').first<{ cnt: number }>();
  if (Number(userCountRow?.cnt ?? 0) > 0) {
    throw new AppError('ALREADY_INITIALIZED', 409, 'System is already initialized');
  }

  let existingProfile: TenantMarketProfile | null = null;
  try {
    existingProfile = await profileLoader.load(c.env.CONFIG_KV);
  } catch { /* empty KV */ }

  const profile = existingProfile
    ? existingProfile
    : buildMarketProfileFromPreset({
        deploymentId: `dep_${crypto.randomUUID().slice(0, 8)}`,
        tenantId: 'ten_1',
        editionPreset: d.editionPreset,
        regionPack: d.regionPack,
      });

  if (!existingProfile) {
    await c.env.CONFIG_KV.put('profile:current', JSON.stringify(profile));
    profileLoader.invalidate();
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const emailNorm = d.email.trim().toLowerCase();
  const [emailHash, pwHash, pinHash] = await Promise.all([
    sha256Hex(emailNorm),
    hashPasswordPbkdf2(d.password),
    d.floorPin ? sha256Hex(d.floorPin) : Promise.resolve(null),
  ]);
  const userId = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const orgId = 'org_1';
  const baseCurrency = profile.currency.baseCurrency;
  const secondaryCurrency = profile.currency.operatingCurrencies.find((cur) => cur !== baseCurrency);

  const coreStmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'es-VE', 'active', ?5, ?5)`,
    ).bind(profile.tenantId, profile.tenantId, d.companyName.trim(), baseCurrency, nowSec),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES (?1, ?2, NULL, ?1, '/org_1', 0, 'casa-matriz', ?3, 'company', 'America/Caracas', 1, 1, ?4, ?4)`,
    ).bind(orgId, profile.tenantId, d.branchName.trim(), nowSec),
    c.env.DB.prepare(
      `INSERT INTO iam_users (id, tenant_id, default_org_id, realm, email, email_hash, full_name, password_hash_webcrypto, floor_pin_hash, is_verified, preferences_json, is_active, failed_login_attempts, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'staff', ?4, ?5, ?6, ?7, ?8, 1, '{"perms":["*"]}', 1, 0, ?9, ?9)`,
    ).bind(userId, profile.tenantId, orgId, emailNorm, emailHash, d.adminName.trim(), pwHash, pinHash, nowSec),
  ];
  if (secondaryCurrency && d.initialUsdToLocalRate) {
    const rateMicros = Math.round(d.initialUsdToLocalRate * 1_000_000);
    coreStmts.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO cat_currencies_and_rates (id, tenant_id, org_id, from_currency, to_currency, rate_micros, source, effective_at, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'BCV', ?7, 1, ?7, ?7)`,
      ).bind(`fx_${crypto.randomUUID().slice(0, 8)}`, profile.tenantId, orgId, baseCurrency, secondaryCurrency, rateMicros, nowSec),
    );
  }
  await c.env.DB.batch(coreStmts);

  const finStmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO fin_accounts (id, tenant_id, org_id, code, name, account_kind, currency, is_default, is_active, created_at, updated_at)
       VALUES ('acc_usd_cash', ?1, ?2, 'CAJA-USD', 'Caja Principal USD', 'cash_drawer', ?3, 1, 1, ?4, ?4)`,
    ).bind(profile.tenantId, orgId, baseCurrency, nowSec),
  ];
  if (secondaryCurrency) {
    finStmts.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO fin_accounts (id, tenant_id, org_id, code, name, account_kind, currency, is_default, is_active, created_at, updated_at)
         VALUES ('acc_ves_pm', ?1, ?2, ?3, ?4, 'mobile_pay', ?5, 1, 1, ?6, ?6)`,
      ).bind(profile.tenantId, orgId, `PM-${secondaryCurrency}`, `Pago Móvil / Banco ${secondaryCurrency}`, secondaryCurrency, nowSec),
    );
  }
  await c.env.DB.batch(finStmts).catch(() => undefined);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO fin_chart_of_accounts_and_periods (id, tenant_id, org_id, record_kind, account_code, name, classification, normal_balance, currency, current_balance_minor, is_active, created_at, updated_at)
       VALUES ('coa_cash_main', ?1, ?2, 'gl_account', '1010-CASH', 'Caja y Bancos', 'asset', 'debit', ?3, 0, 1, ?4, ?4)`,
    ).bind(profile.tenantId, orgId, baseCurrency, nowSec),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO fin_chart_of_accounts_and_periods (id, tenant_id, org_id, record_kind, account_code, name, classification, normal_balance, currency, current_balance_minor, is_active, created_at, updated_at)
       VALUES ('coa_sales_main', ?1, ?2, 'gl_account', '4010-SALES', 'Ingresos Operativos', 'revenue', 'credit', ?3, 0, 1, ?4, ?4)`,
    ).bind(profile.tenantId, orgId, baseCurrency, nowSec),
  ]).catch(() => undefined);
  const session = await issueSession(c.env.SESSION_KV, {
    userId,
    fullName: d.adminName.trim(),
    tenantId: profile.tenantId,
    orgId,
    orgPath: '/org_1',
    branchName: d.branchName.trim(),
    actorType: 'staff',
    perms: ['*'],
  });
  return c.json(session, 201);
}

export async function handleSwitchBranch(c: Context<HonoEnv>, profileLoader: ProfileLoader) {
  await profileLoader.load(c.env.CONFIG_KV);
  const jwk = c.env.JWT_PUBLIC_KEY_JWK ? (JSON.parse(c.env.JWT_PUBLIC_KEY_JWK) as JsonWebKey) : { kty: 'OKP' };
  const actor = await authenticateRequest(c.req.raw.headers, c.env.SESSION_KV, jwk);
  const parsed = z.object({ branchId: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid branchId', parsed.error.flatten());

  const [userRow, targetOrg] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, default_org_id, full_name, preferences_json FROM iam_users WHERE tenant_id = ?1 AND id = ?2 AND is_active = 1 AND deleted_at IS NULL LIMIT 1').bind(actor.tenantId, actor.id),
    c.env.DB.prepare('SELECT id, name, tree_path FROM iam_organizations WHERE tenant_id = ?1 AND id = ?2 AND is_active = 1 AND deleted_at IS NULL LIMIT 1').bind(actor.tenantId, parsed.data.branchId),
  ]);
  const user = (userRow?.results?.[0] ?? null) as { id: string; default_org_id: string; full_name: string; preferences_json: string } | null;
  const org = (targetOrg?.results?.[0] ?? null) as { id: string; name: string; tree_path: string } | null;
  if (!user || !org) throw new AppError('NOT_FOUND', 404, 'User or target branch not found');

  const prefs = parseUserPrefs(user.preferences_json);
  await assertUserBranchScope(c.env.DB, actor.tenantId, user.default_org_id, org, prefs);

  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer shac_sess_')) {
    const oldHash = await sha256Hex(authHeader.slice('Bearer '.length).trim());
    await c.env.SESSION_KV.delete(`session:${oldHash}`);
  }

  const session = await issueSession(c.env.SESSION_KV, {
    userId: user.id,
    fullName: user.full_name,
    tenantId: actor.tenantId,
    orgId: org.id,
    orgPath: org.tree_path,
    branchName: org.name,
    actorType: actor.type === 'delegated_staff' ? 'delegated_staff' : 'staff',
    perms: prefs.perms,
  });
  return c.json(session, 200);
}
