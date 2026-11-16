import { defineModule, type ModuleManifest } from '@shac/kernel';
import { casesLegalMatterDocketCommand } from './commands/legal-matter-docket.js';
import { casesMedAbaTrialCommand } from './commands/med-aba-trial.js';
import { casesMedSoapNoteCommand } from './commands/med-soap-note.js';

export { casesLegalMatterDocketCommand } from './commands/legal-matter-docket.js';
export { casesMedAbaTrialCommand } from './commands/med-aba-trial.js';
export { casesMedSoapNoteCommand } from './commands/med-soap-note.js';

export const modCasesManifest: ModuleManifest = defineModule({
  id: 'cases',
  version: '0.1.0',
  commands: [
    casesMedSoapNoteCommand,
    casesMedAbaTrialCommand,
    casesLegalMatterDocketCommand,
  ],
});
