import { AppError } from '@shac/kernel';
import {
  assertBpsRange,
  computeBpsAmount,
  formatMinorDecimal,
  type CoDianSummary,
  type MxSatAndPaymentsSummary,
  type RegionalFiscalInput,
  type UsSalesTaxSummary,
  type VeHkaZReportSummary,
} from './fiscal-types.js';

const encoder = new TextEncoder();
const CLABE_WEIGHTS = [3, 7, 1] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let idx = 0; idx < bytes.length; idx += 1) {
    out += (bytes[idx] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}

/** Computes lowercase SHA-384 hex digest via WebCrypto (`crypto.subtle.digest`). */
export async function sha384Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-384', encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

/** Computes Banco de México SPEI CLABE check digit (digit 18) for a 17-digit prefix. */
export function computeClabeCheckDigit(seventeenDigits: string): number {
  if (!/^\d{17}$/.test(seventeenDigits)) {
    throw new AppError(
      'INVALID_SPEI_CLABE',
      422,
      'CLABE prefix must contain exactly 17 digits',
    );
  }
  let sum = 0;
  for (let idx = 0; idx < 17; idx += 1) {
    const digit = Number(seventeenDigits[idx]);
    const weight = CLABE_WEIGHTS[idx % 3] ?? 1;
    sum += (digit * weight) % 10;
  }
  return (10 - (sum % 10)) % 10;
}

/** Validates an 18-digit Mexican SPEI CLABE including its Banxico check digit. */
export function validateSpeiClabe(clabe: string): string {
  const cleaned = clabe.trim();
  if (!/^\d{18}$/.test(cleaned)) {
    throw new AppError('INVALID_SPEI_CLABE', 422, 'SPEI CLABE must be 18 numeric digits');
  }
  const expected = computeClabeCheckDigit(cleaned.slice(0, 17));
  if (Number(cleaned[17]) !== expected) {
    throw new AppError('INVALID_SPEI_CLABE', 422, 'SPEI CLABE check digit mismatch');
  }
  return cleaned;
}

function buildDeterministicSpeiClabe(
  seedHex: string,
  bankCode = '646',
  plazaCode = '180',
): string {
  if (!/^\d{3}$/.test(bankCode) || !/^\d{3}$/.test(plazaCode)) {
    throw new AppError('INVALID_SPEI_CLABE', 422, 'CLABE bankCode and plazaCode must be 3 digits');
  }
  let account = '';
  for (let idx = 0; idx < 11; idx += 1) {
    const val = Number.parseInt(seedHex.slice(idx * 2, idx * 2 + 2), 16);
    account += String(val % 10);
  }
  const prefix17 = `${bankCode}${plazaCode}${account}`;
  return `${prefix17}${computeClabeCheckDigit(prefix17)}`;
}

function buildDeterministicOxxoCode(seedHex: string): string {
  let digits13 = '';
  for (let idx = 0; idx < 13; idx += 1) {
    const val = Number.parseInt(seedHex.slice(idx * 2, idx * 2 + 2), 16);
    digits13 += String(val % 10);
  }
  let sum = 0;
  for (let idx = 0; idx < 13; idx += 1) {
    let digit = Number(digits13[12 - idx]);
    if (idx % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${digits13}${check}`;
}

function buildDeterministicUuidV4(seedHex: string): string {
  const clean = seedHex.slice(0, 32).toLowerCase();
  const variantNibble = (8 + (Number.parseInt(clean[16] ?? '0', 16) % 4)).toString(16);
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-4${clean.slice(13, 16)}-${variantNibble}${clean.slice(17, 20)}-${clean.slice(20, 32)}`;
}

export interface PackBuildContext {
  input: RegionalFiscalInput;
  invoiceNumber: string;
  issueDateSec: number;
  currency: string;
  exchangeRateMicros: number;
  issuerTaxId: string;
  customerTaxId: string;
  seedHex: string;
  taxableBaseMinor: number;
  taxMinor: number;
  withholdingBps: number;
  withholdingMinor: number;
  totalMinor: number;
  netPayableMinor: number;
  appliedTaxRateBps: number;
  statutoryTaxRateBps: number;
  isTaxExempt: boolean;
  resolvedLines: readonly { taxableMinor: number; taxRateBps: number; taxMinor: number }[];
}

export function buildVeFiscalPayload(ctx: PackBuildContext): {
  fiscalControlNumber: string;
  hkaPrinterZReport: string;
  fiscalQrPayload: string;
  veSummary: VeHkaZReportSummary;
} {
  const fiscalControlNumber =
    ctx.input.ve?.fiscalControlNumber?.trim() || `00-${ctx.seedHex.slice(0, 8).toUpperCase()}`;
  let baseGeneralMinor = 0;
  let ivaGeneralMinor = 0;
  let baseReducedMinor = 0;
  let ivaReducedMinor = 0;
  let baseExemptMinor = 0;
  for (const line of ctx.resolvedLines) {
    if (line.taxRateBps === 1600) {
      baseGeneralMinor += line.taxableMinor;
      ivaGeneralMinor += line.taxMinor;
    } else if (line.taxRateBps === 800) {
      baseReducedMinor += line.taxableMinor;
      ivaReducedMinor += line.taxMinor;
    } else {
      baseExemptMinor += line.taxableMinor;
    }
  }
  const igtfBps = assertBpsRange(ctx.input.ve?.igtfBps ?? 0, 've.igtfBps');
  const igtfMinor = igtfBps > 0 ? computeBpsAmount(ctx.totalMinor, igtfBps) : 0;

  const veSummary: VeHkaZReportSummary = {
    printerSerial: ctx.input.ve?.printerSerial?.trim() || 'HKA-TFHK-0001',
    zReportNumber: ctx.input.ve?.zReportNumber?.trim() || `Z-${ctx.seedHex.slice(0, 6).toUpperCase()}`,
    fiscalControlNumber,
    invoiceNumber: ctx.invoiceNumber,
    issuerTaxId: ctx.issuerTaxId,
    customerTaxId: ctx.customerTaxId,
    currency: ctx.currency,
    exchangeRateMicros: ctx.exchangeRateMicros,
    baseGeneralMinor,
    ivaGeneralMinor,
    baseReducedMinor,
    ivaReducedMinor,
    baseExemptMinor,
    totalIvaMinor: ctx.taxMinor,
    islrWithholdingBps: ctx.withholdingBps,
    islrWithholdingMinor: ctx.withholdingMinor,
    igtfMinor,
    totalMinor: ctx.totalMinor,
    netPayableMinor: ctx.netPayableMinor,
    issuedAtSec: ctx.issueDateSec,
  };
  const fiscalQrPayload =
    `VE|HKA|${ctx.issuerTaxId}|${ctx.invoiceNumber}|${fiscalControlNumber}` +
    `|${ctx.totalMinor}|${ctx.taxMinor}`;
  return {
    fiscalControlNumber,
    hkaPrinterZReport: JSON.stringify(veSummary),
    fiscalQrPayload,
    veSummary,
  };
}

export async function buildCoFiscalPayload(ctx: PackBuildContext): Promise<CoDianSummary> {
  const issueIso = new Date(ctx.issueDateSec * 1000).toISOString();
  const fecFac = issueIso.slice(0, 10);
  const horFac = `${issueIso.slice(11, 19)}-05:00`;
  const envCode = ctx.input.co?.environmentCode ?? '2';
  const techKey = ctx.input.co?.dianTechnicalKey?.trim() || 'SHAC-DIAN-TECH-KEY';
  const cufePreimage = [
    ctx.invoiceNumber,
    fecFac,
    horFac,
    formatMinorDecimal(ctx.taxableBaseMinor),
    '01',
    formatMinorDecimal(ctx.taxMinor),
    '04',
    '0.00',
    '03',
    '0.00',
    formatMinorDecimal(ctx.totalMinor),
    ctx.issuerTaxId,
    ctx.customerTaxId,
    techKey,
    envCode,
  ].join('');
  const cufeSha384 = await sha384Hex(cufePreimage);
  const qrPayload =
    `NumFac=${ctx.invoiceNumber}|FecFac=${fecFac}|NitFac=${ctx.issuerTaxId}|DocAdq=${ctx.customerTaxId}` +
    `|ValFac=${formatMinorDecimal(ctx.taxableBaseMinor)}|ValIva=${formatMinorDecimal(ctx.taxMinor)}` +
    `|ValTot=${formatMinorDecimal(ctx.totalMinor)}|CUFE=${cufeSha384}` +
    `|QR=https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufeSha384}`;
  return { cufeSha384, qrPayload, environmentCode: envCode };
}

export function buildMxFiscalPayload(ctx: PackBuildContext): MxSatAndPaymentsSummary {
  const rawUuid = ctx.input.mx?.cfdiUuid?.trim();
  if (rawUuid && !UUID_RE.test(rawUuid)) {
    throw new AppError('INVALID_FISCAL_INPUT', 422, 'Invalid CFDI 4.0 UUID format');
  }
  const cfdiUuid = (rawUuid ?? buildDeterministicUuidV4(ctx.seedHex)).toUpperCase();
  const rawOxxo = ctx.input.mx?.oxxoPayReference?.trim();
  if (rawOxxo && !/^\d{14}$/.test(rawOxxo)) {
    throw new AppError('INVALID_FISCAL_INPUT', 422, 'OXXO Pay code must be 14 numeric digits');
  }
  const oxxoPayReference = rawOxxo ?? buildDeterministicOxxoCode(ctx.seedHex);
  const speiClabe = ctx.input.mx?.speiClabe
    ? validateSpeiClabe(ctx.input.mx.speiClabe)
    : buildDeterministicSpeiClabe(ctx.seedHex, ctx.input.mx?.bankCode, ctx.input.mx?.plazaCode);
  const qrPayload =
    `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx` +
    `?id=${cfdiUuid}&re=${ctx.issuerTaxId}&rr=${ctx.customerTaxId}` +
    `&tt=${formatMinorDecimal(ctx.totalMinor)}&fe=${ctx.seedHex.slice(0, 8)}`;
  return {
    cfdiVersion: '4.0',
    cfdiUuid,
    qrPayload,
    oxxoPayReference,
    speiClabe,
  };
}

export function buildUsFiscalPayload(ctx: PackBuildContext): {
  usSalesTax: UsSalesTaxSummary;
  fiscalQrPayload: string;
} {
  const jurisdictionCode = ctx.input.us?.jurisdictionCode?.trim() || 'US-DEFAULT';
  const usSalesTax: UsSalesTaxSummary = {
    jurisdictionCode,
    statutoryTaxRateBps: ctx.statutoryTaxRateBps,
    appliedTaxRateBps: ctx.appliedTaxRateBps,
    isTaxExempt: ctx.isTaxExempt,
    b2bExemptionCertificate: ctx.input.us?.b2bExemptionCertificate?.trim() || null,
  };
  const fiscalQrPayload =
    `US|${jurisdictionCode}|${ctx.invoiceNumber}|EXEMPT=${ctx.isTaxExempt ? '1' : '0'}` +
    `|RATE_BPS=${ctx.appliedTaxRateBps}|TAX=${ctx.taxMinor}|TOTAL=${ctx.totalMinor}`;
  return { usSalesTax, fiscalQrPayload };
}
