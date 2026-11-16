import { defineModule, type ModuleManifest } from '@shac/kernel';
import { financeJournalPostCommand } from './commands/journal-post.js';
import { financeTrustTransactCommand } from './commands/trust-transact.js';

export { financeJournalPostCommand } from './commands/journal-post.js';
export { financeTrustTransactCommand } from './commands/trust-transact.js';
export {
  computeNextTrustBalanceMinor,
  sumJournalLinesBigInt,
  toBigIntMinor,
  toSafeNumberMinor,
  type JournalBalanceSummary,
  type JournalLineInput,
  type TrustBalanceComputation,
  type TrustTxKind,
} from './lib/money-bigint.js';

export const modFinanceManifest: ModuleManifest = defineModule({
  id: 'finance',
  version: '0.1.0',
  commands: [financeTrustTransactCommand, financeJournalPostCommand],
});
