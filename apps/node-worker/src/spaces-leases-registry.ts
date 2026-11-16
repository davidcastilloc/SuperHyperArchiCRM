import type { ShacD1Database } from '@shac/db-d1';
import type { CommandSpec, ProfileLoader } from '@shac/kernel';
import {
  leasesApplicationsSubmitCommand,
  leasesCommunityPostCommand,
  leasesContractsActivateCommand,
  leasesContractsRenewOrVacateCommand,
  modLeasesManifest,
} from '@shac/mod-leases';
import {
  modSpacesManifest,
  spacesBookingsReserveCommand,
  spacesBookingsTransitionCommand,
  spacesRackListCommand,
  spacesWaitlistManageCommand,
} from '@shac/mod-spaces';
import { Hono } from 'hono';
import {
  jsonCommandHandler,
  queryCommandHandler,
  type HonoEnv,
} from './command-registry.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PHASE6_COMMANDS: readonly CommandSpec<any, any, ShacD1Database>[] =
  [...modSpacesManifest.commands, ...modLeasesManifest.commands];

/** Mounts /api/spaces/* RPC routes with full Hono type inference. */
export function createSpacesRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/rack', queryCommandHandler(spacesRackListCommand, profileLoader))
    .post(
      '/bookings/reserve',
      jsonCommandHandler(spacesBookingsReserveCommand, profileLoader),
    )
    .post(
      '/bookings/transition',
      jsonCommandHandler(spacesBookingsTransitionCommand, profileLoader),
    )
    .post(
      '/waitlist',
      jsonCommandHandler(spacesWaitlistManageCommand, profileLoader),
    );
}

/** Mounts /api/leases/* RPC routes with full Hono type inference. */
export function createLeasesRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post(
      '/applications',
      jsonCommandHandler(leasesApplicationsSubmitCommand, profileLoader),
    )
    .post(
      '/contracts/activate',
      jsonCommandHandler(leasesContractsActivateCommand, profileLoader),
    )
    .post(
      '/contracts/renew-or-vacate',
      jsonCommandHandler(leasesContractsRenewOrVacateCommand, profileLoader),
    )
    .post(
      '/community',
      jsonCommandHandler(leasesCommunityPostCommand, profileLoader),
    );
}
