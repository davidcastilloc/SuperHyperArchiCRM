import { describe, expect, it } from 'vitest';
import {
  validateAndProjectCustomFields,
  type CustomFieldSpec,
} from '../src/lib/custom-fields-validator.js';

describe('@shac/mod-customers custom-fields-validator', () => {
  it('validates required/typed custom fields and emits filterable projections', () => {
    const specs: CustomFieldSpec[] = [
      { fieldKey: 'vip_tier', dataType: 'enum', required: true, enumOptions: ['gold', 'silver'], isFilterable: true },
      { fieldKey: 'credit_score', dataType: 'number', required: false, isFilterable: true },
      { fieldKey: 'newsletter', dataType: 'boolean', required: false, isFilterable: false },
      { fieldKey: 'notes', dataType: 'text', required: false, isFilterable: true },
    ];

    const rows = validateAndProjectCustomFields(specs, {
      vip_tier: 'gold',
      credit_score: 780,
      newsletter: true,
      notes: '  priority  ',
    });

    expect(rows).toEqual([
      { fieldKey: 'vip_tier', textVal: 'gold', numVal: null },
      { fieldKey: 'credit_score', textVal: null, numVal: 780 },
      { fieldKey: 'notes', textVal: 'priority', numVal: null },
    ]);

    expect(() => validateAndProjectCustomFields(specs, {})).toThrow(/CUSTOM_FIELD_REQUIRED/);
    expect(() =>
      validateAndProjectCustomFields(specs, { vip_tier: 'bronze' }),
    ).toThrow(/CUSTOM_FIELD_INVALID_ENUM/);
    expect(() =>
      validateAndProjectCustomFields(specs, { vip_tier: 'gold', credit_score: 'bad' }),
    ).toThrow(/CUSTOM_FIELD_INVALID_NUMBER/);
  });
});
