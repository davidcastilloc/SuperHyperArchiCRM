import { generateEd25519KeyPair, signJwtEdDsa } from '@shac/kernel';
import type { WorkerEnv } from '../src/router.js';
import { MCP_HEADERS, parseMcpJson } from './test-helpers.js';

export const DAY_MS = 86_400_000;

export const mockCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

export const EXPECTED_PHASE3_MCP_TOOLS = [
  'regional.tax_id.validate',
  'regional.fiscal.stamp',
  'pos.shifts.open',
  'pos.shifts.close',
  'pos.sales.checkout',
  'pos.kiosk.smartcheck',
  'pos.returns.settle',
  'wms.pickings.process',
  'wms.pickings.list',
  'wms.landed_costs.allocate',
  'wms.fleet.complete_epod',
] as const;

export async function createPhase3Tokens() {
  const keys = await generateEd25519KeyPair();
  const fullPerms = [
    'iam.*',
    'customers.*',
    'catalog.*',
    'regional.*',
    'pos.*',
    'wms.*',
    'branch.inventory.read',
    'branch.inventory.write',
  ];
  const tokenTen1 = await signJwtEdDsa(
    {
      sub: 'usr_p3_1',
      tenantId: 'ten_1',
      orgId: 'org_1',
      orgPath: '/org_1',
      actorType: 'staff',
      perms: fullPerms,
    },
    keys.privateKeyJwk,
    600,
  );
  const tokenTen2 = await signJwtEdDsa(
    {
      sub: 'usr_p3_2',
      tenantId: 'ten_2',
      orgId: 'org_2',
      orgPath: '/org_2',
      actorType: 'staff',
      perms: fullPerms,
    },
    keys.privateKeyJwk,
    600,
  );
  const tokenReadOnly = await signJwtEdDsa(
    {
      sub: 'usr_p3_ro',
      tenantId: 'ten_1',
      orgId: 'org_1',
      orgPath: '/org_1',
      actorType: 'staff',
      perms: ['pos.kiosk.read', 'wms.pickings.read'],
    },
    keys.privateKeyJwk,
    600,
  );
  return { keys, tokenTen1, tokenTen2, tokenReadOnly };
}

type AppFetch = {
  fetch: (
    req: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ) => Response | Promise<Response>;
};

export async function callWorkerJson<T>(
  app: AppFetch,
  testEnv: WorkerEnv,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await app.fetch(
    new Request(`https://example.com${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    testEnv,
    mockCtx,
  );
  return { status: res.status, data: (await res.json()) as T };
}

export async function callMcp(
  app: AppFetch,
  testEnv: WorkerEnv,
  token: string | null,
  method: string,
  params: Record<string, unknown>,
  id = 1,
): Promise<Record<string, unknown>> {
  const res = await app.fetch(
    new Request('https://example.com/mcp', {
      method: 'POST',
      headers: {
        ...MCP_HEADERS,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }),
    testEnv,
    mockCtx,
  );
  if (res.status !== 200) {
    throw new Error(`MCP ${method} failed with status ${res.status}`);
  }
  return parseMcpJson(res);
}

export async function callMcpTool<T = Record<string, unknown>>(
  app: AppFetch,
  testEnv: WorkerEnv,
  token: string,
  name: string,
  args: Record<string, unknown>,
  id: number,
): Promise<T> {
  const res = await callMcp(app, testEnv, token, 'tools/call', { name, arguments: args }, id);
  const text = (res.result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}';
  return JSON.parse(text) as T;
}

export const SAMPLE_BRANCH_CHECKOUT = {
  clientMutationId: 'g1',
  shiftId: 's1',
  items: [{ productId: 'p1', qty: 1 }],
  payments: [
    {
      financialAccountId: 'a1',
      accountCurrency: 'USD',
      paymentCurrency: 'USD',
      methodCode: 'CASH',
      amountMinor: 100,
    },
  ],
};
