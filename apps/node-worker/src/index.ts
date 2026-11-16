import { workerApp, type WorkerEnv } from './router.js';

export { BranchInventoryDO } from '@shac/actor-branch';
export { invalidateProfileCache } from './router.js';
export type { AppRouter, WorkerEnv } from './router.js';

export default {
  fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Response | Promise<Response> {
    return workerApp.fetch(request, env, ctx);
  },
};
