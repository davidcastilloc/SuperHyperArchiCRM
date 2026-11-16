import { defineModule, type ModuleManifest } from '@shac/kernel';
import { regionalFiscalStampCommand } from './commands/stamp-invoice.js';
import { regionalTaxIdValidateCommand } from './commands/validate-tax-id.js';

export { regionalFiscalStampCommand } from './commands/stamp-invoice.js';
export {
  stampInvoiceInputSchema,
  stampInvoiceOutputSchema,
  type StampInvoiceInput,
  type StampInvoiceOutput,
} from './commands/stamp-schemas.js';
export {
  regionalTaxIdValidateCommand,
  validateTaxIdInputSchema,
  validateTaxIdOutputSchema,
  type ValidateTaxIdInput,
  type ValidateTaxIdOutput,
} from './commands/validate-tax-id.js';
export {
  BPS_SCALE,
  computeBpsAmount,
  computeClabeCheckDigit,
  computeRegionalFiscalBreakdown,
  formatMinorDecimal,
  MICROS_SCALE,
  sha384Hex,
  validateSpeiClabe,
  type CoDianSummary,
  type FiscalLineInput,
  type MxSatAndPaymentsSummary,
  type RegionalFiscalBreakdown,
  type RegionalFiscalInput,
  type UsSalesTaxSummary,
  type VeHkaZReportSummary,
} from './fiscal-engines.js';
export {
  computeCoNitCheckDigit,
  REGIONAL_TAX_ID_TYPES,
  validateRegionalTaxId,
  type RegionalTaxIdType,
  type ValidatedTaxId,
} from './tax-ids.js';

export const modRegionalManifest: ModuleManifest = defineModule({
  id: 'regional',
  version: '0.1.0',
  commands: [regionalTaxIdValidateCommand, regionalFiscalStampCommand],
});
