import type { ShacD1Database } from '@shac/db-d1';
import type { CommandSpec, ProfileLoader } from '@shac/kernel';
import {
  modPosManifest,
  posKioskSmartCheckCommand,
  posOrdersListCommand,
  posReturnsSettleCommand,
  posSalesCheckoutCommand,
  posShiftsCloseCommand,
  posShiftsOpenCommand,
} from '@shac/mod-pos';
import {
  modRegionalManifest,
  regionalFiscalStampCommand,
  regionalTaxIdValidateCommand,
} from '@shac/mod-regional';
import {
  modWmsManifest,
  wmsFleetCompleteEpodCommand,
  wmsLandedCostsAllocateCommand,
  wmsPickingsListCommand,
  wmsPickingsProcessCommand,
} from '@shac/mod-wms';
import { Hono } from 'hono';
import { authenticateAnyModule, createD1ContextFromAuth } from './wms-vehicles-locations-routes.js';
import {
  jsonCommandHandler,
  queryCommandHandler,
  type HonoEnv,
} from './command-registry.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PHASE3_COMMANDS: readonly CommandSpec<any, any, ShacD1Database>[] =
  [
    ...modRegionalManifest.commands,
    ...modPosManifest.commands,
    ...modWmsManifest.commands,
  ];

/** Mounts /api/regional/* RPC routes with full Hono type inference. */
export function createRegionalRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post(
      '/tax-id/validate',
      jsonCommandHandler(regionalTaxIdValidateCommand, profileLoader),
    )
    .post(
      '/fiscal/stamp',
      jsonCommandHandler(regionalFiscalStampCommand, profileLoader),
    );
}

/** Mounts /api/pos/* RPC routes with full Hono type inference. */
export function createPosRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post(
      '/shifts/open',
      jsonCommandHandler(posShiftsOpenCommand, profileLoader),
    )
    .post(
      '/shifts/close',
      jsonCommandHandler(posShiftsCloseCommand, profileLoader),
    )
    .post(
      '/sales/checkout',
      jsonCommandHandler(posSalesCheckoutCommand, profileLoader),
    )
    .get(
      '/orders',
      async (c) => {
        const auth = await authenticateAnyModule(
          c.env, c.req.raw.headers, profileLoader, ['pos', 'wms', 'catalog'], posOrdersListCommand.requiredPermission,
        );
        const queryInput = posOrdersListCommand.inputSchema.parse(c.req.query());
        const result = await posOrdersListCommand.handler(
          createD1ContextFromAuth(c.env, auth.profile, auth.actor, c.req.header('X-Request-Id') ?? crypto.randomUUID()),
          queryInput,
        );
        return c.json(result, 200);
      },
    )
    .get(
      '/kiosk/smartcheck',
      queryCommandHandler(posKioskSmartCheckCommand, profileLoader),
    )
    .post(
      '/returns/settle',
      jsonCommandHandler(posReturnsSettleCommand, profileLoader),
    );
}

/** Mounts /api/wms/* RPC routes with full Hono type inference. */
export function createWmsRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post(
      '/pickings/process',
      jsonCommandHandler(wmsPickingsProcessCommand, profileLoader),
    )
    .get(
      '/pickings',
      queryCommandHandler(wmsPickingsListCommand, profileLoader),
    )
    .post(
      '/landed-costs/allocate',
      jsonCommandHandler(wmsLandedCostsAllocateCommand, profileLoader),
    )
    .post(
      '/fleet/epod',
      jsonCommandHandler(wmsFleetCompleteEpodCommand, profileLoader),
    );
}
