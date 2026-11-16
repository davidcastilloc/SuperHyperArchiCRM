import type { ExecutionContext } from '@shac/kernel';

export { BranchInventoryDO } from '@shac/actor-branch';

export function makeBranchDoResolver(
  ns: DurableObjectNamespace,
): NonNullable<ExecutionContext['branchDo']> {
  return {
    getByBranchKey(key: string) {
      return ns.get(ns.idFromName(key));
    },
  };
}

export default {
  fetch(): Response {
    return new Response('ok');
  },
};
