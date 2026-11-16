import { AppError, sha256Hex } from '@shac/kernel';
import {
  buildCoFiscalPayload,
  buildMxFiscalPayload,
  buildUsFiscalPayload,
  buildVeFiscalPayload,
  computeClabeCheckDigit,
  sha384Hex,
  validateSpeiClabe,
  type PackBuildContext,
} from './fiscal-codes.js';
import {
  assertBpsRange,
  assertNonNegativeInt,
  assertSafeInt,
  computeBpsAmount,
  type CoDianSummary,
  type MxSatAndPaymentsSummary,
  type RegionalFiscalBreakdown,
  type RegionalFiscalInput,
  type UsSalesTaxSummary,
  type VeHkaZReportSummary,
} from './fiscal-types.js';

export {
  BPS_SCALE,
  computeBpsAmount,
  formatMinorDecimal,
  MICROS_SCALE,
  type CoDianSummary,
  type FiscalLineInput,
  type MxSatAndPaymentsSummary,
  type RegionalFiscalBreakdown,
  type RegionalFiscalInput,
  type UsSalesTaxSummary,
  type VeHkaZReportSummary,
} from './fiscal-types.js';
export { computeClabeCheckDigit, sha384Hex, validateSpeiClabe };

const VE_ALLOWED_IVA_BPS = new Set([1600, 800, 0]);
const CO_ALLOWED_IVA_BPS = new Set([1900, 500, 0]);
const MX_ALLOWED_IVA_BPS = new Set([1600, 800, 0]);

interface NormalizedTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxableBaseMinor: number;
  taxMinor: number;
  appliedTaxRateBps: number;
  statutoryTaxRateBps: number;
  isTaxExempt: boolean;
  resolvedLines: readonly { taxableMinor: number; taxRateBps: number; taxMinor: number }[];
}

