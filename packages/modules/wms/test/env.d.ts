export {};

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      BRANCH_DO: DurableObjectNamespace;
    }
  }
}
