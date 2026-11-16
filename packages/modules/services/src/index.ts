import { defineModule, type ModuleManifest } from '@shac/kernel';
import { servicesEvvRecordCommand } from './commands/evv-record.js';
import { servicesRmaClaimCommand } from './commands/rma-claim.js';
import { servicesWorkOrdersUpsertCommand } from './commands/work-orders-upsert.js';

export { servicesEvvRecordCommand } from './commands/evv-record.js';
export { servicesRmaClaimCommand } from './commands/rma-claim.js';
export { servicesWorkOrdersUpsertCommand } from './commands/work-orders-upsert.js';
export {
  computeDistanceMeters,
  DEFAULT_EVV_GEOFENCE_METERS,
} from './lib/geofence.js';

export const modServicesManifest: ModuleManifest = defineModule({
  id: 'services',
  version: '0.1.0',
  commands: [
    servicesWorkOrdersUpsertCommand,
    servicesRmaClaimCommand,
    servicesEvvRecordCommand,
  ],
});
