import { z } from 'zod';
import {
  AppError,
  type ExecutionActor,
  type KvStore,
  type TenantMarketProfile,
} from './contracts.js';
import { sha256Hex, verifyJwtEdDsa } from './crypto.js';

const PROFILE_KEY = 'profile:current';
const DEFAULT_PROFILE_TTL_MS = 60_000;

const profileSchema = z.object({
  deploymentId: z.string().min(1),
  tenantId: z.string().min(1),
  editionPreset: z.enum([
    'retail-pos',
    'distro-wms',
    'tech-service',
    'hospitality-pms',
    'property-condo',
    'clinic-practice',
    'legal-psa',
    'industrial-gate',
    'omni-enterprise',
  ]),
  regionPack: z.enum(['ve', 'co', 'mx', 'us', 'global']),
  activeModules: z.array(z.string().min(1)),
  vocabulary: z.object({
    partySingular: z.string(),
    partyPlural: z.string(),
    orderSingular: z.string(),
    branchSingular: z.string(),
    spaceSingular: z.string(),
    caseSingular: z.string(),
  }),
  currency: z.object({
    baseCurrency: z.string().min(3),
    operatingCurrencies: z.array(z.string().min(3)).min(1),
    rateSource: z.enum(['bcv', 'central_bank', 'manual']),
    enforceAccountCurrencyMatch: z.boolean(),
  }),
  entitlements: z.object({
    maxBranches: z.number().int().nonnegative(),
    maxPosRegisters: z.number().int().nonnegative(),
    maxSpacesOrUnits: z.number().int().nonnegative(),
    aiCopilotEnabled: z.boolean(),
    customEntitiesLimit: z.number().int().nonnegative(),
  }),
  federation: z.object({
    enabled: z.boolean(),
    nodeDid: z.string(),
    publishPublicCatalog: z.boolean(),
    acceptPeerB2BOrders: z.boolean(),
    consolidateLowStockHours: z.number().int().nonnegative(),
    allowedSupplierDids: z.array(z.string()),
  }),
  updatedAt: z.string(),
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

const apiKeySessionSchema = z.object({
  keyId: z.string().min(1),
  tenantId: z.string().min(1),
  orgId: z.string().min(1),
  orgPath: z.string().min(1),
  perms: z.array(z.string()),
  expiresAt: z.number().int().optional(),
});

export interface ProfileLoader {
  load(kv: KvStore): Promise<TenantMarketProfile>;
  invalidate(): void;
}

export function createProfileLoader(
  ttlMs: number = DEFAULT_PROFILE_TTL_MS,
): ProfileLoader {
  let cachedProfile: TenantMarketProfile | null = null;
  let expiresAtMs = 0;

  return {
    async load(kv: KvStore): Promise<TenantMarketProfile> {
      const now = Date.now();
      if (cachedProfile !== null && now < expiresAtMs) {
        return cachedProfile;
      }

      const raw = await kv.get(PROFILE_KEY, 'text');
      if (!raw) {
        throw new AppError(
          'PROFILE_UNAVAILABLE',
          503,
          'Tenant market profile is missing from CONFIG_KV',
        );
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        throw new AppError(
          'PROFILE_UNAVAILABLE',
          503,
          'Tenant market profile in CONFIG_KV is invalid JSON',
        );
      }

      const result = profileSchema.safeParse(parsedJson);
      if (!result.success) {
        throw new AppError(
          'PROFILE_UNAVAILABLE',
          503,
          'Tenant market profile failed schema validation',
          result.error.flatten(),
        );
      }

      cachedProfile = result.data;
      expiresAtMs = now + ttlMs;
      return cachedProfile;
    },
    invalidate(): void {
      cachedProfile = null;
      expiresAtMs = 0;
    },
  };
}

export function enforceModuleGate(
  profile: TenantMarketProfile,
  moduleId: string,
): void {
  if (!profile.activeModules.includes(moduleId)) {
    throw new AppError(
      'MODULE_NOT_ENABLED',
      403,
      `Module '${moduleId}' is not enabled in active market profile`,
    );
  }
}

export type AuthenticatedActor = ExecutionActor & {
  tenantId: string;
  orgId: string;
  orgPath: string;
};

async function authenticateDelegationPin(
  pin: string,
  requestedOrgId: string | null,
  sessionKv: KvStore,
): Promise<AuthenticatedActor> {
  const hash = await sha256Hex(pin.trim());
  const raw = await sessionKv.get(`delegation:${hash}`, 'text');
  if (!raw) {
    throw new AppError('INVALID_DELEGATION_PIN', 401, 'Invalid delegation PIN');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new AppError('INVALID_DELEGATION_PIN', 401, 'Corrupt delegation session');
  }

  const parsed = delegationSessionSchema.safeParse(parsedJson);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!parsed.success || parsed.data.expiresAt <= nowSec) {
    throw new AppError('INVALID_DELEGATION_PIN', 401, 'Delegation PIN expired');
  }

  if (requestedOrgId && requestedOrgId !== parsed.data.orgId) {
    throw new AppError(
      'INVALID_DELEGATION_PIN',
      401,
      'Delegation PIN not valid for target organization',
    );
  }

  return {
    id: parsed.data.userId,
    type: 'delegated_staff',
    perms: parsed.data.perms,
    delegatedById: parsed.data.delegatedById,
    tenantId: parsed.data.tenantId,
    orgId: parsed.data.orgId,
    orgPath: parsed.data.orgPath,
  };
}

async function authenticateApiKey(
  token: string,
  sessionKv: KvStore,
): Promise<AuthenticatedActor> {
  const hash = await sha256Hex(token);
  const raw = await sessionKv.get(`apikey:${hash}`, 'text');
  if (!raw) {
    throw new AppError('INVALID_API_KEY', 401, 'Invalid API key');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new AppError('INVALID_API_KEY', 401, 'Corrupt API key session');
  }

  const parsed = apiKeySessionSchema.safeParse(parsedJson);
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    !parsed.success ||
    (parsed.data.expiresAt !== undefined && parsed.data.expiresAt <= nowSec)
  ) {
    throw new AppError('INVALID_API_KEY', 401, 'API key expired or invalid');
  }

  return {
    id: parsed.data.keyId,
    type: 'api_key',
    perms: parsed.data.perms,
    tenantId: parsed.data.tenantId,
    orgId: parsed.data.orgId,
    orgPath: parsed.data.orgPath,
  };
}

export async function authenticateRequest(
  headers: Headers,
  sessionKv: KvStore,
  publicKeyJwk: JsonWebKey,
): Promise<AuthenticatedActor> {
  const delegationPin = headers.get('X-Delegation-Pin');
  if (delegationPin) {
    return authenticateDelegationPin(
      delegationPin,
      headers.get('X-Org-Id'),
      sessionKv,
    );
  }

  const authHeader = headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('UNAUTHORIZED', 401, 'Missing Bearer token or delegation PIN');
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new AppError('UNAUTHORIZED', 401, 'Empty Bearer token');
  }

  if (token.startsWith('mk_live_')) {
    return authenticateApiKey(token, sessionKv);
  }

  const claims = await verifyJwtEdDsa(token, publicKeyJwk);
  return {
    id: claims.sub,
    type: claims.actorType,
    perms: claims.perms,
    ...(claims.delegatedById ? { delegatedById: claims.delegatedById } : {}),
    tenantId: claims.tenantId,
    orgId: claims.orgId,
    orgPath: claims.orgPath,
  };
}
