import { describe, expect, it } from 'vitest';
import { classifyFefoLotStatus } from '../src/views/WmsView';

describe('WMS FEFO LotBadge & RMA Stepper UX', () => {
  it('classifies expired, quarantined, <=30d FEFO warning, and valid lots', () => {
    const nowMs = 1_700_000_000_000;
    expect(classifyFefoLotStatus(nowMs - 86_400_000, 'AVAILABLE', nowMs)).toEqual({
      label: 'BLOQUEADO · Vencido',
      tone: 'error',
      selectable: false,
    });
    expect(classifyFefoLotStatus(nowMs + 50 * 86_400_000, 'QUARANTINE', nowMs)).toEqual({
      label: 'BLOQUEADO · Cuarentena',
      tone: 'error',
      selectable: false,
    });
    expect(classifyFefoLotStatus(nowMs + 18 * 86_400_000, 'AVAILABLE', nowMs)).toEqual({
      label: 'FEFO · Vence 18d',
      tone: 'warning',
      selectable: true,
    });
    expect(classifyFefoLotStatus(nowMs + 120 * 86_400_000, 'AVAILABLE', nowMs)).toEqual({
      label: 'Vigente',
      tone: 'success',
      selectable: true,
    });
  });
});
