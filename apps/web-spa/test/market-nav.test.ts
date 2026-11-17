import type { EditionPresetId } from '@shac/kernel';
import { EDITION_PRESETS } from '../../../editions/presets/src/presets-catalog';
import { describe, expect, it } from 'vitest';
import { resolveRouteDensity } from '../src/lib/marketProfile';
import { buildNavItems } from '../src/nav';

function visibleItemsForPreset(presetId: EditionPresetId) {
  const def = EDITION_PRESETS[presetId];
  const items = buildNavItems({
    editionPreset: def.id,
    activeModules: [...def.activeModules],
    vocabulary: def.vocabulary,
  });
  return items.filter(
    (item) =>
      (!item.moduleId || def.activeModules.includes(item.moduleId as never)) &&
      (!item.allowedPresets || item.allowedPresets.includes(def.id)),
  );
}

describe('@shac/web-spa MarketProfile, 5 Workstations & Route Density', () => {
  it('filters every specialized vertical preset down to 6–12 relevant items', () => {
    const specialized: EditionPresetId[] = [
      'retail-pos',
      'distro-wms',
      'tech-service',
      'hospitality-pms',
      'property-condo',
      'clinic-practice',
      'legal-psa',
      'industrial-gate',
    ];
    for (const presetId of specialized) {
      const visible = visibleItemsForPreset(presetId);
      expect(visible.length, `${presetId} count=${visible.length}`).toBeGreaterThanOrEqual(6);
      expect(visible.length, `${presetId} count=${visible.length}`).toBeLessThanOrEqual(12);
    }
  });

  it('isolates clinic-practice, legal-psa, property-condo, and distro-wms routes and chameleon labels', () => {
    const clinic = visibleItemsForPreset('clinic-practice').map((i) => ({ href: i.href, label: i.label }));
    expect(clinic.some((i) => i.href === '/clinical-ehr')).toBe(true);
    expect(clinic.find((i) => i.href === '/parties')?.label).toBe('Pacientes');
    expect(clinic.some((i) => ['/legal-hub', '/spaces', '/leases', '/pos', '/eudr'].includes(i.href))).toBe(false);

    const legal = visibleItemsForPreset('legal-psa').map((i) => ({ href: i.href, label: i.label }));
    expect(legal.some((i) => i.href === '/legal-hub')).toBe(true);
    expect(legal.find((i) => i.href === '/parties')?.label).toBe('Representados');
    expect(legal.some((i) => ['/clinical-ehr', '/spaces', '/pos', '/eudr'].includes(i.href))).toBe(false);

    const condo = visibleItemsForPreset('property-condo').map((i) => ({ href: i.href, label: i.label }));
    expect(condo.some((i) => i.href === '/leases')).toBe(true);
    expect(condo.find((i) => i.href === '/parties')?.label).toBe('Residentes-Inquilinos');
    expect(condo.some((i) => ['/spaces', '/pos', '/eudr'].includes(i.href))).toBe(false);

    const distro = visibleItemsForPreset('distro-wms').map((i) => ({ href: i.href, label: i.label }));
    expect(distro.find((i) => i.href === '/orders')?.label).toBe('Orden de Despacho');
    expect(distro.some((i) => i.href === '/quotes')).toBe(true);
    expect(distro.find((i) => i.href === '/claims')?.label).toBe('RMA');
  });

  it('resolves touch density on POS, Kiosk, Gatehouse, and Auth routes', () => {
    expect(resolveRouteDensity('/pos')).toBe('touch');
    expect(resolveRouteDensity('/physical')).toBe('touch');
    expect(resolveRouteDensity('/kiosk/price-check')).toBe('touch');
    expect(resolveRouteDensity('/auth')).toBe('touch');
    expect(resolveRouteDensity('/finance')).toBe('compact');
  });
});
