import type { CurrencyProfile, RegionPackId } from '@shac/kernel';
import { z } from 'zod';

export const REGION_PACK_IDS = [
  've',
  'co',
  'mx',
  'us',
  'global',
] as const satisfies readonly RegionPackId[];

export const RegionPackIdSchema = z.enum(REGION_PACK_IDS);

export const REGION_DEFAULT_CURRENCIES: Readonly<Record<RegionPackId, CurrencyProfile>> = {
  ve: {
    baseCurrency: 'USD',
    operatingCurrencies: ['USD', 'VES', 'EUR'],
    rateSource: 'bcv',
    enforceAccountCurrencyMatch: true,
  },
  co: {
    baseCurrency: 'COP',
    operatingCurrencies: ['COP', 'USD'],
    rateSource: 'central_bank',
    enforceAccountCurrencyMatch: true,
  },
  mx: {
    baseCurrency: 'MXN',
    operatingCurrencies: ['MXN', 'USD'],
    rateSource: 'central_bank',
    enforceAccountCurrencyMatch: true,
  },
  us: {
    baseCurrency: 'USD',
    operatingCurrencies: ['USD'],
    rateSource: 'manual',
    enforceAccountCurrencyMatch: false,
  },
  global: {
    baseCurrency: 'USD',
    operatingCurrencies: ['USD', 'EUR'],
    rateSource: 'manual',
    enforceAccountCurrencyMatch: false,
  },
};

export function getDefaultCurrencyProfile(regionPack: RegionPackId): CurrencyProfile {
  const base = REGION_DEFAULT_CURRENCIES[regionPack];
  return {
    ...base,
    operatingCurrencies: [...base.operatingCurrencies],
  };
}
