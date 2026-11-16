import { describe, expect, it } from 'vitest';
import {
  applyAppStoreToggle,
  buildMarketProfileFromPreset,
  CANONICAL_MODULE_IDS,
  EDITION_PRESET_IDS,
  EDITION_PRESETS,
  expandFamilyPacks,
  FAMILY_PACK_IDS,
  FAMILY_PACKS,
  getDefaultCurrencyProfile,
  getEditionCatalogSummary,
  getEditionPreset,
  getFamilyPackModules,
  PROTECTED_MODULES,
  REGION_PACK_IDS,
} from '../src/index.js';

describe('@shac/editions', () => {
  it('defines all 4 family packs covering every canonical module', () => {
    expect(FAMILY_PACK_IDS).toHaveLength(4);
    const expanded = expandFamilyPacks(FAMILY_PACK_IDS);

    for (const mod of CANONICAL_MODULE_IDS) {
      expect(expanded).toContain(mod);
    }

    for (const packId of FAMILY_PACK_IDS) {
      const modules = getFamilyPackModules(packId);
      expect(modules).toEqual([...FAMILY_PACKS[packId].modules]);
      expect(modules).toContain('core');
      expect(modules).toContain('iam');
    }
  });

  it('defines all 9 edition presets from SPEC.md §5 with valid modules and vocabulary', () => {
    expect(EDITION_PRESET_IDS).toHaveLength(9);

    for (const presetId of EDITION_PRESET_IDS) {
      const preset = getEditionPreset(presetId);
      expect(preset.id).toBe(presetId);
      expect(preset).toEqual(EDITION_PRESETS[presetId]);
      expect(preset.activeModules).toContain('core');
      expect(preset.activeModules).toContain('iam');
      expect(preset.vocabulary.partySingular.length).toBeGreaterThan(0);
      expect(preset.vocabulary.orderSingular.length).toBeGreaterThan(0);
      expect(preset.entitlements.maxBranches).toBeGreaterThan(0);
    }

    expect(getEditionPreset('omni-enterprise').activeModules).toEqual([
      ...CANONICAL_MODULE_IDS,
    ]);
  });

  it('provides default currency profiles for all 5 region packs', () => {
    expect(REGION_PACK_IDS).toEqual(['ve', 'co', 'mx', 'us', 'global']);
    expect(getDefaultCurrencyProfile('ve')).toEqual({
      baseCurrency: 'USD',
      operatingCurrencies: ['USD', 'VES', 'EUR'],
      rateSource: 'bcv',
      enforceAccountCurrencyMatch: true,
    });
    expect(getDefaultCurrencyProfile('co').baseCurrency).toBe('COP');
    expect(getDefaultCurrencyProfile('mx').baseCurrency).toBe('MXN');
    expect(getDefaultCurrencyProfile('us').baseCurrency).toBe('USD');
    expect(getDefaultCurrencyProfile('global').operatingCurrencies).toEqual(['USD', 'EUR']);
  });

  it('builds a TenantMarketProfile from a preset without losing overrides', () => {
    const profile = buildMarketProfileFromPreset({
      deploymentId: 'dep-001',
      tenantId: 'ten-001',
      editionPreset: 'retail-pos',
      regionPack: 've',
      extraModules: ['portal'],
      federationOverride: {
        enabled: true,
        publishPublicCatalog: true,
      },
      updatedAt: '2026-11-16T12:00:00.000Z',
    });

    expect(profile.deploymentId).toBe('dep-001');
    expect(profile.tenantId).toBe('ten-001');
    expect(profile.editionPreset).toBe('retail-pos');
    expect(profile.regionPack).toBe('ve');
    expect(profile.activeModules).toContain('pos');
    expect(profile.activeModules).toContain('portal');
    expect(profile.currency.rateSource).toBe('bcv');
    expect(profile.federation.enabled).toBe(true);
    expect(profile.federation.publishPublicCatalog).toBe(true);
    expect(profile.federation.nodeDid).toBe('did:shac:node:dep-001');
    expect(profile.updatedAt).toBe('2026-11-16T12:00:00.000Z');
  });

  it('live-merges retail-pos with clinic-practice modules while preserving identity, currency, and federation', () => {
    const initial = buildMarketProfileFromPreset({
      deploymentId: 'dep-live-1',
      tenantId: 'ten-live-1',
      editionPreset: 'retail-pos',
      regionPack: 've',
      federationOverride: {
        enabled: true,
        nodeDid: 'did:shac:node:custom-1',
        acceptPeerB2BOrders: true,
        allowedSupplierDids: ['did:shac:supplier:1'],
      },
      updatedAt: '2026-11-16T10:00:00.000Z',
    });

    const merged = applyAppStoreToggle(initial, {
      switchPreset: 'clinic-practice',
      enableModules: ['physical'],
      vocabularyOverride: {
        partySingular: 'Cliente / Paciente',
      },
      updatedAt: '2026-11-16T15:30:00.000Z',
    });

    // Identity, currency, and federation preserved
    expect(merged.deploymentId).toBe('dep-live-1');
    expect(merged.tenantId).toBe('ten-live-1');
    expect(merged.regionPack).toBe('ve');
    expect(merged.currency).toEqual(initial.currency);
    expect(merged.federation).toEqual(initial.federation);

    // Existing retail-pos modules preserved + clinic-practice & extra modules added
    expect(merged.activeModules).toContain('pos');
    expect(merged.activeModules).toContain('regional');
    expect(merged.activeModules).toContain('wms');
    expect(merged.activeModules).toContain('cases');
    expect(merged.activeModules).toContain('spaces');
    expect(merged.activeModules).toContain('services');
    expect(merged.activeModules).toContain('automation');
    expect(merged.activeModules).toContain('physical');

    // Vocabulary override merged without wiping other fields
    expect(merged.vocabulary.partySingular).toBe('Cliente / Paciente');
    expect(merged.vocabulary.orderSingular).toBe(initial.vocabulary.orderSingular);
    expect(merged.editionPreset).toBe('clinic-practice');
    expect(merged.updatedAt).toBe('2026-11-16T15:30:00.000Z');
  });

  it('prevents removal of core and iam modules when disabling modules', () => {
    const initial = buildMarketProfileFromPreset({
      deploymentId: 'dep-guard',
      tenantId: 'ten-guard',
      editionPreset: 'retail-pos',
    });

    const updated = applyAppStoreToggle(initial, {
      disableModules: ['core', 'iam', 'pos'],
      updatedAt: '2026-11-16T16:00:00.000Z',
    });

    for (const protectedMod of PROTECTED_MODULES) {
      expect(updated.activeModules).toContain(protectedMod);
    }
    expect(updated.activeModules).not.toContain('pos');
    expect(updated.activeModules).toContain('customers');
  });

  it('returns complete catalog summary for App Store and Control Plane', () => {
    const summary = getEditionCatalogSummary();
    expect(summary.presets).toHaveLength(9);
    expect(summary.familyPacks).toHaveLength(4);
    expect(summary.protectedModules).toEqual(['core', 'iam']);
  });
});
