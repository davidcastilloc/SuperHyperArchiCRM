import { describe, expect, it } from 'vitest';
import {
  AppError,
  authenticateRequest,
  createProfileLoader,
  enforceModuleGate,
  generateEd25519KeyPair,
  sha256Hex,
  signJwtEdDsa,
  type TenantMarketProfile,
} from '../src/index.js';

function createMemoryKv(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  let getCalls = 0;

  const kv = {
    async get(key: string): Promise<string | null> {
      getCalls += 1;
      return store.get(key) ?? null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
  } as unknown as KVNamespace;

  return {
    kv,
    getCallCount: () => getCalls,
    setRaw: (key: string, value: string) => store.set(key, value),
    deleteRaw: (key: string) => store.delete(key),
  };
}

const VALID_PROFILE: TenantMarketProfile = {
  deploymentId: 'dep_1',
  tenantId: 'ten_1',
  editionPreset: 'retail-pos',
  regionPack: 've',
  activeModules: ['iam', 'pos'],
  vocabulary: {
    partySingular: 'Cliente',
    partyPlural: 'Clientes',
    orderSingular: 'Ticket',
    branchSingular: 'Tienda',
    spaceSingular: 'Caja',
    caseSingular: 'Reclamo',
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
    maxSpacesOrUnits: 20,
    aiCopilotEnabled: true,
    customEntitiesLimit: 10,
  },
  federation: {
    enabled: false,
    nodeDid: 'did:shac:ten_1',
    publishPublicCatalog: false,
    acceptPeerB2BOrders: false,
    consolidateLowStockHours: 24,
    allowedSupplierDids: [],
  },
  updatedAt: '2026-11-16T12:00:00Z',
};

describe('@shac/kernel pipeline guards', () => {
  it('caches profile:current in memory for TTL and fails closed on missing/corrupt KV', async () => {
    const mem = createMemoryKv({
      'profile:current': JSON.stringify(VALID_PROFILE),
    });
    const loader = createProfileLoader(60_000);

    const first = await loader.load(mem.kv);
    const second = await loader.load(mem.kv);
    expect(first.tenantId).toBe('ten_1');
    expect(second.editionPreset).toBe('retail-pos');
    expect(mem.getCallCount()).toBe(1);

    loader.invalidate();
    mem.deleteRaw('profile:current');
    await expect(loader.load(mem.kv)).rejects.toMatchObject({
      code: 'PROFILE_UNAVAILABLE',
      status: 503,
    });

    mem.setRaw('profile:current', '{corrupt-json');
    await expect(loader.load(mem.kv)).rejects.toBeInstanceOf(AppError);
    await expect(loader.load(mem.kv)).rejects.toMatchObject({
      code: 'PROFILE_UNAVAILABLE',
      status: 503,
    });
  });

  it('enforces moduleGate with 403 MODULE_NOT_ENABLED when module is disabled', () => {
    expect(() => enforceModuleGate(VALID_PROFILE, 'iam')).not.toThrow();
    expect(() => enforceModuleGate(VALID_PROFILE, 'wms')).toThrow(AppError);
    try {
      enforceModuleGate(VALID_PROFILE, 'wms');
    } catch (err) {
      expect(err).toMatchObject({ code: 'MODULE_NOT_ENABLED', status: 403 });
    }
  });

  it('authenticates Bearer JWT, Bearer mk_live_ API key, and X-Delegation-Pin', async () => {
    const keys = await generateEd25519KeyPair();
    const apiKey = 'mk_live_secret_token_123';
    const apiKeyHash = await sha256Hex(apiKey);
    const pin = '482910';
    const pinHash = await sha256Hex(pin);
    const expiredPin = '999999';
    const expiredPinHash = await sha256Hex(expiredPin);

    const sessionMem = createMemoryKv({
      [`apikey:${apiKeyHash}`]: JSON.stringify({
        keyId: 'key_1',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        perms: ['iam.read'],
      }),
      [`delegation:${pinHash}`]: JSON.stringify({
        userId: 'usr_cashier',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        perms: ['pos.sell'],
        delegatedById: 'usr_mgr',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      }),
      [`delegation:${expiredPinHash}`]: JSON.stringify({
        userId: 'usr_cashier',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        perms: ['pos.sell'],
        delegatedById: 'usr_mgr',
        expiresAt: Math.floor(Date.now() / 1000) - 10,
      }),
    });

    // 1. JWT
    const jwt = await signJwtEdDsa(
      {
        sub: 'usr_admin',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        actorType: 'staff',
        perms: ['*'],
      },
      keys.privateKeyJwk,
      300,
    );
    const jwtActor = await authenticateRequest(
      new Headers({ Authorization: `Bearer ${jwt}` }),
      sessionMem.kv,
      keys.publicKeyJwk,
    );
    expect(jwtActor.id).toBe('usr_admin');
    expect(jwtActor.type).toBe('staff');

    // 2. API Key
    const apiActor = await authenticateRequest(
      new Headers({ Authorization: `Bearer ${apiKey}` }),
      sessionMem.kv,
      keys.publicKeyJwk,
    );
    expect(apiActor.id).toBe('key_1');
    expect(apiActor.type).toBe('api_key');

    // 3. Valid Delegation PIN
    const pinActor = await authenticateRequest(
      new Headers({ 'X-Delegation-Pin': pin, 'X-Org-Id': 'org_1' }),
      sessionMem.kv,
      keys.publicKeyJwk,
    );
    expect(pinActor.type).toBe('delegated_staff');
    expect(pinActor.delegatedById).toBe('usr_mgr');

    // 4. Delegation PIN used from wrong org -> 401 INVALID_DELEGATION_PIN
    await expect(
      authenticateRequest(
        new Headers({ 'X-Delegation-Pin': pin, 'X-Org-Id': 'org_other' }),
        sessionMem.kv,
        keys.publicKeyJwk,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DELEGATION_PIN', status: 401 });

    // 5. Expired Delegation PIN -> 401 INVALID_DELEGATION_PIN
    await expect(
      authenticateRequest(
        new Headers({ 'X-Delegation-Pin': expiredPin }),
        sessionMem.kv,
        keys.publicKeyJwk,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DELEGATION_PIN', status: 401 });
  });
});
