import { defineModule, type ModuleManifest } from '@shac/kernel';
import {
  iamApiKeysCreateCommand,
  iamDelegationIssuePinCommand,
} from './commands/delegation.js';
import {
  iamOrgsCreateCommand,
  iamOrgsListCommand,
} from './commands/organizations.js';

export {
  iamOrgsCreateCommand,
  iamOrgsListCommand,
} from './commands/organizations.js';
export {
  iamApiKeysCreateCommand,
  iamDelegationIssuePinCommand,
} from './commands/delegation.js';

export const iamModule: ModuleManifest = defineModule({
  id: 'iam',
  version: '0.1.0',
  commands: [
    iamOrgsCreateCommand,
    iamOrgsListCommand,
    iamApiKeysCreateCommand,
    iamDelegationIssuePinCommand,
  ],
});
