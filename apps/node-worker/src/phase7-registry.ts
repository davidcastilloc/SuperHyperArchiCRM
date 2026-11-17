import type { ShacD1Database } from '@shac/db-d1';
import { AppError, type CommandSpec, type ProfileLoader } from '@shac/kernel';
import { z } from 'zod';
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
  servicesClaimsListCommand,
  servicesEvvRecordCommand,
  servicesRmaClaimCommand,
  servicesWorkOrdersUpsertCommand,
} from '@shac/mod-services';
import { Hono } from 'hono';
import {
  authenticateWorkerActor,
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
    .get(
      '/claims',
      queryCommandHandler(servicesClaimsListCommand, profileLoader),
    )
    .post(
      '/work-orders',
      jsonCommandHandler(servicesWorkOrdersUpsertCommand, profileLoader),
    )
    .post('/rma', jsonCommandHandler(servicesRmaClaimCommand, profileLoader))
    .post('/evv', jsonCommandHandler(servicesEvvRecordCommand, profileLoader))
    .post('/claims/:id/transition', async (c) => {
      const auth = await authenticateWorkerActor(
        c.env,
        c.req.raw.headers,
        profileLoader,
        'services',
        'services.claims.write',
      );
      const id = c.req.param('id').trim();
      const parsed = z
        .object({
          nextStatus: z.enum(['APPROVED', 'IN_PROGRESS', 'RECEIVED', 'COMPLETED', 'REJECTED']),
          resolutionNote: z.string().max(400).optional(),
        })
        .safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid transition payload', parsed.error.flatten());
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const rmaRes = await c.env.DB.prepare(
        `UPDATE srv_warranty_claims_rma SET status = ?1, updated_at = ?2 WHERE id = ?3 AND tenant_id = ?4 AND org_id = ?5 AND deleted_at IS NULL`,
      )
        .bind(parsed.data.nextStatus, nowSec, id, auth.actor.tenantId, auth.actor.orgId)
        .run();
      if ((rmaRes.meta?.changes ?? 0) > 0) {
        return c.json({ ok: true, id, status: parsed.data.nextStatus }, 200);
      }
      const woRes = await c.env.DB.prepare(
        `UPDATE srv_work_orders SET status = ?1, updated_at = ?2 WHERE id = ?3 AND tenant_id = ?4 AND org_id = ?5 AND deleted_at IS NULL`,
      )
        .bind(parsed.data.nextStatus, nowSec, id, auth.actor.tenantId, auth.actor.orgId)
        .run();
      if ((woRes.meta?.changes ?? 0) === 0) {
        throw new AppError('NOT_FOUND', 404, `Claim or work order '${id}' not found`);
      }
      return c.json({ ok: true, id, status: parsed.data.nextStatus }, 200);
    });
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
