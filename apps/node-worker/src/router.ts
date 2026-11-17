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
  customersDealsListCommand,
  customersDealsStageCommand,
  customersInteractionsListCommand,
  customersInteractionsUpsertCommand,
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
import { createAuthRoutes } from './auth-routes.js';
import {
  createBranchPosRoutes,
  createBranchRoutes,
} from './branch-routes.js';
import { createCatalogExtRoutes } from './catalog-ext-routes.js';
import {
  authenticateWorkerActor,
  jsonCommandHandler,
  onWorkerError,
  queryCommandHandler,
  type HonoEnv,
} from './command-registry.js';
import { createConnectorsRoutes } from './connectors-routes.js';
import { createAdaptiveCorsMiddleware } from './cors.js';
import { createCustomFieldsRoutes } from './custom-fields-routes.js';
import { createFederationRoutes } from './federation-routes.js';
import { createFormsWorkflowsRoutes } from './forms-workflows-routes.js';
import { createIamAdminRoutes } from './iam-admin-routes.js';
import { createMediaAndWebhooksRoutes } from './media-and-webhooks-routes.js';
import { createPublicPortalRoutes } from './public-portal-routes.js';
import { createStaffRoutes } from './staff-routes.js';
import { buildMcpServerForRequest } from './mcp-server.js';
import {
  createPosRoutes,
  createRegionalRoutes,
  createWmsRoutes,
} from './pos-wms-registry.js';
import {
  createAutomationRoutes,
  createCasesRoutes,
  createFinanceRoutes,
  createPortalRoutes,
  createServicesRoutes,
} from './phase7-registry.js';
import { createPhysicalRoutes } from './phase8-registry.js';
import {
  createLeasesRoutes,
  createSpacesRoutes,
} from './spaces-leases-registry.js';
import {
  createSystemRoutes,
  setProfileInvalidator,
  systemAppStoreToggleCommand,
  systemGetProfileCommand,
} from './system-routes.js';

export type { WorkerEnv } from './command-registry.js';

const defaultProfileLoader = createProfileLoader();

export function invalidateProfileCache(): void {
  defaultProfileLoader.invalidate();
}

function createWorkerApp(
  profileLoader: ProfileLoader = defaultProfileLoader,
) {
  setProfileInvalidator(() => profileLoader.invalidate());
  return new Hono<HonoEnv>()
    .use('*', createAdaptiveCorsMiddleware<HonoEnv>())
    .onError(onWorkerError)
    .get('/api/health', (c) =>
      c.json({ ok: true, service: 'shac-node-worker' }, 200),
    )
    .get('/ws/branch/:branchId', async (c) => {
      if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
        return c.text('Expected Upgrade: websocket', 426);
      }
      const tenantId = c.req.query('tenantId') ?? 'ten_1';
      const branchId = c.req.param('branchId');
      const stub = c.env.BRANCH_DO.get(c.env.BRANCH_DO.idFromName(`${tenantId}:${branchId}`));
      return stub.fetch('https://branch/ws', c.req.raw);
    })
    .route('/api/auth', createAuthRoutes(profileLoader))
    .route('/api', createPublicPortalRoutes())
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
    .get(
      '/api/customers/deals',
      queryCommandHandler(customersDealsListCommand, profileLoader),
    )
    .post(
      '/api/customers/deals',
      jsonCommandHandler(customersDealsCreateCommand, profileLoader),
    )
    .post(
      '/api/customers/deals/stage',
      jsonCommandHandler(customersDealsStageCommand, profileLoader),
    )
    .get(
      '/api/customers/interactions',
      queryCommandHandler(customersInteractionsListCommand, profileLoader),
    )
    .post(
      '/api/customers/interactions',
      jsonCommandHandler(customersInteractionsUpsertCommand, profileLoader),
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
    .route('/api/spaces', createSpacesRoutes(profileLoader))
    .route('/api/leases', createLeasesRoutes(profileLoader))
    .route('/api/services', createServicesRoutes(profileLoader))
    .route('/api/cases', createCasesRoutes(profileLoader))
    .route('/api/finance', createFinanceRoutes(profileLoader))
    .route('/api/portal', createPortalRoutes(profileLoader))
    .route('/api/automation', createAutomationRoutes(profileLoader))
    .route('/api/physical', createPhysicalRoutes(profileLoader))
    .route('/api/branch/inventory', createBranchRoutes(profileLoader))
    .route('/api/branch/pos', createBranchPosRoutes(profileLoader))
    .route('/api/federation', createFederationRoutes(profileLoader))
    .get(
      '/api/system/profile',
      queryCommandHandler(systemGetProfileCommand, profileLoader),
    )
    .post(
      '/api/system/app-store/toggle',
      jsonCommandHandler(systemAppStoreToggleCommand, profileLoader),
    )
    .route('/api/system', createCustomFieldsRoutes(profileLoader))
    .route('/api', createMediaAndWebhooksRoutes(profileLoader))
    .route('/api/staff', createStaffRoutes(profileLoader))
    .route('/api', createIamAdminRoutes(profileLoader))
    .route('/api', createCatalogExtRoutes(profileLoader))
    .route('/api', createFormsWorkflowsRoutes(profileLoader))
    .route('/api', createConnectorsRoutes(profileLoader))
    .route(
      '/api/system',
      createSystemRoutes(profileLoader, authenticateWorkerActor),
    )
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
