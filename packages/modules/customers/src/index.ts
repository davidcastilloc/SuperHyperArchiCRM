import { defineModule, type ModuleManifest } from '@shac/kernel';
import {
  customersConflictsCheckCommand,
  customersDealsCreateCommand,
} from './commands/deals-and-conflicts.js';
import { customersDealsListCommand } from './commands/deals-list.js';
import { customersDealsStageCommand } from './commands/deals-stage.js';
import {
  customersInteractionsListCommand,
  customersInteractionsUpsertCommand,
} from './commands/interactions.js';
import { customersPartiesListCommand } from './commands/parties-list.js';
import { customersPartiesUpsertCommand } from './commands/parties-upsert.js';
import { customersLinksCreateCommand } from './commands/party-links.js';

export {
  customersDealsCreateCommand,
  customersConflictsCheckCommand,
} from './commands/deals-and-conflicts.js';
export { customersDealsListCommand } from './commands/deals-list.js';
export { customersDealsStageCommand } from './commands/deals-stage.js';
export {
  customersInteractionsListCommand,
  customersInteractionsUpsertCommand,
} from './commands/interactions.js';
export { customersPartiesListCommand } from './commands/parties-list.js';
export { customersPartiesUpsertCommand } from './commands/parties-upsert.js';
export { customersLinksCreateCommand } from './commands/party-links.js';

export const modCustomersManifest: ModuleManifest = defineModule({
  id: 'customers',
  version: '0.1.0',
  commands: [
    customersPartiesUpsertCommand,
    customersPartiesListCommand,
    customersLinksCreateCommand,
    customersDealsCreateCommand,
    customersDealsListCommand,
    customersDealsStageCommand,
    customersInteractionsListCommand,
    customersInteractionsUpsertCommand,
    customersConflictsCheckCommand,
  ],
});
