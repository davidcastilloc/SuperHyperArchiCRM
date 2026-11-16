import type { MarketVocabulary } from '@shac/kernel';
import type { createRpcClient } from '../lib/rpc';

type ShacRpcClient = ReturnType<typeof createRpcClient>;

export interface Phase2ViewProps {
  vocabulary: MarketVocabulary;
  rpc: ShacRpcClient;
}

export const INPUT_CLS =
  'h-9 rounded-md border border-input bg-background px-3 text-sm';

/** Formats integer minor units without floating-point arithmetic. */
export function formatMinorUnits(amountMinor: number, currency: string): string {
  const value = BigInt(Math.trunc(amountMinor));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const major = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, '0');
  return `${currency} ${negative ? '-' : ''}${major.toString()}.${cents}`;
}

export function parseNonNegInt(raw: string, fallback = 0): number {
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

/** Parses a human decimal string (e.g. "12.50") to integer minor units without float math. */
export function parseMajorToMinor(raw: string): number {
  const cleaned = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d*)?$/.test(cleaned)) return 0;
  const [wholePart = '0', fracPart = ''] = cleaned.split('.');
  const cents = fracPart.padEnd(2, '0').slice(0, 2);
  const value = Number.parseInt(wholePart, 10) * 100 + Number.parseInt(cents, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Formats integer minor units as plain decimal string for inputs (e.g. 1250 -> "12.50"). */
export function formatMinorToInput(amountMinor: number): string {
  const abs = Math.max(0, Math.trunc(amountMinor));
  const major = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `${major}.${cents}`;
}

/** Structured error thrown when a SHAC Worker endpoint returns a non-2xx status. */
export class ShacApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ShacApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Parses structured `{ error: { code, message, details } }` payloads safely. */
export async function readApiError(res: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<ShacApiError> {
  const fallbackMsg = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    };
    const code = body?.error?.code ?? `HTTP_${res.status}`;
    const message = body?.error?.message ?? fallbackMsg;
    return new ShacApiError(res.status, code, message, body?.error?.details);
  } catch {
    return new ShacApiError(res.status, `HTTP_${res.status}`, fallbackMsg);
  }
}
