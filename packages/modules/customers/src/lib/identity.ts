import { AppError, sha256Hex } from '@shac/kernel';
import { z } from 'zod';

const PARTY_KINDS = ['person', 'company'] as const;
const PARTY_ROLES = [
  'customer',
  'vendor',
  'patient',
  'guest',
  'tenant_resident',
  'legal_client',
  'carrier',
] as const;
const NATIONALITIES = ['V', 'E', 'OTHER'] as const;
const TAX_ID_TYPES = [
  'RIF',
  'CEDULA',
  'NIT',
  'RFC',
  'EIN',
  'SSN',
  'PASSPORT',
] as const;

export const partyKindSchema = z.enum(PARTY_KINDS);
export const partyRoleSchema = z.enum(PARTY_ROLES);
export const nationalitySchema = z.enum(NATIONALITIES);
export const taxIdTypeSchema = z.enum(TAX_ID_TYPES);

export type PartyRole = z.infer<typeof partyRoleSchema>;

/**
 * Normalizes tax / national IDs (RIF, Cedula, NIT, RFC, EIN, SSN, Passport)
 * by trimming, uppercasing, and stripping separators (`-`, `.`, whitespace).
 */
function normalizeTaxId(rawTaxId: string): string {
  const normalized = rawTaxId.trim().toUpperCase().replace(/[\s.-]+/g, '');
  if (normalized.length === 0) {
    throw new AppError(
      'INVALID_TAX_ID',
      400,
      'taxIdNumber must contain alphanumeric characters',
    );
  }
  return normalized;
}

export async function normalizeAndHashTaxId(
  rawTaxId: string,
): Promise<{ normalized: string; hash: string }> {
  const normalized = normalizeTaxId(rawTaxId);
  const hash = await sha256Hex(normalized);
  return { normalized, hash };
}

export async function normalizeAndHashEmail(
  rawEmail: string,
): Promise<{ normalized: string; hash: string }> {
  const normalized = rawEmail.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new AppError('INVALID_EMAIL', 400, 'primaryEmail must not be empty');
  }
  const hash = await sha256Hex(normalized);
  return { normalized, hash };
}

export function normalizeOrgPath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

export function parseRolesMaskJson(raw: string): PartyRole[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = z.array(partyRoleSchema).safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
