import { AppError } from '@shac/kernel';

export interface ParsedGs1Barcode {
  raw: string;
  gtin: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  expiryEpochMs: number | null;
  serialNumber: string | null;
  manufactureEpochMs: number | null;
  bestBeforeEpochMs: number | null;
}

const GS_CHAR = '\x1d';
const AIM_PREFIX_RE = /^\](?:C1|d2|e0|Q3)/;
const PAREN_AI_RE = /^\((\d{2,4})\)/;
const FIXED_LENGTH_AIS: Readonly<Record<string, number>> = {
  '01': 14,
  '11': 6,
  '13': 6,
  '15': 6,
  '17': 6,
};
const VARIABLE_LENGTH_AIS = new Set(['10', '21']);

/** Computes the GS1 Modulo-10 check digit for a numeric GTIN body (without check digit). */
export function computeGs1CheckDigit(bodyDigits: string): number {
  if (!/^\d+$/.test(bodyDigits) || bodyDigits.length === 0) {
    throw new AppError(
      'INVALID_GS1_BARCODE',
      400,
      'GTIN body must contain only numeric digits',
    );
  }
  let sum = 0;
  let weightThree = true;
  for (let i = bodyDigits.length - 1; i >= 0; i -= 1) {
    const digit = bodyDigits.charCodeAt(i) - 48;
    sum += digit * (weightThree ? 3 : 1);
    weightThree = !weightThree;
  }
  return (10 - (sum % 10)) % 10;
}

/** Validates a GTIN-8/12/13/14 Modulo-10 check digit, throwing 400 INVALID_GS1_CHECK_DIGIT on mismatch. */
export function assertValidGs1CheckDigit(gtin: string): void {
  if (!/^\d{8}$|^\d{12,14}$/.test(gtin)) {
    throw new AppError(
      'INVALID_GS1_BARCODE',
      400,
      'GS1 GTIN must be 8, 12, 13, or 14 numeric digits',
    );
  }
  const expected = computeGs1CheckDigit(gtin.slice(0, -1));
  const actual = gtin.charCodeAt(gtin.length - 1) - 48;
  if (actual !== expected) {
    throw new AppError(
      'INVALID_GS1_CHECK_DIGIT',
      400,
      `Invalid GS1 Modulo-10 check digit for GTIN ${gtin}`,
      { gtin, expectedCheckDigit: expected, actualCheckDigit: actual },
    );
  }
}

