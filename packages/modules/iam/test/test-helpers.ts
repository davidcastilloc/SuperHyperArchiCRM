import type { ExecutionContext, TenantMarketProfile } from '@shac/kernel';
import type { ShacD1Database } from '@shac/db-d1';
import { vi } from 'vitest';

export const testProfile: TenantMarketProfile = {
  deploymentId: 'dep_1',
  tenantId: 'ten_a',
  editionPreset: 'retail-pos',
  regionPack: 've',
  activeModules: ['iam'],
  vocabulary: {
    partySingular: 'Cliente',
    partyPlural: 'Clientes',
    orderSingular: 'Venta',
    branchSingular: 'Sucursal',
    spaceSingular: 'Caja',
    caseSingular: 'Caso',
  },
  currency: {
    baseCurrency: 'USD',
    operatingCurrencies: ['USD', 'VES'],
    rateSource: 'bcv',
    enforceAccountCurrencyMatch: true,
  },
  entitlements: {
    maxBranches: 5,
    maxPosRegisters: 10,
    maxSpacesOrUnits: 10,
    aiCopilotEnabled: true,
    customEntitiesLimit: 5,
  },
  federation: {
    enabled: false,
    nodeDid: 'did:shac:test',
    publishPublicCatalog: false,
    acceptPeerB2BOrders: false,
    consolidateLowStockHours: 0,
    allowedSupplierDids: [],
  },
  updatedAt: '2026-11-16T00:00:00.000Z',
};

export function makeCtx(overrides?: {
  selectRows?: unknown[][];
  batchResult?: unknown[];
  withKv?: boolean;
}): {
  ctx: ExecutionContext<ShacD1Database>;
  kvPut: ReturnType<typeof vi.fn>;
  batchSpy: ReturnType<typeof vi.fn>;
  insertedValues: unknown[];
} {
  let selectCall = 0;
  const selectQueue = overrides?.selectRows ?? [[]];
  const insertedValues: unknown[] = [];

  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: () => {
      const rows = selectQueue[selectCall] ?? [];
      selectCall += 1;
      return Promise.resolve(rows);
    },
    offset: () => Promise.resolve([]),
  };

  const queryStub = (tag: string) => {
    const q: Record<string, unknown> = {
      tag,
      from: () => q,
      where: () => q,
      orderBy: () => q,
      limit: () => q,
      offset: () => q,
    };
    return q;
  };

  const batchSpy = vi.fn(async (items: unknown[]) => {
    if (overrides?.batchResult) {
      return overrides.batchResult;
    }
    return items.map(() => []);
  });

  const db = {
    select: (fields?: unknown) => (fields ? queryStub('select') : selectChain),
    insert: () => ({
      values: (vals: unknown) => {
        insertedValues.push(vals);
        return { kind: 'insert', vals };
      },
    }),
    batch: batchSpy,
  } as unknown as ShacD1Database;

  const kvPut = vi.fn(async () => undefined);
  const kvGet = vi.fn(async () => null);

  const ctx: ExecutionContext<ShacD1Database> = {
    tenantId: 'ten_a',
    orgId: 'org_root',
    orgPath: '/root',
    actor: {
      id: 'usr_admin',
      type: 'staff',
      perms: ['iam.*'],
    },
    profile: testProfile,
    db,
    ...(overrides?.withKv === false
      ? {}
      : {
          sessionKv: {
            get: kvGet,
            put: kvPut,
          } as unknown as ExecutionContext<ShacD1Database>['sessionKv'],
        }),
  };

  return { ctx, kvPut, batchSpy, insertedValues };
}
