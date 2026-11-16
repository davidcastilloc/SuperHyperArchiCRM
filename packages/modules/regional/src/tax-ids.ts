import { AppError, type RegionPackId } from '@shac/kernel';

export const REGIONAL_TAX_ID_TYPES = [
  'RIF',
  'CEDULA',
  'NIT',
  'CC',
  'RFC',
  'EIN',
  'PASSPORT',
  'VAT',
] as const;

export type RegionalTaxIdType = (typeof REGIONAL_TAX_ID_TYPES)[number];

export interface ValidatedTaxId {
  regionPack: RegionPackId;
  taxIdType: RegionalTaxIdType;
  normalized: string;
  formatted: string;
  checkDigit: string | null;
  isValid: true;
}

const REGION_PACKS = new Set<RegionPackId>(['ve', 'co', 'mx', 'us', 'global']);
const CO_NIT_PRIMES = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;
const VE_RIF_RE = /^[JVEG]\d{9}$/;
const VE_CEDULA_RE = /^(?:[VE])?\d{6,9}$/;
const CO_NIT_RE = /^\d{7,15}$/;
const CO_CC_RE = /^\d{5,11}$/;
const MX_RFC_MORAL_RE = /^[A-ZÑ&]{3}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z0-9]{3}$/;
const MX_RFC_FISICA_RE = /^[A-ZÑ&]{4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z0-9]{3}$/;
const US_EIN_INPUT_RE = /^(?:\d{2}-\d{7}|\d{9})$/;
const GLOBAL_DOC_RE = /^[A-Z0-9]{5,24}$/;

function failTaxId(message: string, details?: Record<string, unknown>): never {
  throw new AppError('INVALID_TAX_ID', 422, message, details);
}

function stripSeparators(rawValue: string): string {
  return rawValue.trim().toUpperCase().replace(/[\s.-]+/g, '');
}

/**
 * Computes the official DIAN Modulo-11 verification digit for a Colombian NIT base.
 */
export function computeCoNitCheckDigit(baseDigits: string): number {
  if (!/^\d{6,14}$/.test(baseDigits)) {
    failTaxId('Colombian NIT base must contain 6 to 14 numeric digits');
  }
  let sum = 0;
  const len = baseDigits.length;
  for (let idx = 0; idx < len; idx += 1) {
    const digit = Number(baseDigits[len - 1 - idx]);
    const weight = CO_NIT_PRIMES[idx];
    if (weight === undefined) {
      failTaxId('Colombian NIT exceeds maximum supported digit length');
    }
    sum += digit * weight;
  }
  const remainder = sum % 11;
  return remainder === 0 || remainder === 1 ? remainder : 11 - remainder;
}

function validateVeTaxId(
  taxIdType: RegionalTaxIdType,
  rawValue: string,
): ValidatedTaxId {
  const cleaned = stripSeparators(rawValue);
  if (taxIdType === 'RIF') {
    if (!VE_RIF_RE.test(cleaned)) {
      failTaxId('Invalid Venezuelan RIF; expected J/V/E/G followed by 9 digits', {
        regionPack: 've',
        taxIdType,
      });
    }
    const prefix = cleaned.slice(0, 1);
    const body = cleaned.slice(1, 9);
    const dv = cleaned.slice(9);
    return {
      regionPack: 've',
      taxIdType,
      normalized: cleaned,
      formatted: `${prefix}-${body}-${dv}`,
      checkDigit: dv,
      isValid: true,
    };
  }
  if (taxIdType === 'CEDULA') {
    if (!VE_CEDULA_RE.test(cleaned)) {
      failTaxId('Invalid Venezuelan Cédula; expected optional V/E and 6 to 9 digits', {
        regionPack: 've',
        taxIdType,
      });
    }
    const hasPrefix = cleaned.startsWith('V') || cleaned.startsWith('E');
    const formatted = hasPrefix ? `${cleaned[0]}-${cleaned.slice(1)}` : cleaned;
    return {
      regionPack: 've',
      taxIdType,
      normalized: cleaned,
      formatted,
      checkDigit: null,
      isValid: true,
    };
  }
  return failTaxId(`Unsupported tax ID type '${taxIdType}' for regionPack 've'`);
}

function validateCoTaxId(
  taxIdType: RegionalTaxIdType,
  rawValue: string,
): ValidatedTaxId {
  const cleaned = stripSeparators(rawValue);
  if (taxIdType === 'NIT') {
    if (!CO_NIT_RE.test(cleaned)) {
      failTaxId('Invalid Colombian NIT; expected 6-14 base digits plus check digit', {
        regionPack: 'co',
        taxIdType,
      });
    }
    const base = cleaned.slice(0, -1);
    const actualDv = Number(cleaned.slice(-1));
    const expectedDv = computeCoNitCheckDigit(base);
    if (actualDv !== expectedDv) {
      failTaxId('Invalid Colombian NIT Modulo-11 check digit', {
        regionPack: 'co',
        taxIdType,
        expectedCheckDigit: expectedDv,
      });
    }
    return {
      regionPack: 'co',
      taxIdType,
      normalized: cleaned,
      formatted: `${base}-${actualDv}`,
      checkDigit: String(actualDv),
      isValid: true,
    };
  }
  if (taxIdType === 'CC' || taxIdType === 'CEDULA') {
    if (!CO_CC_RE.test(cleaned)) {
      failTaxId('Invalid Colombian Cédula de Ciudadanía; expected 5 to 11 digits', {
        regionPack: 'co',
        taxIdType,
      });
    }
    return {
      regionPack: 'co',
      taxIdType,
      normalized: cleaned,
      formatted: cleaned,
      checkDigit: null,
      isValid: true,
    };
  }
  return failTaxId(`Unsupported tax ID type '${taxIdType}' for regionPack 'co'`);
}

