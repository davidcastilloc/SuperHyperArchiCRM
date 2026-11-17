import { describe, expect, it } from 'vitest';
import { computeUiSplitPreview } from '../src/views/SplitRentLeaseModal';

describe('Condo Split Rent, Helios QR/PIN & Demo Playbooks UX', () => {
  it('validates Split Rent shares summing to 10000 bps (100.00%) in integer math', () => {
    expect(
      computeUiSplitPreview(100_000, [
        { partyId: 'p1', percentInput: '60' },
        { partyId: 'p2', percentInput: '40' },
      ]),
    ).toEqual({
      valid: true,
      totalBps: 10_000,
      allocations: [
        { partyId: 'p1', shareBps: 6_000, amountMinor: 60_000 },
        { partyId: 'p2', shareBps: 4_000, amountMinor: 40_000 },
      ],
    });

    const invalid = computeUiSplitPreview(100_000, [
      { partyId: 'p1', percentInput: '50' },
      { partyId: 'p2', percentInput: '40' },
    ]);
    expect(invalid.valid).toBe(false);
    expect(invalid.totalBps).toBe(9_000);
  });

  it('builds encoded WhatsApp pass share URL with visitor, PIN, and branch', async () => {
    const { buildWhatsAppPassUrl } = await import('../src/views/HeliosPassAndLprModal.js');
    const url = buildWhatsAppPassUrl('Juan Pérez', 'A9F3K2P1', 'Parque Norte');
    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
    const decoded = decodeURIComponent(url.replace('https://wa.me/?text=', ''));
    expect(decoded).toContain('A9F3K2P1');
    expect(decoded).toContain('Parque Norte');
  });

  it('covers all 6+ industry presets in DEMO_PERSONAS and SOP_CHEAT_SHEETS, and executes real RPC steps without fabricating logs', async () => {
    const demoMod = await import('../src/lib/demoScenarios.js');
    const validPresets = new Set([
      'retail-pos',
      'distro-wms',
      'tech-service',
      'hospitality-pms',
      'property-condo',
      'clinic-practice',
      'legal-psa',
      'industrial-gate',
      'omni-enterprise',
    ]);
    expect(demoMod.DEMO_PERSONAS.length).toBeGreaterThanOrEqual(6);
    for (const persona of demoMod.DEMO_PERSONAS) {
      expect(validPresets.has(persona.presetId)).toBe(true);
    }
    expect(demoMod.SOP_CHEAT_SHEETS.length).toBeGreaterThanOrEqual(6);

    const mockRpc = {
      api: {
        wms: {
          'catalog-csv-import': {
            $post: async () => ({
              ok: true,
              json: async () => ({ importedCount: 3 }),
            }),
          },
        },
      },
    };
    const okLine = await demoMod.executeLiveScenarioStep(mockRpc as never, 'retail-pos-fefo', 0);
    expect(okLine).toContain('POST /api/wms/catalog-csv-import');

    const failRpc = {
      api: {
        wms: {
          'catalog-csv-import': {
            $post: async () => ({
              ok: false,
              status: 403,
              json: async () => ({ error: { message: 'Módulo no habilitado' } }),
            }),
          },
        },
      },
    };
    await expect(
      demoMod.executeLiveScenarioStep(failRpc as never, 'retail-pos-fefo', 0),
    ).rejects.toThrow(/Módulo no habilitado|403/);
  });

  it('serializes non-empty workflow steps and rejects empty step lists', async () => {
    const wfMod = await import('../src/views/WorkflowsVisualView.js');
    const serialized = wfMod.serializeWorkflowSteps([
      { id: 's1', label: 'Validar Stock', kind: 'check' },
    ]);
    const parsed = JSON.parse(serialized) as Array<{ id: string; label: string; kind: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({ id: 's1', label: 'Validar Stock', kind: 'check' });
    expect(() => wfMod.serializeWorkflowSteps([])).toThrow(/al menos un paso/i);
  });
});
