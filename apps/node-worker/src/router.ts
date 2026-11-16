import { createProfileLoader, type ProfileLoader } from '@shac/kernel';
import {
  catalogLabelsBatchCommand,
  catalogPricingQuoteCommand,
  catalogProductsListCommand,
  catalogProductsUpsertCommand,
  catalogRatesUpsertCommand,
} from '@shac/mod-catalog';
import {
  customersConflictsCheckCommand,
  customersDealsCreateCommand,
  customersLinksCreateCommand,
  customersPartiesListCommand,
  customersPartiesUpsertCommand,
} from '@shac/mod-customers';
import {
  iamApiKeysCreateCommand,
  iamDelegationIssuePinCommand,
  iamOrgsCreateCommand,
  iamOrgsListCommand,
} from '@shac/mod-iam';
import { createMcpHandler } from 'agents/mcp/server';
import { Hono } from 'hono';
import {
  createBranchPosRoutes,
  createBranchRoutes,
} from './branch-routes.js';
import {
  jsonCommandHandler,
  onWorkerError,
  queryCommandHandler,
  type HonoEnv,
} from './command-registry.js';
import { createAdaptiveCorsMiddleware } from './cors.js';
import { buildMcpServerForRequest } from './mcp-server.js';
import {
  createPosRoutes,
  createRegionalRoutes,
  createWmsRoutes,
} from './pos-wms-registry.js';

export type { WorkerEnv } from './command-registry.js';

const defaultProfileLoader = createProfileLoader();

export function invalidateProfileCache(): void {
  defaultProfileLoader.invalidate();
}

function createWorkerApp(
  profileLoader: ProfileLoader = defaultProfileLoader,
) {
  return new Hono<HonoEnv>()
    .use('*', createAdaptiveCorsMiddleware<HonoEnv>())
    .onError(onWorkerError)
    .get('/api/health', (c) =>
      c.json({ ok: true, service: 'shac-node-worker' }, 200),
    )
    .get('/api/iam/orgs', queryCommandHandler(iamOrgsListCommand, profileLoader))
    .post('/api/iam/orgs', jsonCommandHandler(iamOrgsCreateCommand, profileLoader))
    .post(
      '/api/iam/api-keys',
      jsonCommandHandler(iamApiKeysCreateCommand, profileLoader),
    )
    .post(
      '/api/iam/delegation/pins',
      jsonCommandHandler(iamDelegationIssuePinCommand, profileLoader),
    )
    .get(
      '/api/customers/parties',
      queryCommandHandler(customersPartiesListCommand, profileLoader),
    )
    .post(
      '/api/customers/parties',
      jsonCommandHandler(customersPartiesUpsertCommand, profileLoader),
    )
    .post(
      '/api/customers/links',
      jsonCommandHandler(customersLinksCreateCommand, profileLoader),
    )
    .post(
      '/api/customers/deals',
      jsonCommandHandler(customersDealsCreateCommand, profileLoader),
    )
    .post(
      '/api/customers/conflict-checks',
      jsonCommandHandler(customersConflictsCheckCommand, profileLoader),
    )
    .get(
      '/api/catalog/products',
      queryCommandHandler(catalogProductsListCommand, profileLoader),
    )
    .post(
      '/api/catalog/products',
      jsonCommandHandler(catalogProductsUpsertCommand, profileLoader),
    )
    .post(
      '/api/catalog/pricing/quote',
      jsonCommandHandler(catalogPricingQuoteCommand, profileLoader),
    )
    .post(
      '/api/catalog/rates',
      jsonCommandHandler(catalogRatesUpsertCommand, profileLoader),
    )
    .post(
      '/api/catalog/labels/batches',
      jsonCommandHandler(catalogLabelsBatchCommand, profileLoader),
    )
    .route('/api/regional', createRegionalRoutes(profileLoader))
    .route('/api/pos', createPosRoutes(profileLoader))
    .route('/api/wms', createWmsRoutes(profileLoader))
    .route('/api/branch/inventory', createBranchRoutes(profileLoader))
    .route('/api/branch/pos', createBranchPosRoutes(profileLoader))
    .all('/mcp', async (c) => {
      const requestId = c.req.header('X-Request-Id') ?? crypto.randomUUID();
      const handler = createMcpHandler(
        () =>
          buildMcpServerForRequest(
            c.env,
            c.req.raw.headers,
            profileLoader,
            requestId,
          ),
        {
          route: '/mcp',
          corsOptions: false,
          allowedOriginHostnames: '*',
        },
      );
      return handler(
        c.req.raw,
        c.env,
        c.executionCtx as unknown as Parameters<typeof handler>[2],
      );
    });
}

export const workerApp = createWorkerApp();
export type AppRouter = typeof workerApp;
