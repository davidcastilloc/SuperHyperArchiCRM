import { defineModule, type ModuleManifest } from '@shac/kernel';
import {
  wmsFleetCompleteEpodCommand,
  wmsLandedCostsAllocateCommand,
} from './commands/landed-costs-and-epod.js';
import {
  wmsPickingsListCommand,
  wmsPickingsProcessCommand,
} from './commands/pickings-and-backorder.js';

export {
  wmsFleetCompleteEpodCommand,
  wmsLandedCostsAllocateCommand,
} from './commands/landed-costs-and-epod.js';
export {
  wmsPickingsListCommand,
  wmsPickingsProcessCommand,
} from './commands/pickings-and-backorder.js';
export {
  assertValidGs1CheckDigit,
  computeGs1CheckDigit,
  parseGs1Barcode,
  type ParsedGs1Barcode,
} from './gs1-parser.js';
export {
  allocateLandedCosts,
  computeAvcoValuation,
  QTY_MICROS_SCALE,
  type AllocatedLandedCostLine,
  type AvcoValuationInput,
  type AvcoValuationResult,
  type LandedCostAllocationResult,
  type LandedCostLineInput,
  type LandedCostSplitMethod,
} from './valuation-engine.js';

export const modWmsManifest: ModuleManifest = defineModule({
  id: 'wms',
  version: '0.1.0',
  commands: [
    wmsPickingsProcessCommand,
    wmsPickingsListCommand,
    wmsLandedCostsAllocateCommand,
    wmsFleetCompleteEpodCommand,
  ],
});
