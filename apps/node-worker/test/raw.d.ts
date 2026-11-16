import type { WorkerEnv } from '../src/router.js';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