function resolveTotalsAndTax(input: RegionalFiscalInput): NormalizedTotals {
  const pack = input.regionPack;
  const defaultRateBps =
    pack === 've' ? 1600 : pack === 'co' ? 1900 : pack === 'mx' ? 1600 : 0;
  const isTaxExempt = pack === 'us' && input.us?.isTaxExempt === true;
  const statutoryTaxRateBps =
    pack === 'us'
      ? assertBpsRange(
          input.us?.jurisdictionTaxRateBps ?? input.taxRateBps ?? 0,
          'jurisdictionTaxRateBps',
        )
      : assertBpsRange(input.taxRateBps ?? defaultRateBps, 'taxRateBps');

  const allowedSet =
    pack === 've'
      ? VE_ALLOWED_IVA_BPS
      : pack === 'co'
        ? CO_ALLOWED_IVA_BPS
        : pack === 'mx'
          ? MX_ALLOWED_IVA_BPS
          : null;

  if (allowedSet && !allowedSet.has(statutoryTaxRateBps)) {
    throw new AppError(
      'INVALID_TAX_RATE',
      422,
      `Tax rate ${statutoryTaxRateBps} bps is not valid for regionPack '${pack}'`,
    );
  }

  const appliedTaxRateBps = isTaxExempt ? 0 : statutoryTaxRateBps;

  if (input.lines && input.lines.length > 0) {
    let subtotalSum = 0;
    let discountSum = 0;
    let taxSum = 0;
    const resolvedLines: { taxableMinor: number; taxRateBps: number; taxMinor: number }[] = [];

    for (const line of input.lines) {
      const lineSub = assertNonNegativeInt(line.subtotalMinor, 'line.subtotalMinor');
      const lineDisc = assertNonNegativeInt(line.discountMinor ?? 0, 'line.discountMinor');
      if (lineDisc > lineSub) {
        throw new AppError('INVALID_FISCAL_INPUT', 400, 'line.discountMinor exceeds subtotal');
      }
      const lineRate = isTaxExempt
        ? 0
        : assertBpsRange(line.taxRateBps ?? appliedTaxRateBps, 'line.taxRateBps');
      if (allowedSet && !allowedSet.has(lineRate)) {
        throw new AppError(
          'INVALID_TAX_RATE',
          422,
          `Line tax rate ${lineRate} bps is not valid for regionPack '${pack}'`,
        );
      }
      const taxableMinor = lineSub - lineDisc;
      const taxMinor = computeBpsAmount(taxableMinor, lineRate);
      subtotalSum += lineSub;
      discountSum += lineDisc;
      taxSum += taxMinor;
      resolvedLines.push({ taxableMinor, taxRateBps: lineRate, taxMinor });
    }

    if (input.subtotalMinor !== subtotalSum) {
      throw new AppError(
        'INVALID_FISCAL_INPUT',
        400,
        'subtotalMinor must equal the sum of line subtotalMinor values',
      );
    }
    const providedDisc = assertNonNegativeInt(input.discountMinor ?? discountSum, 'discountMinor');
    if (providedDisc !== discountSum) {
      throw new AppError(
        'INVALID_FISCAL_INPUT',
        400,
        'discountMinor must equal the sum of line discountMinor values',
      );
    }

    return {
      subtotalMinor: subtotalSum,
      discountMinor: discountSum,
      taxableBaseMinor: subtotalSum - discountSum,
      taxMinor: taxSum,
      appliedTaxRateBps,
      statutoryTaxRateBps,
      isTaxExempt,
      resolvedLines,
    };
  }

  const subtotalMinor = assertNonNegativeInt(input.subtotalMinor, 'subtotalMinor');
  const discountMinor = assertNonNegativeInt(input.discountMinor ?? 0, 'discountMinor');
  if (discountMinor > subtotalMinor) {
    throw new AppError('INVALID_FISCAL_INPUT', 400, 'discountMinor exceeds subtotalMinor');
  }
  const taxableBaseMinor = subtotalMinor - discountMinor;
  const taxMinor = computeBpsAmount(taxableBaseMinor, appliedTaxRateBps);

  return {
    subtotalMinor,
    discountMinor,
    taxableBaseMinor,
    taxMinor,
    appliedTaxRateBps,
    statutoryTaxRateBps,
    isTaxExempt,
    resolvedLines: [{ taxableMinor: taxableBaseMinor, taxRateBps: appliedTaxRateBps, taxMinor }],
  };
}

/**
 * Computes regional taxes, withholdings, and pack-specific fiscal payloads (`ve`/`co`/`mx`/`us`/`global`)
 * using strict integer minor units and BigInt basis-points rounding.
 */
