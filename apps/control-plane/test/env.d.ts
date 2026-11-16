export {};

declare global {
  namespace Cloudflare {
    interface Env {
      CP_DB: D1Database;
      CP_KV: KVNamespace;
    }
  }
}
