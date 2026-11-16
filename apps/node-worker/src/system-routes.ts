import type { ShacD1Database } from '@shac/db-d1';
import {
  applyAppStoreToggle,
  AppStoreToggleSchema,
  getEditionCatalogSummary,
  type AppStoreToggleInput,
  type EditionCatalogSummary,
} from '@shac/editions';
import {
  AppError,
  type CommandSpec,
  type ProfileLoader,
  type TenantMarketProfile,
} from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv, WorkerEnv } from './command-registry.js';

let profileInvalidator: (() => void) | undefined;

interface ApplianceLicenseInput {
  licenseId: string;
  deploymentId: string;
  hardwareFingerprint: string;
  editionPreset?: string;
  issuedAt: number;
  expiresAt: number | null;
  revokedAt?: number | null;
  hmacSignature: string;
}

interface ApplianceLicenseVerifyResult {
  valid: boolean;
  reason: string;
  licenseId: string;
  deploymentId: string;
}

type VerifyLicenseFn = (
  license: ApplianceLicenseInput & { revokedAt: number | null },
  secret: string,
  expectedFingerprint: string,
  nowSec?: number,
) => Promise<ApplianceLicenseVerifyResult>;

let licenseVerifier: VerifyLicenseFn | undefined;

/** Registers the worker's active ProfileLoader invalidator for App Store hot-switches. */
export function setProfileInvalidator(fn: () => void): void {
  profileInvalidator = fn;
}

/** Registers the HMAC appliance license verifier from @shac/control-plane. */
export function setLicenseVerifier(fn: VerifyLicenseFn): void {
  licenseVerifier = fn;
}

const EmptyQuerySchema = z.object({});

const SignedLicenseSchema = z.object({
  licenseId: z.string().min(1),
  deploymentId: z.string().min(1),
  hardwareFingerprint: z.string().min(1),
  editionPreset: z.string().min(1).optional(),
  issuedAt: z.number().int(),
  expiresAt: z.number().int().nullable(),
  revokedAt: z.number().int().nullable().optional(),
  hmacSignature: z.string().min(1),
});

const LicenseVerifyBodySchema = z.object({
  license: SignedLicenseSchema,
  expectedFingerprint: z.string().min(1).optional(),
  nowSec: z.number().int().optional(),
});

export interface SystemGetProfileResult {
  profile: TenantMarketProfile;
  catalog: EditionCatalogSummary;
}

export interface SystemAppStoreToggleResult {
  ok: true;
  profile: TenantMarketProfile;
  previousRevision: string;
}

/** Returns the active TenantMarketProfile and full 9-preset edition catalog. */
export const systemGetProfileCommand: CommandSpec<
  typeof EmptyQuerySchema,
  SystemGetProfileResult,
  ShacD1Database
> = {
  id: 'system.app_store.get_profile',
  moduleId: 'core',
  method: 'GET',
  path: '/api/system/profile',
  summary: 'Get active TenantMarketProfile and edition catalog summary',
  requiredPermission: 'iam.orgs.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    idempotentHint: true,
    description: 'Read active market profile, active modules, vocabulary, and 9-preset catalog',
  },
  inputSchema: EmptyQuerySchema,
  outputSchema: z.custom<SystemGetProfileResult>(),
  async handler(ctx) {
    return {
      profile: ctx.profile,
      catalog: getEditionCatalogSummary(),
    };
  },
};

/** Hot-switches active modules, edition preset, or vocabulary in CONFIG_KV (0 ms). */
export const systemAppStoreToggleCommand: CommandSpec<
  typeof AppStoreToggleSchema,
  SystemAppStoreToggleResult,
  ShacD1Database
> = {
  id: 'system.app_store.toggle_modules',
  moduleId: 'core',
  method: 'POST',
  path: '/api/system/app-store/toggle',
  summary: 'Hot-switch active modules, preset, or vocabulary in CONFIG_KV',
  requiredPermission: 'iam.orgs.write',
  mcp: {
    expose: true,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    description: 'Toggle SHAC modules or switch edition preset in CONFIG_KV with immediate cache invalidation',
  },
  inputSchema: AppStoreToggleSchema,
  outputSchema: z.custom<SystemAppStoreToggleResult>(),
  async handler(ctx, input: AppStoreToggleInput) {
    if (!ctx.configKv?.put) {
      throw new AppError('CONFIG_KV_MISSING', 500, 'CONFIG_KV binding is not configured');
    }
    const previousRevision = ctx.profile.updatedAt;
    const nextProfile = applyAppStoreToggle(ctx.profile, input);
    await ctx.configKv.put('profile:current', JSON.stringify(nextProfile));
    profileInvalidator?.();
    return {
      ok: true,
      profile: nextProfile,
      previousRevision,
    };
  },
};

export const PHASE4_SYSTEM_COMMANDS = [
  systemGetProfileCommand,
  systemAppStoreToggleCommand,
] as const;

type AuthenticateActorFn = (
  env: WorkerEnv,
  rawHeaders: Headers,
  profileLoader: ProfileLoader,
  moduleId: string,
  requiredPermission: string,
) => Promise<{ profile: TenantMarketProfile }>;

/** Mounts /reload-profile and /license/verify under /api/system. */
export function createSystemRoutes(
  profileLoader: ProfileLoader,
  authenticateActor?: AuthenticateActorFn,
): Hono<HonoEnv> {
  return new Hono<HonoEnv>()
    .post('/reload-profile', async (c) => {
      if (authenticateActor) {
        await authenticateActor(
          c.env,
          c.req.raw.headers,
          profileLoader,
          'core',
          'iam.orgs.write',
        );
      }
      profileLoader.invalidate();
      const profile = await profileLoader.load(c.env.CONFIG_KV);
      return c.json({ ok: true, reloaded: true, profile }, 200);
    })
    .post('/license/verify', async (c) => {
      let rawBody: unknown;
      try {
        rawBody = await c.req.json();
      } catch {
        throw new AppError('BAD_REQUEST', 400, 'Invalid JSON request body');
      }
      const parsed = LicenseVerifyBodySchema.safeParse(rawBody);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          400,
          'Invalid license verification payload',
          parsed.error.flatten(),
        );
      }
      if (!licenseVerifier) {
        throw new AppError(
          'LICENSE_VERIFIER_UNAVAILABLE',
          500,
          'License verifier is not configured',
        );
      }
      const { license, expectedFingerprint, nowSec } = parsed.data;
      const secret = c.env.LICENSE_HMAC_SECRET ?? 'shac-dev-hmac-secret';
      const result = await licenseVerifier(
        {
          ...license,
          revokedAt: license.revokedAt ?? null,
        },
        secret,
        expectedFingerprint ?? license.hardwareFingerprint,
        nowSec,
      );
      if (!result.valid) {
        return c.json(
          {
            ...result,
            error: {
              code: 'LICENSE_INVALID',
              message: `Appliance license rejected: ${result.reason}`,
              details: result,
            },
          },
          403,
        );
      }
      return c.json(result, 200);
    });
}
