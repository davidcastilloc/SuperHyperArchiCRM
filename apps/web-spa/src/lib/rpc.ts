import type { AppRouter } from '@shac/node-worker';
import { hc } from 'hono/client';
import { clearAuthSession, getAuthSession } from './authSession';

export interface RpcClientOptions {
  fetchImpl?: typeof fetch;
}

/** Creates a typed Hono RPC client that attaches active session credentials. */
export function createRpcClient(baseUrl: string, options: RpcClientOptions = {}) {
  const baseFetch = options.fetchImpl ?? fetch;

  const authedFetch: typeof fetch = async (input, init) => {
    const session = getAuthSession();
    const headers = new Headers(init?.headers);
    if (session) {
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${session.token}`);
      }
      if (!headers.has('X-Org-Id')) {
        headers.set('X-Org-Id', session.actor.orgId);
      }
    }
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (
      (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') &&
      !headers.has('Idempotency-Key')
    ) {
      headers.set('Idempotency-Key', crypto.randomUUID());
    }

    const response = await baseFetch(input, { ...init, headers });
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (response.status === 401 && session && !url.includes('/api/auth/')) {
      clearAuthSession();
    }
    return response;
  };

  return hc<AppRouter>(baseUrl, { fetch: authedFetch });
}
