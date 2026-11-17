import {
  createProfileLoader,
  verifyAuditHashChain,
  type AuditChainEntryInput,
  type ProfileLoader,
} from '@shac/kernel';
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
import { createClinicalEhrRoutes } from './clinical-ehr-routes.js';
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
import { createFinanceGaapRoutes } from './finance-gaap-routes.js';
import { createFormsWorkflowsRoutes } from './forms-workflows-routes.js';
import { createHospitalityCondoRoutes } from './hospitality-condo-routes.js';
import { createIamAdminRoutes } from './iam-admin-routes.js';
import { createLegalEdiscoveryRoutes } from './legal-ediscovery-routes.js';
import { createLegalPracticeRoutes } from './legal-practice-routes.js';
import { createMediaAndWebhooksRoutes } from './media-and-webhooks-routes.js';
import { createPhysicalHeliosRoutes } from './physical-helios-routes.js';
import { createPublicPortalRoutes } from './public-portal-routes.js';
import { createStaffRoutes } from './staff-routes.js';
import { createWmsFleetLabelsRoutes } from './wms-fleet-labels-routes.js';
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
    .get('/api/branch/:branchId/realtime/ws', async (c) => {
      if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
        return c.text('Expected Upgrade: websocket', 426);
      }
      const tenantId = c.req.query('tenantId') ?? 'ten_1';
      const branchId = c.req.param('branchId');
      const url = new URL(c.req.url);
      const stub = c.env.BRANCH_DO.get(c.env.BRANCH_DO.idFromName(`${tenantId}:${branchId}`));
      return stub.fetch(`https://branch/branch/realtime/ws${url.search}`, c.req.raw);
    })
    .post('/api/audit-chain/verify', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.read');
      const body = (await c.req.json().catch(() => ({}))) as { streamKey?: string; orgId?: string };
      const streamKey = typeof body.streamKey === 'string' && body.streamKey.trim() ? body.streamKey.trim() : 'finance:trust';
      const orgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : auth.actor.orgId;
      const rows = await c.env.DB.prepare(
        `SELECT org_id, stream_key, seq_no, actor_id, action, target_id, occurred_at_ms, prev_hash_hex, record_hash_hex, payload_json
         FROM immutable_audit_chain_ledger
         WHERE org_id = ?1 AND stream_key = ?2
         ORDER BY seq_no ASC LIMIT 500`,
      ).bind(orgId, streamKey).all<{
        org_id: string;
        stream_key: string;
        seq_no: number;
        actor_id: string;
        action: string;
        target_id: string;
        occurred_at_ms: number;
        prev_hash_hex: string;
        record_hash_hex: string;
        payload_json: string;
      }>();
      const entries: Array<AuditChainEntryInput & { readonly recordHashHex: string }> = (rows.results ?? []).map((r) => ({
        orgId: r.org_id,
        streamKey: r.stream_key,
        seqNo: r.seq_no,
        actorId: r.actor_id,
        action: r.action,
        targetId: r.target_id,
        occurredAtMs: r.occurred_at_ms,
        prevHashHex: r.prev_hash_hex,
        recordHashHex: r.record_hash_hex,
        payload: JSON.parse(r.payload_json) as unknown,
      }));
      const result = await verifyAuditHashChain(entries);
      return c.json(result, 200);
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
    .route('/api', createWmsFleetLabelsRoutes(profileLoader))
    .route('/api', createClinicalEhrRoutes(profileLoader))
    .route('/api', createLegalPracticeRoutes(profileLoader))
    .route('/api', createLegalEdiscoveryRoutes(profileLoader))
    .route('/api', createHospitalityCondoRoutes(profileLoader))
    .route('/api', createPhysicalHeliosRoutes(profileLoader))
    .route('/api', createFinanceGaapRoutes(profileLoader))
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
