import { AppError, type RegionPackId } from '@shac/kernel';

export const BPS_SCALE = 10_000;
export const MICROS_SCALE = 1_000_000;

export interface FiscalLineInput {
  subtotalMinor: number;
  discountMinor?: number;
  taxRateBps?: number;
}

export interface RegionalFiscalInput {
  regionPack: RegionPackId;
  invoiceNumber: string;
  issueDateSec?: number;
  currency: string;
  exchangeRateMicros?: number;
  subtotalMinor: number;
  discountMinor?: number;
  taxRateBps?: number;
  withholdingBps?: number;
  islrWithholdingBps?: number;
  paidMinor?: number;
  issuerTaxId?: string;
  customerTaxId?: string;
  lines?: readonly FiscalLineInput[];
  ve?: {
    fiscalControlNumber?: string;
    printerSerial?: string;
    zReportNumber?: string;
    igtfBps?: number;
  };
  co?: {
    dianTechnicalKey?: string;
    environmentCode?: '1' | '2';
  };
  mx?: {
    cfdiUuid?: string;
    oxxoPayReference?: string;
    speiClabe?: string;
    bankCode?: string;
    plazaCode?: string;
  };
  us?: {
    jurisdictionCode?: string;
    jurisdictionTaxRateBps?: number;
    isTaxExempt?: boolean;
    b2bExemptionCertificate?: string;
  };
}

export interface VeHkaZReportSummary {
  printerSerial: string;
  zReportNumber: string;
  fiscalControlNumber: string;
  invoiceNumber: string;
  issuerTaxId: string;
  customerTaxId: string;
  currency: string;
  exchangeRateMicros: number;
  baseGeneralMinor: number;
  ivaGeneralMinor: number;
  baseReducedMinor: number;
  ivaReducedMinor: number;
  baseExemptMinor: number;
  totalIvaMinor: number;
  islrWithholdingBps: number;
  islrWithholdingMinor: number;
  igtfMinor: number;
  totalMinor: number;
  netPayableMinor: number;
  issuedAtSec: number;
}

export interface CoDianSummary {
  cufeSha384: string;
  qrPayload: string;
  environmentCode: '1' | '2';
}

export interface MxSatAndPaymentsSummary {
  cfdiVersion: '4.0';
  cfdiUuid: string;
  qrPayload: string;
  oxxoPayReference: string;
  speiClabe: string;
}

export interface UsSalesTaxSummary {
  jurisdictionCode: string;
  statutoryTaxRateBps: number;
  appliedTaxRateBps: number;
  isTaxExempt: boolean;
  b2bExemptionCertificate: string | null;
}

export interface RegionalFiscalBreakdown {
  regionPack: RegionPackId;
  invoiceNumber: string;
  issueDateSec: number;
  currency: string;
  exchangeRateMicros: number;
  subtotalMinor: number;
  discountMinor: number;
  taxableBaseMinor: number;
  appliedTaxRateBps: number;
  statutoryTaxRateBps: number;
  isTaxExempt: boolean;
  taxMinor: number;
  withholdingBps: number;
  withholdingMinor: number;
  totalMinor: number;
  netPayableMinor: number;
  paidMinor: number;
  balanceDueMinor: number;
  fiscalControlNumber: string | null;
  dianCufeSha384: string | null;
  satCfdiUuid: string | null;
  fiscalQrPayload: string;
  hkaPrinterZReport: string | null;
  veSummary: VeHkaZReportSummary | null;
  coDian: CoDianSummary | null;
  mxPayments: MxSatAndPaymentsSummary | null;
  usSalesTax: UsSalesTaxSummary | null;
}

export function assertSafeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new AppError(
      'INVALID_INTEGER_MONEY',
      400,
      `${label} must be a safe integer`,
    );
  }
  return value;
}

export function assertNonNegativeInt(value: number, label: string): number {
  assertSafeInt(value, label);
  if (value < 0) {
    throw new AppError(
      'INVALID_FISCAL_INPUT',
      400,
      `${label} must be non-negative`,
    );
  }
  return value;
}

export function assertBpsRange(value: number, label: string): number {
  assertSafeInt(value, label);
  if (value < 0 || value > BPS_SCALE) {
    throw new AppError(
      'INVALID_TAX_RATE',
      422,
      `${label} must be between 0 and ${BPS_SCALE} bps`,
    );
  }
  return value;
}

/** Divides signed integer numerator by positive denominator, rounding half away from zero. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) {
    throw new AppError('INVALID_INTEGER_MONEY', 400, 'Denominator must be positive');
  }
  const half = denominator / 2n;
  const result =
    numerator >= 0n
      ? (numerator + half) / denominator
      : -((-numerator + half) / denominator);
  const num = Number(result);
  if (!Number.isSafeInteger(num)) {
    throw new AppError('INTEGER_OVERFLOW', 400, 'Integer arithmetic overflow');
  }
  return num;
}

/** Computes basis-points tax or withholding amount using BigInt half-up rounding. */
export function computeBpsAmount(amountMinor: number, bps: number): number {
  assertSafeInt(amountMinor, 'amountMinor');
  assertBpsRange(bps, 'bps');
  return divRoundHalfUp(BigInt(amountMinor) * BigInt(bps), BigInt(BPS_SCALE));
}

/** Formats integer minor units as decimal string (`12345 -> "123.45"`) using pure BigInt math. */
export function formatMinorDecimal(amountMinor: number): string {
  assertSafeInt(amountMinor, 'amountMinor');
  const bi = BigInt(amountMinor);
  const sign = bi < 0n ? '-' : '';
  const abs = bi < 0n ? -bi : bi;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${sign}${whole.toString()}.${frac}`;
}
