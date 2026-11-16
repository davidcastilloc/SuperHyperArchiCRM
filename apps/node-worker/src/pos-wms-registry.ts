import type { ShacD1Database } from '@shac/db-d1';
import type { CommandSpec, ProfileLoader } from '@shac/kernel';
import {
  modPosManifest,
  posKioskSmartCheckCommand,
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
