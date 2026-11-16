import type { BranchInventoryDO } from '../src/index.js';

declare global {
  namespace Cloudflare {
    interface Env {
      BRANCH_DO: DurableObjectNamespace<BranchInventoryDO>;
    }
  }
}
