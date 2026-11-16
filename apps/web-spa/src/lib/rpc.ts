import type { AppRouter } from '@shac/node-worker';
import { hc } from 'hono/client';

/** Creates a typed Hono RPC client bound to the given edge Worker base URL. */
export function createRpcClient(baseUrl: string) {
  return hc<AppRouter>(baseUrl);
}
