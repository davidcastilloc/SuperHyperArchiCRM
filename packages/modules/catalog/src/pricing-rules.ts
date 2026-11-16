import { AppError } from '@shac/kernel';
import {
  assertSafeInt,
  BPS_SCALE,
  computeBpsAmount,
  MICROS_SCALE,
  multiplyMicros,
} from './pricing-math.js';
import type {
  PricingEngineInput,
  PricingLayer,
  PricingRuleCandidate,
} from './pricing-types.js';

export function isRuleEligible(
  rule: PricingRuleCandidate,
  nowSec: number,
  qty: number,
  variantId: string | null,
  primaryCurrency: string,
): boolean {
  if (rule.priceListIsActive === false) return false;
  if (rule.priceListCurrency && rule.priceListCurrency !== primaryCurrency) return false;
  if (rule.priceListValidFrom != null && nowSec < rule.priceListValidFrom) return false;
  if (rule.priceListValidTo != null && nowSec > rule.priceListValidTo) return false;
  if (rule.startsAt != null && nowSec < rule.startsAt) return false;
  if (rule.endsAt != null && nowSec > rule.endsAt) return false;
  if (rule.variantId != null && rule.variantId !== variantId) return false;
  if (qty < (rule.minQty ?? 1)) return false;
  if (rule.maxQty != null && qty > rule.maxQty) return false;
  return rule.unitPriceMinor != null || rule.discountBps != null;
}

function resolveRulePrice(
  rule: PricingRuleCandidate,
  baselinePriceMinor: number,
  uomFactorMicros: number,
): number {
  let price = baselinePriceMinor;
  if (rule.unitPriceMinor != null) {
    const rawUnit = assertSafeInt(rule.unitPriceMinor, 'rule.unitPriceMinor');
    price =
      rule.variantId == null && uomFactorMicros !== MICROS_SCALE
        ? multiplyMicros(rawUnit, uomFactorMicros)
        : rawUnit;
  }
  if (rule.discountBps != null) {
    const discountBps = assertSafeInt(rule.discountBps, 'rule.discountBps');
    if (discountBps < 0 || discountBps > BPS_SCALE) {
      throw new AppError('INVALID_DISCOUNT_BPS', 400, 'discountBps must be in 0..10000');
    }
    price = Math.max(0, price - computeBpsAmount(price, discountBps));
  }
  return price;
}

function selectBestRule(
  candidates: readonly PricingRuleCandidate[],
  baselinePriceMinor: number,
  uomFactorMicros: number,
  variantId: string | null,
): { rule: PricingRuleCandidate; unitPriceMinor: number } | null {
  let best: {
    rule: PricingRuleCandidate;
    unitPriceMinor: number;
    specificity: number;
    minQty: number;
  } | null = null;

  for (const rule of candidates) {
    const unitPriceMinor = resolveRulePrice(rule, baselinePriceMinor, uomFactorMicros);
    const specificity =
      (rule.variantId != null && rule.variantId === variantId ? 2 : 0) +
      (rule.targetGroupId != null ? 1 : 0);
    const minQty = rule.minQty ?? 1;
    if (
      !best ||
      specificity > best.specificity ||
      (specificity === best.specificity && minQty > best.minQty) ||
      (specificity === best.specificity &&
        minQty === best.minQty &&
        unitPriceMinor < best.unitPriceMinor)
    ) {
      best = { rule, unitPriceMinor, specificity, minQty };
    }
  }
  return best ? { rule: best.rule, unitPriceMinor: best.unitPriceMinor } : null;
}

export function pickWinningLayer(
  eligibleRules: readonly PricingRuleCandidate[],
  input: PricingEngineInput,
  baselinePriceMinor: number,
  baselineLayer: PricingLayer,
  uomFactorMicros: number,
) {
  const variantId = input.variant?.id ?? null;
  const groupSet = new Set(input.groupIds ?? []);

  const l1 = input.partyId
    ? selectBestRule(
        eligibleRules.filter((r) => r.targetPartyId === input.partyId),
        baselinePriceMinor,
        uomFactorMicros,
        variantId,
      )
    : null;
  if (l1) {
    return {
      unitPriceMinor: l1.unitPriceMinor,
      appliedLayer: 'CONTRACT_1TO1' as const,
      appliedRuleId: l1.rule.id,
      appliedPriceListId: l1.rule.priceListId ?? null,
    };
  }

  const l2 = selectBestRule(
    eligibleRules.filter(
      (r) =>
        r.targetPartyId == null &&
        ((r.targetGroupId != null && groupSet.has(r.targetGroupId)) ||
          (r.targetGroupId == null &&
            r.channelId == null &&
            r.tariffKind !== 'promotion' &&
            r.tariffKind !== 'contract_1to1' &&
            ((input.priceListId != null && r.priceListId === input.priceListId) ||
              (input.tariffKind != null && r.tariffKind === input.tariffKind) ||
              (input.priceListId == null &&
                input.tariffKind == null &&
                r.priceListIsDefault === true)))),
    ),
    baselinePriceMinor,
    uomFactorMicros,
    variantId,
  );
  if (l2) {
    return {
      unitPriceMinor: l2.unitPriceMinor,
      appliedLayer: 'GROUP_TARIFF' as const,
      appliedRuleId: l2.rule.id,
      appliedPriceListId: l2.rule.priceListId ?? null,
    };
  }

  const l3 = input.product.isFixedPrice
    ? null
    : selectBestRule(
        eligibleRules.filter(
          (r) =>
            r.targetPartyId == null &&
            r.targetGroupId == null &&
            ((input.channelId != null && r.channelId === input.channelId) ||
              (r.channelId == null && r.tariffKind === 'promotion')),
        ),
        baselinePriceMinor,
        uomFactorMicros,
        variantId,
      );
  if (l3) {
    return {
      unitPriceMinor: l3.unitPriceMinor,
      appliedLayer: 'PROMOTION_CHANNEL' as const,
      appliedRuleId: l3.rule.id,
      appliedPriceListId: l3.rule.priceListId ?? null,
    };
  }

  return {
    unitPriceMinor: baselinePriceMinor,
    appliedLayer: baselineLayer,
    appliedRuleId: null,
    appliedPriceListId: null,
  };
}
