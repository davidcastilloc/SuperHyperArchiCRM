import { describe, expect, it } from 'vitest';
import { createShacQueryClient } from '../src/lib/queryClient';
import { createRpcClient } from '../src/lib/rpc';

describe('@shac/web-spa offlineFirst & RPC client', () => {
  it('configures QueryClient with networkMode offlineFirst and 24h gcTime', () => {
    const client = createShacQueryClient({ enablePersistence: false });
    const defaults = client.getDefaultOptions();

    expect(defaults.queries?.networkMode).toBe('offlineFirst');
    expect(defaults.mutations?.networkMode).toBe('offlineFirst');
    expect(defaults.queries?.gcTime).toBe(1000 * 60 * 60 * 24);
  });

  it('builds a typed Hono RPC client targeting the provided baseUrl', () => {
    const rpc = createRpcClient('https://edge.shac.local');
    const url = rpc.api.health.$url();

    expect(url.toString()).toBe('https://edge.shac.local/api/health');
  });
});
