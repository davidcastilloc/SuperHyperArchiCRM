import { defineModule, type ModuleManifest } from '@shac/kernel';
import { automationProposalsDecideCommand } from './commands/proposals-decide.js';
import { automationRulesEvaluateCommand } from './commands/rules-evaluate.js';

export { automationProposalsDecideCommand } from './commands/proposals-decide.js';
export { automationRulesEvaluateCommand } from './commands/rules-evaluate.js';
export { evaluateConditionAst } from './rule-evaluator.js';

export const modAutomationManifest: ModuleManifest = defineModule({
  id: 'automation',
  version: '0.1.0',
  commands: [automationRulesEvaluateCommand, automationProposalsDecideCommand],
});
