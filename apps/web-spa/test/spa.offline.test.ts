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

  it('builds a typed Hono RPC client covering Phase 1 & Phase 2 routes', () => {
    const rpc = createRpcClient('https://edge.shac.local');

    expect(rpc.api.health.$url().toString()).toBe('https://edge.shac.local/api/health');
    expect(rpc.api.customers.parties.$url().toString()).toBe(
      'https://edge.shac.local/api/customers/parties',
    );
    expect(rpc.api.catalog.products.$url().toString()).toBe(
      'https://edge.shac.local/api/catalog/products',
    );
    expect(rpc.api.catalog.pricing.quote.$url().toString()).toBe(
      'https://edge.shac.local/api/catalog/pricing/quote',
    );
    expect(rpc.api.branch.inventory['receive-lot'].$url().toString()).toBe(
      'https://edge.shac.local/api/branch/inventory/receive-lot',
    );
    expect(rpc.api.branch.inventory['allocate-fefo'].$url().toString()).toBe(
      'https://edge.shac.local/api/branch/inventory/allocate-fefo',
    );
    expect(rpc.api.branch.inventory.balances.$url().toString()).toBe(
      'https://edge.shac.local/api/branch/inventory/balances',
    );
  });
});
