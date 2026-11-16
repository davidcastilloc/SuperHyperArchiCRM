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