function parseGs1Date(
  yymmdd: string,
  ai: string,
): { isoDate: string; epochMs: number } {
  if (!/^\d{6}$/.test(yymmdd)) {
    throw new AppError(
      'INVALID_GS1_BARCODE',
      400,
      `GS1 AI (${ai}) date must be 6 digits YYMMDD`,
    );
  }
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 0 || dd > 31) {
    throw new AppError(
      'INVALID_GS1_BARCODE',
      400,
      `GS1 AI (${ai}) contains out-of-range date ${yymmdd}`,
    );
  }

  const refYear = new Date().getUTCFullYear();
  const refCentury = Math.trunc(refYear / 100) * 100;
  const diff = yy - (refYear % 100);
  const year =
    diff >= 51
      ? refCentury - 100 + yy
      : diff < -50
        ? refCentury + 100 + yy
        : refCentury + yy;

  const lastDayOfMonth = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  const day = dd === 0 ? lastDayOfMonth : dd;
  if (day > lastDayOfMonth) {
    throw new AppError(
      'INVALID_GS1_BARCODE',
      400,
      `GS1 AI (${ai}) contains invalid calendar date ${yymmdd}`,
    );
  }

  const epochMs = Date.UTC(year, mm - 1, day, 23, 59, 59, 999);
  const isoDate = `${String(year).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { isoDate, epochMs };
}

function tokenizeParenthesized(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  let cursor = 0;

  while (cursor < body.length) {
    while (cursor < body.length && body[cursor] === GS_CHAR) cursor += 1;
    if (cursor >= body.length) break;

    const match = PAREN_AI_RE.exec(body.slice(cursor));
    if (!match || !match[1]) {
      throw new AppError(
        'INVALID_GS1_BARCODE',
        400,
        `Malformed parenthesized GS1 segment near index ${cursor}`,
      );
    }
    const ai = match[1];
    cursor += match[0].length;
    const nextParen = body.indexOf('(', cursor);
    const nextGs = body.indexOf(GS_CHAR, cursor);
    const endCandidates = [body.length];
    if (nextParen !== -1) endCandidates.push(nextParen);
    if (nextGs !== -1) endCandidates.push(nextGs);
    const end = Math.min(...endCandidates);
    const value = body.slice(cursor, end).trim();
    if (!value) {
      throw new AppError(
        'INVALID_GS1_BARCODE',
        400,
        `GS1 AI (${ai}) cannot be empty`,
      );
    }
    fields.set(ai, value);
    cursor = end;
  }
  return fields;
}

function tokenizeRawFnc1(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  let cursor = 0;

  while (cursor < body.length) {
    while (cursor < body.length && body[cursor] === GS_CHAR) cursor += 1;
    if (cursor >= body.length) break;

    const ai = body.slice(cursor, cursor + 2);
    const fixedLen = FIXED_LENGTH_AIS[ai];
    if (fixedLen !== undefined) {
      cursor += 2;
      const value = body.slice(cursor, cursor + fixedLen);
      if (value.length !== fixedLen) {
        throw new AppError(
          'INVALID_GS1_BARCODE',
          400,
          `GS1 AI (${ai}) expected ${fixedLen} characters`,
        );
      }
      fields.set(ai, value);
      cursor += fixedLen;
      continue;
    }

    if (VARIABLE_LENGTH_AIS.has(ai)) {
      cursor += 2;
      const nextGs = body.indexOf(GS_CHAR, cursor);
      const end = nextGs === -1 ? body.length : nextGs;
      const value = body.slice(cursor, end);
      if (!value || value.length > 20) {
        throw new AppError(
          'INVALID_GS1_BARCODE',
          400,
          `GS1 AI (${ai}) length must be between 1 and 20 characters`,
        );
      }
      fields.set(ai, value);
      cursor = nextGs === -1 ? body.length : nextGs + 1;
      continue;
    }

    throw new AppError(
      'INVALID_GS1_BARCODE',
      400,
      `Unsupported or malformed GS1 AI near "${ai}"`,
    );
  }
  return fields;
}

/**
 * Decodes a GS1-128 barcode (parenthesized or FNC1 `\x1d`-delimited) in constant pass,
 * validating AI (01) GTIN Modulo-10 check digit and converting AI (17) YYMMDD to UTC epoch ms.
 */
export function parseGs1Barcode(raw: string): ParsedGs1Barcode {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new AppError('INVALID_GS1_BARCODE', 400, 'GS1 barcode cannot be empty');
  }

  const trimmed = raw.trim().replace(AIM_PREFIX_RE, '');
  const fields = trimmed.includes('(')
    ? tokenizeParenthesized(trimmed)
    : tokenizeRawFnc1(trimmed);

  if (fields.size === 0) {
    throw new AppError(
      'INVALID_GS1_BARCODE',
      400,
      'No GS1 application identifiers detected',
    );
  }

  const gtinRaw = fields.get('01') ?? null;
  if (gtinRaw !== null) {
    if (!/^\d{14}$/.test(gtinRaw)) {
      throw new AppError(
        'INVALID_GS1_BARCODE',
        400,
        'GS1 AI (01) GTIN must be exactly 14 numeric digits',
      );
    }
    assertValidGs1CheckDigit(gtinRaw);
  }

  const lotRaw = fields.get('10') ?? null;
  if (lotRaw !== null && lotRaw.length > 20) {
    throw new AppError(
      'INVALID_GS1_BARCODE',
      400,
      'GS1 AI (10) lot code exceeds 20 characters',
    );
  }

  const serialRaw = fields.get('21') ?? null;
  if (serialRaw !== null && serialRaw.length > 20) {
    throw new AppError(
      'INVALID_GS1_BARCODE',
      400,
      'GS1 AI (21) serial number exceeds 20 characters',
    );
  }

  const expParsed = fields.has('17')
    ? parseGs1Date(fields.get('17')!, '17')
    : null;
  const mfgParsed = fields.has('11')
    ? parseGs1Date(fields.get('11')!, '11')
    : null;
  const bbParsed = fields.has('15')
    ? parseGs1Date(fields.get('15')!, '15')
    : null;

  return {
    raw,
    gtin: gtinRaw,
    lotCode: lotRaw,
    expiryDate: expParsed?.isoDate ?? null,
    expiryEpochMs: expParsed?.epochMs ?? null,
    serialNumber: serialRaw,
    manufactureEpochMs: mfgParsed?.epochMs ?? null,
    bestBeforeEpochMs: bbParsed?.epochMs ?? null,
  };
}
