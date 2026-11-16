import { z } from 'zod';
import { REGIONAL_TAX_ID_TYPES } from '../tax-ids.js';

const regionPackSchema = z.enum(['ve', 'co', 'mx', 'us', 'global']);

const fiscalLineSchema = z.object({
  subtotalMinor: z.number().int().nonnegative(),
  discountMinor: z.number().int().nonnegative().default(0),
  taxRateBps: z.number().int().min(0).max(10_000).optional(),
});

export const stampInvoiceInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  orgId: z.string().min(1).optional(),
  regionPack: regionPackSchema.optional(),
  invoiceNumber: z.string().trim().min(1).max(64),
  orderId: z.string().min(1).nullable().optional(),
  bookingOrLeaseId: z.string().min(1).nullable().optional(),
  caseOrEncounterId: z.string().min(1).nullable().optional(),
  partyId: z.string().min(1).nullable().optional(),
  issueDate: z.string().trim().min(4).max(40).optional(),
  issueDateSec: z.number().int().nonnegative().optional(),
  dueDate: z.string().trim().min(4).max(40).nullable().optional(),
  currency: z.string().trim().min(3).max(8).default('USD'),
  exchangeRateMicros: z.number().int().positive().default(1_000_000),
  subtotalMinor: z.number().int().nonnegative(),
  discountMinor: z.number().int().nonnegative().default(0),
  taxRateBps: z.number().int().min(0).max(10_000).optional(),
  withholdingBps: z.number().int().min(0).max(10_000).optional(),
  islrWithholdingBps: z.number().int().min(0).max(10_000).optional(),
  paidMinor: z.number().int().nonnegative().default(0),
  issuerTaxId: z.string().trim().min(1).max(64).optional(),
  issuerTaxIdType: z.enum(REGIONAL_TAX_ID_TYPES).optional(),
  customerTaxId: z.string().trim().min(1).max(64).optional(),
  customerTaxIdType: z.enum(REGIONAL_TAX_ID_TYPES).optional(),
  lines: z.array(fiscalLineSchema).optional(),
  ve: z
    .object({
      fiscalControlNumber: z.string().trim().min(1).max(64).optional(),
      printerSerial: z.string().trim().min(1).max(64).optional(),
      zReportNumber: z.string().trim().min(1).max(64).optional(),
      igtfBps: z.number().int().min(0).max(10_000).optional(),
    })
    .optional(),
  co: z
    .object({
      dianTechnicalKey: z.string().trim().min(1).max(128).optional(),
      environmentCode: z.enum(['1', '2']).optional(),
    })
    .optional(),
  mx: z
    .object({
      cfdiUuid: z.string().trim().min(1).max(64).optional(),
      oxxoPayReference: z.string().trim().min(1).max(32).optional(),
      speiClabe: z.string().trim().min(1).max(32).optional(),
      bankCode: z.string().trim().length(3).optional(),
      plazaCode: z.string().trim().length(3).optional(),
    })
    .optional(),
  us: z
    .object({
      jurisdictionCode: z.string().trim().min(1).max(64).optional(),
      jurisdictionTaxRateBps: z.number().int().min(0).max(10_000).optional(),
      isTaxExempt: z.boolean().optional(),
      b2bExemptionCertificate: z.string().trim().min(1).max(128).optional(),
    })
    .optional(),
  isConsolidated24h: z.boolean().default(false),
  consolidationClosesAt: z.number().int().positive().nullable().optional(),
  pdfR2Key: z.string().max(256).nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
});

const veSummarySchema = z.object({
  printerSerial: z.string(),
  zReportNumber: z.string(),
  fiscalControlNumber: z.string(),
  invoiceNumber: z.string(),
  issuerTaxId: z.string(),
  customerTaxId: z.string(),
  currency: z.string(),
  exchangeRateMicros: z.number().int().positive(),
  baseGeneralMinor: z.number().int().nonnegative(),
  ivaGeneralMinor: z.number().int().nonnegative(),
  baseReducedMinor: z.number().int().nonnegative(),
  ivaReducedMinor: z.number().int().nonnegative(),
  baseExemptMinor: z.number().int().nonnegative(),
  totalIvaMinor: z.number().int().nonnegative(),
  islrWithholdingBps: z.number().int().nonnegative(),
  islrWithholdingMinor: z.number().int().nonnegative(),
  igtfMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
  netPayableMinor: z.number().int().nonnegative(),
  issuedAtSec: z.number().int().nonnegative(),
});

const coDianSchema = z.object({
  cufeSha384: z.string(),
  qrPayload: z.string(),
  environmentCode: z.enum(['1', '2']),
});

const mxPaymentsSchema = z.object({
  cfdiVersion: z.literal('4.0'),
  cfdiUuid: z.string(),
  qrPayload: z.string(),
  oxxoPayReference: z.string(),
  speiClabe: z.string(),
});

const usSalesTaxSchema = z.object({
  jurisdictionCode: z.string(),
  statutoryTaxRateBps: z.number().int().nonnegative(),
  appliedTaxRateBps: z.number().int().nonnegative(),
  isTaxExempt: z.boolean(),
  b2bExemptionCertificate: z.string().nullable(),
});

export const stampInvoiceOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  invoiceNumber: z.string(),
  orderId: z.string().nullable(),
  partyId: z.string().nullable(),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
  regionPack: regionPackSchema,
  currency: z.string(),
  exchangeRateMicros: z.number().int().positive(),
  subtotalMinor: z.number().int().nonnegative(),
  discountMinor: z.number().int().nonnegative(),
  taxableBaseMinor: z.number().int().nonnegative(),
  appliedTaxRateBps: z.number().int().nonnegative(),
  statutoryTaxRateBps: z.number().int().nonnegative(),
  isTaxExempt: z.boolean(),
  taxMinor: z.number().int().nonnegative(),
  withholdingBps: z.number().int().nonnegative(),
  withholdingMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
  netPayableMinor: z.number().int().nonnegative(),
  paidMinor: z.number().int().nonnegative(),
  balanceDueMinor: z.number().int().nonnegative(),
  fiscalControlNumber: z.string().nullable(),
  dianCufeSha384: z.string().nullable(),
  satCfdiUuid: z.string().nullable(),
  fiscalQrPayload: z.string(),
  hkaPrinterZReport: z.string().nullable(),
  status: z.string(),
  veSummary: veSummarySchema.nullable(),
  coDian: coDianSchema.nullable(),
  mxPayments: mxPaymentsSchema.nullable(),
  usSalesTax: usSalesTaxSchema.nullable(),
  createdAt: z.number().int(),
});

export type StampInvoiceInput = z.infer<typeof stampInvoiceInputSchema>;
export type StampInvoiceOutput = z.infer<typeof stampInvoiceOutputSchema>;
