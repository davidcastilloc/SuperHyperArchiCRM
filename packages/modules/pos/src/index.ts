import { defineModule, type ModuleManifest } from '@shac/kernel';
import { posSalesCheckoutCommand } from './commands/pos-checkout.js';
import { posOrdersListCommand } from './commands/pos-orders-list.js';
import {
  posShiftsCloseCommand,
  posShiftsOpenCommand,
} from './commands/pos-shifts.js';
import {
  posKioskSmartCheckCommand,
  posReturnsSettleCommand,
} from './commands/smartcheck-and-returns.js';

export { posSalesCheckoutCommand } from './commands/pos-checkout.js';
export { posOrdersListCommand } from './commands/pos-orders-list.js';
export {
  posShiftsCloseCommand,
  posShiftsOpenCommand,
} from './commands/pos-shifts.js';
export {
  posKioskSmartCheckCommand,
  posReturnsSettleCommand,
} from './commands/smartcheck-and-returns.js';
export {
  assertAccountCurrencyMatch,
  assertNonNegativeSafeInt,
  assertPositiveRateMicros,
  computeRemainingTender,
  computeTaxInclusiveAmounts,
  convertPaymentLineToOrderMinor,
  normalizeCurrency,
  type RemainingTenderResult,
  type TaxInclusiveAmountResult,
  type TenderPaymentLine,
} from './tender-engine.js';

export const modPosManifest: ModuleManifest = defineModule({
  id: 'pos',
  version: '0.1.0',
  commands: [
    posShiftsOpenCommand,
    posShiftsCloseCommand,
    posSalesCheckoutCommand,
    posOrdersListCommand,
    posKioskSmartCheckCommand,
    posReturnsSettleCommand,
  ],
});
