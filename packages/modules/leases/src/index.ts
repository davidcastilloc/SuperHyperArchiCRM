import { defineModule, type ModuleManifest } from '@shac/kernel';
import { leasesApplicationsSubmitCommand } from './commands/applications-submit.js';
import { leasesCommunityPostCommand } from './commands/community-post.js';
import { leasesContractsActivateCommand } from './commands/contracts-activate.js';
import { leasesContractsRenewOrVacateCommand } from './commands/contracts-renew-or-vacate.js';

export { leasesApplicationsSubmitCommand } from './commands/applications-submit.js';
export { leasesCommunityPostCommand } from './commands/community-post.js';
export { leasesContractsActivateCommand } from './commands/contracts-activate.js';
export { leasesContractsRenewOrVacateCommand } from './commands/contracts-renew-or-vacate.js';
export {
  computeSplitRentShares,
  SPLIT_RENT_TOTAL_BPS,
  type SplitRentShareAllocation,
  type SplitRentShareInput,
} from './split-rent.js';

export const modLeasesManifest: ModuleManifest = defineModule({
  id: 'leases',
  version: '0.1.0',
  commands: [
    leasesApplicationsSubmitCommand,
    leasesContractsActivateCommand,
    leasesContractsRenewOrVacateCommand,
    leasesCommunityPostCommand,
  ],
});
