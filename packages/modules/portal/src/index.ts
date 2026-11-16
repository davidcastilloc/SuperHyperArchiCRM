import { defineModule, type ModuleManifest } from '@shac/kernel';
import { portalRecordsListCommand } from './commands/records-list.js';

export { portalRecordsListCommand } from './commands/records-list.js';

export const modPortalManifest: ModuleManifest = defineModule({
  id: 'portal',
  version: '0.1.0',
  commands: [portalRecordsListCommand],
});
