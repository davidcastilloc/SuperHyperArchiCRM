import { AppError, type KvStore, type TenantMarketProfile } from '@shac/kernel';
import {
  AppStoreToggleSchema,
  EditionPresetIdSchema,
  RegionPackIdSchema,
  applyAppStoreToggle,
  buildMarketProfileFromPreset,
  getEditionPreset,
  type AppStoreToggleInput,
} from '@shac/editions';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';
import { cpDeployments, cpMarketProfiles } from './schema.js';
import type { HostingMode } from './telemetry-and-rollout.js';

export type ControlPlaneDb = ReturnType<typeof drizzle>;

export const ProvisionDeploymentSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  tenantId: z.string().min(1),
  companyName: z.string().min(1),
  hostingMode: z
    .enum(['BYOC_FREE', 'SAAS_MULTI_D1', 'HYBRID_APPLIANCE'])
    .default('BYOC_FREE'),
  editionPreset: EditionPresetIdSchema.default('retail-pos'),
  regionPack: RegionPackIdSchema.default('ve'),
  cfAccountId: z.string().min(1).optional(),
  d1DatabaseId: z.string().min(1).optional(),
  releaseChannel: z.enum(['canary', 'stable']).default('stable'),
  currentVersion: z.string().min(1).default('1.0.0'),
  extraModules: z.array(z.string().min(1)).optional(),
});

export type ProvisionDeploymentInput = z.infer<typeof ProvisionDeploymentSchema>;

export interface ProvisionedDeploymentResult {
  deployment: {
    id: string;
    slug: string;
    tenantId: string;
    companyName: string;
    hostingMode: HostingMode;
    cfAccountId: string | null;
    d1DatabaseId: string;
    configKvKey: string;
    releaseChannel: 'canary' | 'stable';
    currentVersion: string;
    status: string;
  };
  profile: TenantMarketProfile;
  revision: number;
}

function makeKvKey(tenantId: string, deploymentId: string): string {
  return `tenant:${tenantId}:deployment:${deploymentId}:market_profile`;
}

async function syncProfileToKv(
  configKv: KvStore | undefined,
  kvKey: string,
  profile: TenantMarketProfile,
): Promise<void> {
  if (configKv?.put) {
    await configKv.put(kvKey, JSON.stringify(profile));
  }
}

