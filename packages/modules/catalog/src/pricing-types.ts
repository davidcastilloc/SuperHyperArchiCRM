import type { OmnibusPricePoint } from './pricing-math.js';

export type PricingLayer =
  | 'CONTRACT_1TO1'
  | 'GROUP_TARIFF'
  | 'PROMOTION_CHANNEL'
  | 'VARIANT_UOM'
  | 'BASE_PRICE';

export interface PricingProductInput {
  id: string;
  basePriceMinor: number;
  costPriceMinor: number;
  primaryCurrency: string;
  taxRateBps: number;
  isFixedPrice?: boolean;
}

export interface PricingVariantInput {
  id: string;
  uomFactorMicros: number;
  overridePriceMinor?: number | null;
}

export interface PricingRuleCandidate {
  id: string;
  priceListId?: string | null;
  tariffKind?: string | null;
  priceListCurrency?: string | null;
  priceListIsDefault?: boolean | null;
  priceListIsActive?: boolean | null;
  priceListValidFrom?: number | null;
  priceListValidTo?: number | null;
  variantId?: string | null;
  targetPartyId?: string | null;
  targetGroupId?: string | null;
  channelId?: string | null;
  minQty?: number | null;
  maxQty?: number | null;
  unitPriceMinor?: number | null;
  discountBps?: number | null;
  startsAt?: number | null;
  endsAt?: number | null;
}

export interface SecondaryFxRateInput {
  secondaryCurrency: string;
  rateMicros: number;
}

export interface PricingEngineInput {
  product: PricingProductInput;
  variant?: PricingVariantInput | null;
  qty?: number;
  nowSec?: number;
  partyId?: string | null;
  groupIds?: readonly string[];
  priceListId?: string | null;
  tariffKind?: string | null;
  channelId?: string | null;
  rules?: readonly PricingRuleCandidate[];
  allowBelowCost?: boolean;
  minMarginBps?: number;
  fxRate?: SecondaryFxRateInput | null;
  omnibusHistory?: readonly OmnibusPricePoint[];
  lowest30dMinor?: number | null;
}

export interface PricingEngineResult {
  unitPriceMinor: number;
  unitCostMinor: number;
  baseReferencePriceMinor: number;
  appliedLayer: PricingLayer;
  appliedRuleId: string | null;
  appliedPriceListId: string | null;
  marginBps: number;
  taxRateBps: number;
  unitTaxMinor: number;
  unitPriceWithTaxMinor: number;
  qty: number;
  lineSubtotalMinor: number;
  lineTaxMinor: number;
  lineTotalMinor: number;
  primaryCurrency: string;
  secondaryCurrency: string | null;
  rateMicros: number | null;
  secondaryUnitPriceMinor: number | null;
  secondaryUnitPriceWithTaxMinor: number | null;
  secondaryLineTotalMinor: number | null;
  lowest30dMinor: number | null;
  isBelow30dLowest: boolean;
}