export async function computeRegionalFiscalBreakdown(
  input: RegionalFiscalInput,
): Promise<RegionalFiscalBreakdown> {
  if (!input.invoiceNumber || input.invoiceNumber.trim().length === 0) {
    throw new AppError('INVALID_FISCAL_INPUT', 400, 'invoiceNumber is required');
  }
  const currency = input.currency.trim().toUpperCase();
  if (currency.length < 3 || currency.length > 8) {
    throw new AppError('INVALID_FISCAL_INPUT', 400, 'currency must be 3-8 chars');
  }
  const exchangeRateMicros = assertSafeInt(
    input.exchangeRateMicros ?? 1_000_000,
    'exchangeRateMicros',
  );
  if (exchangeRateMicros <= 0) {
    throw new AppError('INVALID_FX_RATE', 400, 'exchangeRateMicros must be positive');
  }
  const issueDateSec = assertNonNegativeInt(
    input.issueDateSec ?? Math.floor(Date.now() / 1000),
    'issueDateSec',
  );
  const paidMinor = assertNonNegativeInt(input.paidMinor ?? 0, 'paidMinor');

  const totals = resolveTotalsAndTax(input);
  const withholdingBps = assertBpsRange(
    input.islrWithholdingBps ?? input.withholdingBps ?? 0,
    'withholdingBps',
  );
  const withholdingMinor = computeBpsAmount(totals.taxableBaseMinor, withholdingBps);
  const totalMinor = totals.taxableBaseMinor + totals.taxMinor;
  if (withholdingMinor > totalMinor) {
    throw new AppError(
      'INVALID_FISCAL_INPUT',
      422,
      'withholdingMinor cannot exceed gross invoice total',
    );
  }
  const netPayableMinor = totalMinor - withholdingMinor;
  const balanceDueMinor = netPayableMinor > paidMinor ? netPayableMinor - paidMinor : 0;

  const issuerTaxId = input.issuerTaxId?.trim() || 'ISSUER-NA';
  const customerTaxId = input.customerTaxId?.trim() || 'CONSUMIDOR-FINAL';
  const invoiceNumber = input.invoiceNumber.trim();
  const seedHex = await sha256Hex(
    `${input.regionPack}|${invoiceNumber}|${issueDateSec}|${issuerTaxId}|${customerTaxId}|${totalMinor}`,
  );

  const packCtx: PackBuildContext = {
    input,
    invoiceNumber,
    issueDateSec,
    currency,
    exchangeRateMicros,
    issuerTaxId,
    customerTaxId,
    seedHex,
    taxableBaseMinor: totals.taxableBaseMinor,
    taxMinor: totals.taxMinor,
    withholdingBps,
    withholdingMinor,
    totalMinor,
    netPayableMinor,
    appliedTaxRateBps: totals.appliedTaxRateBps,
    statutoryTaxRateBps: totals.statutoryTaxRateBps,
    isTaxExempt: totals.isTaxExempt,
    resolvedLines: totals.resolvedLines,
  };

  let fiscalControlNumber: string | null = null;
  let dianCufeSha384: string | null = null;
  let satCfdiUuid: string | null = null;
  let hkaPrinterZReport: string | null = null;
  let veSummary: VeHkaZReportSummary | null = null;
  let coDian: CoDianSummary | null = null;
  let mxPayments: MxSatAndPaymentsSummary | null = null;
  let usSalesTax: UsSalesTaxSummary | null = null;
  let fiscalQrPayload = `GLOBAL|${invoiceNumber}|${currency}|TAX=${totals.taxMinor}|TOTAL=${totalMinor}`;

  if (input.regionPack === 've') {
    const ve = buildVeFiscalPayload(packCtx);
    fiscalControlNumber = ve.fiscalControlNumber;
    hkaPrinterZReport = ve.hkaPrinterZReport;
    fiscalQrPayload = ve.fiscalQrPayload;
    veSummary = ve.veSummary;
  } else if (input.regionPack === 'co') {
    coDian = await buildCoFiscalPayload(packCtx);
    dianCufeSha384 = coDian.cufeSha384;
    fiscalQrPayload = coDian.qrPayload;
  } else if (input.regionPack === 'mx') {
    mxPayments = buildMxFiscalPayload(packCtx);
    satCfdiUuid = mxPayments.cfdiUuid;
    fiscalQrPayload = mxPayments.qrPayload;
  } else if (input.regionPack === 'us') {
    const us = buildUsFiscalPayload(packCtx);
    usSalesTax = us.usSalesTax;
    fiscalQrPayload = us.fiscalQrPayload;
  }

  return {
    regionPack: input.regionPack,
    invoiceNumber,
    issueDateSec,
    currency,
    exchangeRateMicros,
    subtotalMinor: totals.subtotalMinor,
    discountMinor: totals.discountMinor,
    taxableBaseMinor: totals.taxableBaseMinor,
    appliedTaxRateBps: totals.appliedTaxRateBps,
    statutoryTaxRateBps: totals.statutoryTaxRateBps,
    isTaxExempt: totals.isTaxExempt,
    taxMinor: totals.taxMinor,
    withholdingBps,
    withholdingMinor,
    totalMinor,
    netPayableMinor,
    paidMinor,
    balanceDueMinor,
    fiscalControlNumber,
    dianCufeSha384,
    satCfdiUuid,
    fiscalQrPayload,
    hkaPrinterZReport,
    veSummary,
    coDian,
    mxPayments,
    usSalesTax,
  };
}
