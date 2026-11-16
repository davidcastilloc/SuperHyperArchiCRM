import { defineModule, type ModuleManifest } from '@shac/kernel';
import { spacesRackListCommand } from './commands/spaces-rack.js';
import { spacesBookingsReserveCommand } from './commands/spaces-reserve.js';
import { spacesBookingsTransitionCommand } from './commands/spaces-transition.js';
import { spacesWaitlistManageCommand } from './commands/spaces-waitlist.js';

export { spacesRackListCommand } from './commands/spaces-rack.js';
export { spacesBookingsReserveCommand } from './commands/spaces-reserve.js';
export { spacesBookingsTransitionCommand } from './commands/spaces-transition.js';
export { spacesWaitlistManageCommand } from './commands/spaces-waitlist.js';
export {
  computeAdrAndRevParMinor,
  type AdrRevParInput,
  type AdrRevParResult,
} from './pms-math.js';

export const modSpacesManifest: ModuleManifest = defineModule({
  id: 'spaces',
  version: '0.1.0',
  commands: [
    spacesRackListCommand,
    spacesBookingsReserveCommand,
    spacesBookingsTransitionCommand,
    spacesWaitlistManageCommand,
  ],
});