export async function provisionDeployment(
  db: ControlPlaneDb,
  configKv: KvStore | undefined,
  rawInput: ProvisionDeploymentInput,
): Promise<ProvisionedDeploymentResult> {
  const input = ProvisionDeploymentSchema.parse(rawInput);
  const existing = await db
    .select({ id: cpDeployments.id })
    .from(cpDeployments)
    .where(eq(cpDeployments.slug, input.slug))
    .get();

  if (existing) {
    throw new AppError(
      'DEPLOYMENT_SLUG_CONFLICT',
      409,
      `Deployment slug '${input.slug}' already exists`,
    );
  }

  const now = new Date().toISOString();
  const deploymentId = `dep_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const d1DatabaseId =
    input.d1DatabaseId ??
    `d1_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const configKvKey = makeKvKey(input.tenantId, deploymentId);

  const profile = buildMarketProfileFromPreset({
    deploymentId,
    tenantId: input.tenantId,
    editionPreset: input.editionPreset,
    regionPack: input.regionPack,
    extraModules: input.extraModules,
    updatedAt: now,
  });

  const presetDef = getEditionPreset(input.editionPreset);

  await db.insert(cpDeployments).values({
    id: deploymentId,
    slug: input.slug,
    tenantId: input.tenantId,
    companyName: input.companyName,
    hostingMode: input.hostingMode,
    cfAccountId: input.cfAccountId ?? null,
    d1DatabaseId,
    configKvKey,
    releaseChannel: input.releaseChannel,
    currentVersion: input.currentVersion,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(cpMarketProfiles).values({
    deploymentId,
    presetId: profile.editionPreset,
    regionPack: profile.regionPack,
    activePacksJson: JSON.stringify(presetDef.familyPacks),
    activeModulesJson: JSON.stringify(profile.activeModules),
    vocabularyJson: JSON.stringify(profile.vocabulary),
    currencyJson: JSON.stringify(profile.currency),
    entitlementsJson: JSON.stringify(profile.entitlements),
    federationJson: JSON.stringify(profile.federation),
    revision: 1,
    updatedAt: now,
  });

  await syncProfileToKv(configKv, configKvKey, profile);

  return {
    deployment: {
      id: deploymentId,
      slug: input.slug,
      tenantId: input.tenantId,
      companyName: input.companyName,
      hostingMode: input.hostingMode,
      cfAccountId: input.cfAccountId ?? null,
      d1DatabaseId,
      configKvKey,
      releaseChannel: input.releaseChannel,
      currentVersion: input.currentVersion,
      status: 'active',
    },
    profile,
    revision: 1,
  };
}

function hydrateProfile(
  deploymentId: string,
  tenantId: string,
  row: typeof cpMarketProfiles.$inferSelect,
): TenantMarketProfile {
  return {
    deploymentId,
    tenantId,
    editionPreset: row.presetId as TenantMarketProfile['editionPreset'],
    regionPack: row.regionPack as TenantMarketProfile['regionPack'],
    activeModules: JSON.parse(row.activeModulesJson) as string[],
    vocabulary: JSON.parse(row.vocabularyJson) as TenantMarketProfile['vocabulary'],
    currency: JSON.parse(row.currencyJson) as TenantMarketProfile['currency'],
    entitlements: JSON.parse(
      row.entitlementsJson,
    ) as TenantMarketProfile['entitlements'],
    federation: JSON.parse(row.federationJson) as TenantMarketProfile['federation'],
    updatedAt: row.updatedAt,
  };
}

export async function toggleDeploymentAppStore(
  db: ControlPlaneDb,
  configKv: KvStore | undefined,
  deploymentId: string,
  rawToggle: AppStoreToggleInput,
): Promise<{
  deploymentId: string;
  configKvKey: string;
  profile: TenantMarketProfile;
  revision: number;
}> {
  const toggle = AppStoreToggleSchema.parse(rawToggle);

  const deployment = await db
    .select()
    .from(cpDeployments)
    .where(eq(cpDeployments.id, deploymentId))
    .get();

  if (!deployment) {
    throw new AppError(
      'DEPLOYMENT_NOT_FOUND',
      404,
      `Deployment '${deploymentId}' not found`,
    );
  }

  const profileRow = await db
    .select()
    .from(cpMarketProfiles)
    .where(eq(cpMarketProfiles.deploymentId, deploymentId))
    .get();

  if (!profileRow) {
    throw new AppError(
      'PROFILE_NOT_FOUND',
      404,
      `Market profile for '${deploymentId}' not found`,
    );
  }

  const currentProfile = hydrateProfile(deploymentId, deployment.tenantId, profileRow);
  const nextProfile = applyAppStoreToggle(currentProfile, toggle);
  const nextRevision = profileRow.revision + 1;
  const presetDef = getEditionPreset(nextProfile.editionPreset);

  await db
    .update(cpMarketProfiles)
    .set({
      presetId: nextProfile.editionPreset,
      activePacksJson: JSON.stringify(presetDef.familyPacks),
      activeModulesJson: JSON.stringify(nextProfile.activeModules),
      vocabularyJson: JSON.stringify(nextProfile.vocabulary),
      currencyJson: JSON.stringify(nextProfile.currency),
      entitlementsJson: JSON.stringify(nextProfile.entitlements),
      federationJson: JSON.stringify(nextProfile.federation),
      revision: nextRevision,
      updatedAt: nextProfile.updatedAt,
    })
    .where(eq(cpMarketProfiles.deploymentId, deploymentId));

  await db
    .update(cpDeployments)
    .set({ updatedAt: nextProfile.updatedAt })
    .where(eq(cpDeployments.id, deploymentId));

  await syncProfileToKv(configKv, deployment.configKvKey, nextProfile);

  return {
    deploymentId,
    configKvKey: deployment.configKvKey,
    profile: nextProfile,
    revision: nextRevision,
  };
}
