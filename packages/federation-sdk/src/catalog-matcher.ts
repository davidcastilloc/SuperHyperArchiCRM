import { AppError } from '@shac/kernel';

const VALID_GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const MICROS_SCALE = 1_000_000n;

export const FORBIDDEN_PUBLIC_OFFER_FIELDS = [
  'costPriceMinor',
  'marginBps',
  'customerList',
] as const;

export interface CatalogMappingEntry {
  localSku: string;
  gtin?: string;
  supplierDid?: string;
  supplierSku?: string;
  uomFactorMicros: number;
}

export interface CatalogMatchQuery {
  gtin?: string;
  supplierDid?: string;
  supplierSku?: string;
}

export interface CatalogMatchResult {
  mapping: CatalogMappingEntry;
  matchedBy: 'gtin' | 'supplier_sku';
}

/**
 * Normalizes EAN-8, UPC-A (12), EAN-13, or GTIN-14 into canonical 14-digit GTIN.
 */
export function normalizeGtin(raw: string): string {
  const cleaned = raw.replace(/[\s-]+/g, '');
  if (!/^\d+$/.test(cleaned) || !VALID_GTIN_LENGTHS.has(cleaned.length)) {
    throw new AppError(
      'INVALID_GTIN',
      400,
      `Invalid GTIN format: expected 8, 12, 13, or 14 digits`,
    );
  }
  return cleaned.padStart(14, '0');
}

export function matchCatalogItem(
  query: CatalogMatchQuery,
  localMappings: readonly CatalogMappingEntry[],
): CatalogMatchResult | null {
  if (query.gtin) {
    const targetGtin = normalizeGtin(query.gtin);
    let fallbackGtinMatch: CatalogMappingEntry | undefined;
    for (const entry of localMappings) {
      if (!entry.gtin) continue;
      if (normalizeGtin(entry.gtin) !== targetGtin) continue;
      if (query.supplierDid && entry.supplierDid === query.supplierDid) {
        return { mapping: entry, matchedBy: 'gtin' };
      }
      fallbackGtinMatch ??= entry;
    }
    if (fallbackGtinMatch) {
      return { mapping: fallbackGtinMatch, matchedBy: 'gtin' };
    }
  }

  if (query.supplierDid && query.supplierSku) {
    const skuMatch = localMappings.find(
      (entry) =>
        entry.supplierDid === query.supplierDid &&
        entry.supplierSku === query.supplierSku,
    );
    if (skuMatch) {
      return { mapping: skuMatch, matchedBy: 'supplier_sku' };
    }
  }

  return null;
}

/**
 * Converts pack quantity to integer base units using uomFactorMicros (1_000_000 = 1 unit).
 * Example: qty=2, uomFactorMicros=24_000_000 (CAJA x24) -> 48 UNIDADES.
 */
export function convertPackQtyToBaseUnits(
  qty: number,
  uomFactorMicros: number,
): number {
  if (!Number.isSafeInteger(qty) || qty < 0) {
    throw new AppError(
      'INVALID_UOM_CONVERSION',
      400,
      'Quantity must be a non-negative safe integer',
    );
  }
  if (!Number.isSafeInteger(uomFactorMicros) || uomFactorMicros <= 0) {
    throw new AppError(
      'INVALID_UOM_CONVERSION',
      400,
      'uomFactorMicros must be a positive safe integer',
    );
  }
  const totalMicros = BigInt(qty) * BigInt(uomFactorMicros);
  if (totalMicros % MICROS_SCALE !== 0n) {
    throw new AppError(
      'INVALID_UOM_CONVERSION',
      400,
      'Pack conversion must yield an exact integer number of base units',
    );
  }
  return Number(totalMicros / MICROS_SCALE);
}

function scanForForbiddenFields(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = scanForForbiddenFields(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const field of FORBIDDEN_PUBLIC_OFFER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field) && record[field] !== undefined) {
      return field;
    }
  }
  for (const nested of Object.values(record)) {
    const found = scanForForbiddenFields(nested);
    if (found) return found;
  }
  return null;
}

/**
 * Privacy boundary guard: rejects offers containing private cost, margin, or customer data.
 */
export function assertPublicOfferSafe<T extends Record<string, unknown>>(
  offer: T,
): T {
  const forbidden = scanForForbiddenFields(offer);
  if (forbidden) {
    throw new AppError(
      'PRIVACY_BOUNDARY_VIOLATION',
      403,
      `Private field "${forbidden}" cannot leave the local node`,
    );
  }
  if (offer.isPublicInNetwork === false) {
    throw new AppError(
      'PRIVACY_BOUNDARY_VIOLATION',
      403,
      'Offer is not marked isPublicInNetwork=true',
    );
  }
  return offer;
}
