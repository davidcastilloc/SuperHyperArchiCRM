import { BranchInventoryDO } from '@shac/actor-branch';
import type { ExecutionContext } from '@shac/kernel';

export { BranchInventoryDO };

export function createWorkerdBranchResolver(
  namespace: DurableObjectNamespace<BranchInventoryDO>,
): NonNullable<ExecutionContext['branchDo']> {
  return {
    getByBranchKey(key: string) {
      return namespace.get(namespace.idFromName(key));
    },
  };
}
