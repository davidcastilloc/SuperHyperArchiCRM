export {};

declare global {
  namespace Cloudflare {
    interface Env {
      HUB_DB: D1Database;
      HUB_KV: KVNamespace;
    }
  }
}
