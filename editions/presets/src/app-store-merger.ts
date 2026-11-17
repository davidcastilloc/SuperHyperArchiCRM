import type {
  CurrencyProfile,
  EditionPresetId,
  MarketVocabulary,
  RegionPackId,
  TenantMarketProfile,
} from '@shac/kernel';
import { z } from 'zod';
import {
  FAMILY_PACKS,
  type FamilyPackDefinition,
  type FamilyPackId,
} from './family-packs.js';
import {
  EDITION_PRESETS,
  EditionPresetIdSchema,
  getDefaultCurrencyProfile,
  getEditionPreset,
  type EditionEntitlements,
  type EditionPresetDefinition,
} from './presets-catalog.js';

export const PROTECTED_MODULES = ['core', 'iam'] as const;

export interface BuildMarketProfileInput {
  deploymentId: string;
  tenantId: string;
  editionPreset: EditionPresetId;
  regionPack?: RegionPackId;
  extraModules?: readonly string[];
  vocabularyOverride?: Partial<MarketVocabulary>;
  currencyOverride?: Partial<CurrencyProfile>;
  entitlementsOverride?: Partial<EditionEntitlements>;
  federationOverride?: Partial<TenantMarketProfile['federation']>;
  updatedAt?: string;
}

export const MarketVocabularyOverrideSchema = z
  .object({
    partySingular: z.string().min(1),
    partyPlural: z.string().min(1),
    orderSingular: z.string().min(1),
    branchSingular: z.string().min(1),
    spaceSingular: z.string().min(1),
    caseSingular: z.string().min(1),
  })
  .partial();

export const AppStoreToggleSchema = z.object({
  enableModules: z.array(z.string().min(1)).optional(),
  disableModules: z.array(z.string().min(1)).optional(),
  switchPreset: EditionPresetIdSchema.optional(),
  presetMode: z.enum(['merge', 'replace']).optional(),
  vocabularyOverride: MarketVocabularyOverrideSchema.optional(),
  updatedAt: z.string().min(1).optional(),
});

export type AppStoreToggleInput = z.infer<typeof AppStoreToggleSchema>;

export interface EditionCatalogSummary {
  presets: readonly EditionPresetDefinition[];
  familyPacks: readonly FamilyPackDefinition[];
  protectedModules: readonly string[];
}

function normalizeActiveModules(modules: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const required of PROTECTED_MODULES) {
    seen.add(required);
    result.push(required);
  }

  for (const mod of modules) {
    const trimmed = mod.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}

export function buildMarketProfileFromPreset(
  input: BuildMarketProfileInput,
): TenantMarketProfile {
  const preset = getEditionPreset(input.editionPreset);
  const regionPack: RegionPackId = input.regionPack ?? 've';
  const defaultCurrency = getDefaultCurrencyProfile(regionPack);

  const activeModules = normalizeActiveModules([
    ...preset.activeModules,
    ...(input.extraModules ?? []),
  ]);

  const currency: CurrencyProfile = {
    ...defaultCurrency,
    ...input.currencyOverride,
    operatingCurrencies: input.currencyOverride?.operatingCurrencies
      ? [...input.currencyOverride.operatingCurrencies]
      : [...defaultCurrency.operatingCurrencies],
  };

  const federationDefaults: TenantMarketProfile['federation'] = {
    enabled: false,
    nodeDid: `did:shac:node:${input.deploymentId}`,
    publishPublicCatalog: false,
    acceptPeerB2BOrders: false,
    consolidateLowStockHours: 24,
    allowedSupplierDids: [],
  };

  const federation: TenantMarketProfile['federation'] = {
    ...federationDefaults,
    ...input.federationOverride,
    allowedSupplierDids: input.federationOverride?.allowedSupplierDids
      ? [...input.federationOverride.allowedSupplierDids]
      : [...federationDefaults.allowedSupplierDids],
  };

  return {
    deploymentId: input.deploymentId,
    tenantId: input.tenantId,
    editionPreset: preset.id,
    regionPack,
    activeModules,
    vocabulary: {
      ...preset.vocabulary,
      ...input.vocabularyOverride,
    },
    currency,
    entitlements: {
      ...preset.entitlements,
      ...input.entitlementsOverride,
    },
    federation,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export function applyAppStoreToggle(
  currentProfile: TenantMarketProfile,
  rawToggle: AppStoreToggleInput,
): TenantMarketProfile {
  const toggle = AppStoreToggleSchema.parse(rawToggle);
  const protectedSet = new Set<string>(PROTECTED_MODULES);
  const disabledSet = new Set<string>(
    (toggle.disableModules ?? []).filter((mod) => !protectedSet.has(mod)),
  );

  const isReplace = toggle.presetMode === 'replace' && Boolean(toggle.switchPreset);
  const targetPreset = toggle.switchPreset ? getEditionPreset(toggle.switchPreset) : null;

  const baseModules =
    isReplace && targetPreset
      ? targetPreset.activeModules
      : [...currentProfile.activeModules, ...(targetPreset?.activeModules ?? [])];

  const mergedModules = normalizeActiveModules([
    ...baseModules,
    ...(toggle.enableModules ?? []),
  ]).filter((mod) => protectedSet.has(mod) || !disabledSet.has(mod));

  const nextPreset: EditionPresetId = toggle.switchPreset ?? currentProfile.editionPreset;
  const baseVocabulary =
    isReplace && targetPreset ? targetPreset.vocabulary : currentProfile.vocabulary;
  const nextEntitlements =
    isReplace && targetPreset ? { ...targetPreset.entitlements } : { ...currentProfile.entitlements };

  return {
    deploymentId: currentProfile.deploymentId,
    tenantId: currentProfile.tenantId,
    editionPreset: nextPreset,
    regionPack: currentProfile.regionPack,
    activeModules: mergedModules,
    vocabulary: {
      ...baseVocabulary,
      ...toggle.vocabularyOverride,
    },
    currency: {
      ...currentProfile.currency,
      operatingCurrencies: [...currentProfile.currency.operatingCurrencies],
    },
    entitlements: nextEntitlements,
    federation: {
      ...currentProfile.federation,
      allowedSupplierDids: [...currentProfile.federation.allowedSupplierDids],
    },
    updatedAt: toggle.updatedAt ?? new Date().toISOString(),
  };
}

export function getEditionCatalogSummary(): EditionCatalogSummary {
  const presetKeys = Object.keys(EDITION_PRESETS) as EditionPresetId[];
  const packKeys = Object.keys(FAMILY_PACKS) as FamilyPackId[];

  return {
    presets: presetKeys.map((key) => EDITION_PRESETS[key]),
    familyPacks: packKeys.map((key) => FAMILY_PACKS[key]),
    protectedModules: [...PROTECTED_MODULES],
  };
}
