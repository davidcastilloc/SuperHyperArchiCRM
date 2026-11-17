import { useEffect, useRef, useState } from 'react';

export interface ScannableProduct {
  id: string;
  sku: string;
  name: string;
  basePriceMinor: number;
}

/** Case-insensitive exact SKU/barcode matcher for instant POS scan-to-cart. */
export function findProductByScanCode<T extends ScannableProduct>(
  products: readonly T[],
  rawCode: string,
): T | null {
  const normalized = rawCode.trim().toLowerCase();
  if (!normalized) return null;
  return products.find((p) => p.sku.trim().toLowerCase() === normalized) ?? null;
}

/** Integer basis-point discount calculation (0..10000 bps -> 0%..100%). */
export function applyLineDiscountMinor(lineMinor: number, discountBps = 0): number {
  const safeMinor = Math.max(0, Math.trunc(lineMinor));
  const clampedBps = Math.max(0, Math.min(10_000, Math.trunc(discountBps)));
  return Math.round((safeMinor * (10_000 - clampedBps)) / 10_000);
}

/** Computes remaining balance and dual USD/VES change using BigInt rate math. */
export function computeDualChangeMinor(input: {
  totalUsdMinor: number;
  paidUsdMinor: number;
  paidVesMinor: number;
  rateMicros: number;
}): { remainingUsdMinor: number; changeUsdMinor: number; changeVesMinor: number } {
  const safeRate = input.rateMicros > 0 ? BigInt(input.rateMicros) : 1_000_000n;
  const vesAsUsdMinor = Number((BigInt(Math.max(0, input.paidVesMinor)) * 1_000_000n + safeRate / 2n) / safeRate);
  const totalPaidUsdMinor = Math.max(0, input.paidUsdMinor) + vesAsUsdMinor;
  const diff = totalPaidUsdMinor - Math.max(0, input.totalUsdMinor);
  if (diff < 0) {
    return { remainingUsdMinor: Math.abs(diff), changeUsdMinor: 0, changeVesMinor: 0 };
  }
  const changeVesMinor = Number((BigInt(diff) * safeRate + 500_000n) / 1_000_000n);
  return { remainingUsdMinor: 0, changeUsdMinor: diff, changeVesMinor };
}

/** Debounces a reactive value (default 300ms, matching GeorginaPOS PList). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Global USB/Bluetooth HID barcode scanner listener.
 * Detects rapid keystroke bursts (< 60ms between chars) ending with Enter when focus is not inside an input.
 */
export function useGlobalBarcodeHid(onScan: (code: string) => void, enabled = true): void {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;

      const now = performance.now();
      if (now - lastKeyTimeRef.current > 80) {
        bufferRef.current = '';
      }
      lastKeyTimeRef.current = now;

      if (e.key === 'Enter') {
        if (bufferRef.current.length >= 3) {
          e.preventDefault();
          onScanRef.current(bufferRef.current);
        }
        bufferRef.current = '';
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        bufferRef.current += e.key;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
