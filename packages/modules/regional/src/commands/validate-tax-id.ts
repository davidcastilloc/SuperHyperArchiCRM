import { assertOrgScope, type ShacD1Database } from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import {
  REGIONAL_TAX_ID_TYPES,
  validateRegionalTaxId,
} from '../tax-ids.js';

const regionPackSchema = z.enum(['ve', 'co', 'mx', 'us', 'global']);

export const validateTaxIdInputSchema = z.object({
  regionPack: regionPackSchema.optional(),
  taxIdType: z.enum(REGIONAL_TAX_ID_TYPES),
  taxIdNumber: z.string().trim().min(1).max(64),
});

export const validateTaxIdOutputSchema = z.object({
  regionPack: regionPackSchema,
  taxIdType: z.enum(REGIONAL_TAX_ID_TYPES),
  normalized: z.string(),
  formatted: z.string(),
  taxIdHash: z.string(),
  checkDigit: z.string().nullable(),
  isValid: z.literal(true),
});

export type ValidateTaxIdInput = z.infer<typeof validateTaxIdInputSchema>;
export type ValidateTaxIdOutput = z.infer<typeof validateTaxIdOutputSchema>;

export const regionalTaxIdValidateCommand = defineCommand<
  typeof validateTaxIdInputSchema,
  ValidateTaxIdOutput,
  ShacD1Database
>({
  id: 'regional.tax_id.validate',
  moduleId: 'regional',
  method: 'POST',
  path: '/api/regional/tax-id/validate',
  summary: 'Normalize and validate a regional tax identifier (RIF/CEDULA/NIT/CC/RFC/EIN)',
  requiredPermission: 'regional.tax_id.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description:
      'Normalize, validate check digits, and hash regional tax IDs for ve, co, mx, us, or global',
  },
  inputSchema: validateTaxIdInputSchema,
  outputSchema: validateTaxIdOutputSchema,
  async handler(ctx, input) {
    assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);
    const targetPack = input.regionPack ?? ctx.profile.regionPack;
    const validated = validateRegionalTaxId(
      targetPack,
      input.taxIdType,
      input.taxIdNumber,
    );
    const taxIdHash = await sha256Hex(validated.normalized);
    return {
      ...validated,
      taxIdHash,
    };
  },
});
