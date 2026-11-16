import { defineModule, type ModuleManifest } from '@shac/kernel';
import {
  catalogProductsListCommand,
  catalogProductsUpsertCommand,
} from './commands/products.js';
import { catalogPricingQuoteCommand } from './commands/quote-price.js';
import {
  catalogLabelsBatchCommand,
  catalogRatesUpsertCommand,
} from './commands/rates-and-labels.js';

export {
  catalogProductsListCommand,
  catalogProductsUpsertCommand,
} from './commands/products.js';
export { catalogPricingQuoteCommand } from './commands/quote-price.js';
export {
  catalogLabelsBatchCommand,
  catalogRatesUpsertCommand,
} from './commands/rates-and-labels.js';
export {
  BPS_SCALE,
  computeBpsAmount,
  computeLowest30dMinor,
  computeMarginBps,
  convertCurrencyMinor,
  MICROS_SCALE,
  multiplyMicros,
  OMNIBUS_WINDOW_SEC,
  resolveFiveLayerPrice,
  type OmnibusPricePoint,
  type PricingEngineInput,
  type PricingEngineResult,
  type PricingLayer,
  type PricingProductInput,
  type PricingRuleCandidate,
  type PricingVariantInput,
  type SecondaryFxRateInput,
} from './pricing-engine.js';

export const modCatalogManifest: ModuleManifest = defineModule({
  id: 'catalog',
  version: '0.1.0',
  commands: [
    catalogProductsUpsertCommand,
    catalogProductsListCommand,
    catalogPricingQuoteCommand,
    catalogRatesUpsertCommand,
    catalogLabelsBatchCommand,
  ],
});
