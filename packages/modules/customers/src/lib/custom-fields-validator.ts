export type CustomFieldDataType = 'text' | 'number' | 'boolean' | 'date' | 'enum';

export interface CustomFieldSpec {
  readonly fieldKey: string;
  readonly dataType: CustomFieldDataType;
  readonly required: boolean;
  readonly enumOptions?: readonly string[];
  readonly isFilterable?: boolean;
}

export interface CustomFieldProjectionRow {
  readonly fieldKey: string;
  readonly textVal: string | null;
  readonly numVal: number | null;
}

export function validateAndProjectCustomFields(
  specs: readonly CustomFieldSpec[],
  values: Record<string, unknown> | null | undefined,
): CustomFieldProjectionRow[] {
  const safeValues = values ?? {};
  const projections: CustomFieldProjectionRow[] = [];

  for (const spec of specs) {
    const raw = safeValues[spec.fieldKey];
    if (raw === undefined || raw === null || raw === '') {
      if (spec.required) {
        throw new Error(`CUSTOM_FIELD_REQUIRED: ${spec.fieldKey}`);
      }
      continue;
    }

    switch (spec.dataType) {
      case 'number': {
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          throw new Error(`CUSTOM_FIELD_INVALID_NUMBER: ${spec.fieldKey}`);
        }
        if (spec.isFilterable) {
          projections.push({ fieldKey: spec.fieldKey, textVal: null, numVal: raw });
        }
        break;
      }
      case 'boolean': {
        if (typeof raw !== 'boolean') {
          throw new Error(`CUSTOM_FIELD_INVALID_BOOLEAN: ${spec.fieldKey}`);
        }
        if (spec.isFilterable) {
          projections.push({
            fieldKey: spec.fieldKey,
            textVal: raw ? 'true' : 'false',
            numVal: raw ? 1 : 0,
          });
        }
        break;
      }
      case 'enum': {
        if (
          typeof raw !== 'string' ||
          (spec.enumOptions && !spec.enumOptions.includes(raw))
        ) {
          throw new Error(`CUSTOM_FIELD_INVALID_ENUM: ${spec.fieldKey}`);
        }
        if (spec.isFilterable) {
          projections.push({ fieldKey: spec.fieldKey, textVal: raw, numVal: null });
        }
        break;
      }
      case 'date':
      case 'text': {
        if (typeof raw !== 'string') {
          throw new Error(`CUSTOM_FIELD_INVALID_TEXT: ${spec.fieldKey}`);
        }
        if (spec.isFilterable) {
          projections.push({
            fieldKey: spec.fieldKey,
            textVal: raw.trim(),
            numVal: null,
          });
        }
        break;
      }
    }
  }

  return projections;
}
