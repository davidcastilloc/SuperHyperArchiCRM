import type { ShacD1Database } from '@shac/db-d1';
import type { CommandSpec, ProfileLoader } from '@shac/kernel';
import {
  automationProposalsDecideCommand,
  automationRulesEvaluateCommand,
  modAutomationManifest,
} from '@shac/mod-automation';
import {
  casesLegalMatterDocketCommand,
  casesMedAbaTrialCommand,
  casesMedSoapNoteCommand,
  modCasesManifest,
} from '@shac/mod-cases';
import {
  financeJournalPostCommand,
  financeTrustTransactCommand,
  modFinanceManifest,
} from '@shac/mod-finance';
import { modPortalManifest, portalRecordsListCommand } from '@shac/mod-portal';
import {
  modServicesManifest,
  servicesEvvRecordCommand,
  servicesRmaClaimCommand,
  servicesWorkOrdersUpsertCommand,
} from '@shac/mod-services';
import { Hono } from 'hono';
import {
  jsonCommandHandler,
  queryCommandHandler,
  type HonoEnv,
} from './command-registry.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PHASE7_COMMANDS: readonly CommandSpec<any, any, ShacD1Database>[] =
  [
    ...modServicesManifest.commands,
    ...modCasesManifest.commands,
    ...modFinanceManifest.commands,
    ...modPortalManifest.commands,
    ...modAutomationManifest.commands,
  ];

/** Mounts /api/services/* RPC routes with full Hono type inference. */
export function createServicesRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post(
      '/work-orders',
      jsonCommandHandler(servicesWorkOrdersUpsertCommand, profileLoader),
    )
    .post('/rma', jsonCommandHandler(servicesRmaClaimCommand, profileLoader))
    .post('/evv', jsonCommandHandler(servicesEvvRecordCommand, profileLoader));
}

/** Mounts /api/cases/* RPC routes with full Hono type inference. */
export function createCasesRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post(
      '/med/soap-notes',
      jsonCommandHandler(casesMedSoapNoteCommand, profileLoader),
    )
    .post(
      '/med/aba-trials',
      jsonCommandHandler(casesMedAbaTrialCommand, profileLoader),
    )
    .post(
      '/legal/matters',
      jsonCommandHandler(casesLegalMatterDocketCommand, profileLoader),
    );
}

/** Mounts /api/finance/* RPC routes with full Hono type inference. */
export function createFinanceRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post(
      '/trust/transact',
      jsonCommandHandler(financeTrustTransactCommand, profileLoader),
    )
    .post(
      '/journal/post',
      jsonCommandHandler(financeJournalPostCommand, profileLoader),
    );
}

/** Mounts /api/portal/* RPC routes with full Hono type inference. */
export function createPortalRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>().get(
    '/records',
    queryCommandHandler(portalRecordsListCommand, profileLoader),
  );
}

/** Mounts /api/automation/* RPC routes with full Hono type inference. */
export function createAutomationRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post(
      '/rules/evaluate',
      jsonCommandHandler(automationRulesEvaluateCommand, profileLoader),
    )
    .post(
      '/proposals/decide',
      jsonCommandHandler(automationProposalsDecideCommand, profileLoader),
    );
}
