import { DurableObject } from 'cloudflare:workers';
import { workerApp, type WorkerEnv } from './router.js';

export { invalidateProfileCache } from './router.js';
export type { AppRouter, WorkerEnv } from './router.js';

/**
 * Clean Phase 1 stub for BranchInventoryDO; hot-state SQLite logic lands in Phase 2.
 */
export class BranchInventoryDO extends DurableObject<WorkerEnv> {
  async fetch(_request: Request): Promise<Response> {
    return new Response(
      JSON.stringify({ ok: true, actor: 'BranchInventoryDO' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

export default {
  fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Response | Promise<Response> {
    return workerApp.fetch(request, env, ctx);
  },
};