function validateMxTaxId(
  taxIdType: RegionalTaxIdType,
  rawValue: string,
): ValidatedTaxId {
  if (taxIdType !== 'RFC') {
    failTaxId(`Unsupported tax ID type '${taxIdType}' for regionPack 'mx'`);
  }
  const cleaned = stripSeparators(rawValue);
  const valid =
    (cleaned.length === 12 && MX_RFC_MORAL_RE.test(cleaned)) ||
    (cleaned.length === 13 && MX_RFC_FISICA_RE.test(cleaned));
  if (!valid) {
    failTaxId('Invalid Mexican RFC; expected 12 (moral) or 13 (física) valid chars', {
      regionPack: 'mx',
      taxIdType,
    });
  }
  return {
    regionPack: 'mx',
    taxIdType,
    normalized: cleaned,
    formatted: cleaned,
    checkDigit: null,
    isValid: true,
  };
}

function validateUsTaxId(
  taxIdType: RegionalTaxIdType,
  rawValue: string,
): ValidatedTaxId {
  if (taxIdType !== 'EIN') {
    failTaxId(`Unsupported tax ID type '${taxIdType}' for regionPack 'us'`);
  }
  const trimmed = rawValue.trim();
  if (!US_EIN_INPUT_RE.test(trimmed)) {
    failTaxId('Invalid US EIN; expected XX-XXXXXXX or 9 digits', {
      regionPack: 'us',
      taxIdType,
    });
  }
  const digits = trimmed.replace(/-/g, '');
  if (digits === '000000000') {
    failTaxId('Invalid US EIN; all-zero EIN is not permitted', {
      regionPack: 'us',
      taxIdType,
    });
  }
  return {
    regionPack: 'us',
    taxIdType,
    normalized: digits,
    formatted: `${digits.slice(0, 2)}-${digits.slice(2)}`,
    checkDigit: null,
    isValid: true,
  };
}

function validateGlobalTaxId(
  taxIdType: RegionalTaxIdType,
  rawValue: string,
): ValidatedTaxId {
  if (taxIdType === 'RIF' || taxIdType === 'CEDULA') {
    return { ...validateVeTaxId(taxIdType, rawValue), regionPack: 'global' };
  }
  if (taxIdType === 'NIT' || taxIdType === 'CC') {
    return { ...validateCoTaxId(taxIdType, rawValue), regionPack: 'global' };
  }
  if (taxIdType === 'RFC') {
    return { ...validateMxTaxId(taxIdType, rawValue), regionPack: 'global' };
  }
  if (taxIdType === 'EIN') {
    return { ...validateUsTaxId(taxIdType, rawValue), regionPack: 'global' };
  }
  const cleaned = stripSeparators(rawValue);
  if (!GLOBAL_DOC_RE.test(cleaned)) {
    failTaxId('Invalid global tax or passport identifier', {
      regionPack: 'global',
      taxIdType,
    });
  }
  return {
    regionPack: 'global',
    taxIdType,
    normalized: cleaned,
    formatted: cleaned,
    checkDigit: null,
    isValid: true,
  };
}

/**
 * Normalizes and validates regional tax identifiers across `ve`, `co`, `mx`, `us`, and `global`.
 * Throws `AppError('INVALID_TAX_ID', 422, ...)` on malformed values or invalid check digits.
 */
export function validateRegionalTaxId(
  countryOrPack: RegionPackId | string,
  taxIdType: string,
  rawValue: string,
): ValidatedTaxId {
  const normalizedPack = countryOrPack.trim().toLowerCase() as RegionPackId;
  if (!REGION_PACKS.has(normalizedPack)) {
    failTaxId(`Unsupported regionPack '${countryOrPack}'`);
  }

  const normalizedType = taxIdType.trim().toUpperCase() as RegionalTaxIdType;
  if (!(REGIONAL_TAX_ID_TYPES as readonly string[]).includes(normalizedType)) {
    failTaxId(`Unsupported tax ID type '${taxIdType}'`);
  }

  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    failTaxId('Tax ID value must be a non-empty string');
  }

  switch (normalizedPack) {
    case 've':
      return validateVeTaxId(normalizedType, rawValue);
    case 'co':
      return validateCoTaxId(normalizedType, rawValue);
    case 'mx':
      return validateMxTaxId(normalizedType, rawValue);
    case 'us':
      return validateUsTaxId(normalizedType, rawValue);
    case 'global':
      return validateGlobalTaxId(normalizedType, rawValue);
  }
}
