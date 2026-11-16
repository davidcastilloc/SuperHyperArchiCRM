import { verifyApplianceLicense } from '@shac/control-plane';
import { workerApp, type WorkerEnv } from './router.js';
import { setLicenseVerifier } from './system-routes.js';

setLicenseVerifier(verifyApplianceLicense);

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
