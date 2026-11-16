import { defineModule, type ModuleManifest } from '@shac/kernel';
import { physicalClipsRecordCommand } from './commands/clips-record.js';
import { physicalLprScanCommand } from './commands/lpr-scan.js';
import { physicalPassesIssueCommand } from './commands/passes-issue.js';
import { physicalPassesValidateCommand } from './commands/passes-validate.js';
import { physicalTamperReportCommand } from './commands/tamper-report.js';

export { physicalClipsRecordCommand } from './commands/clips-record.js';
export { physicalLprScanCommand } from './commands/lpr-scan.js';
export { physicalPassesIssueCommand } from './commands/passes-issue.js';
export { physicalPassesValidateCommand } from './commands/passes-validate.js';
export { physicalTamperReportCommand } from './commands/tamper-report.js';
export {
  sha256DigestHex,
  timingSafeEqual,
  timingSafeEqualStrings,
} from './lib/crypto.js';

export const modPhysicalManifest: ModuleManifest = defineModule({
  id: 'physical',
  version: '0.1.0',
  commands: [
    physicalPassesIssueCommand,
    physicalPassesValidateCommand,
    physicalLprScanCommand,
    physicalClipsRecordCommand,
    physicalTamperReportCommand,
  ],
});
