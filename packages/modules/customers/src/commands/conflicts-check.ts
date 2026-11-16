import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  crmConflictChecks,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import { searchConflictParties } from '../lib/conflict-matcher.js';
import { partyRoleSchema } from '../lib/identity.js';
import {
  assertPartyInScope,
  resolveScopedTargetOrg,
} from '../lib/scope-helpers.js';

const conflictCheckInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128).optional(),
  orgId: z.string().min(1).optional(),
  candidatePartyId: z.string().min(1).nullable().optional(),
  matterTitle: z.string().min(1).max(200),
  searchedTerms: z.array(z.string().trim().min(1).max(160)).min(1),
});

const conflictCheckOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  candidatePartyId: z.string().nullable(),
  matterTitle: z.string(),
  searchedTerms: z.array(z.string()),
  matchedParties: z.array(
    z.object({
      partyId: z.string(),
      displayName: z.string(),
      taxIdNumber: z.string().nullable(),
      rolesMask: z.array(partyRoleSchema),
      matchedTerms: z.array(z.string()),
    }),
  ),
  riskStatus: z.enum(['clear', 'potential_conflict']),
  createdAt: z.number().int(),
});

export const customersConflictsCheckCommand = defineCommand<
  typeof conflictCheckInputSchema,
  z.infer<typeof conflictCheckOutputSchema>,
  ShacD1Database
>({
  id: 'customers.conflicts.check',
  moduleId: 'customers',
  method: 'POST',
  path: '/api/customers/conflict-checks',
  summary: 'Check for party/matter conflicts of interest and persist the check record',
  requiredPermission: 'customers.conflicts.read',
  mcp: {
    expose: true,
    idempotentHint: true,
    description: 'Run and record a conflict-of-interest check against tenant parties',
  },
  inputSchema: conflictCheckInputSchema,
  outputSchema: conflictCheckOutputSchema,
  async handler(ctx, input) {
    const requestHash = input.clientMutationId
      ? await sha256Hex(
          JSON.stringify({
            commandId: 'customers.conflicts.check',
            ...input,
            clientMutationId: undefined,
          }),
        )
      : null;

    if (input.clientMutationId && requestHash) {
      const replay = await checkIdempotency(
        ctx.db,
        ctx.tenantId,
        input.clientMutationId,
        requestHash,
        conflictCheckOutputSchema,
      );
      if (replay) return replay;
    }

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);
    if (input.candidatePartyId) {
      await assertPartyInScope(ctx, input.candidatePartyId, 'Candidate party');
    }

    const matchedParties = await searchConflictParties(
      ctx.db,
      ctx.tenantId,
      input.searchedTerms,
      input.candidatePartyId,
    );

    const riskStatus =
      matchedParties.length > 0 ? 'potential_conflict' : 'clear';
    const checkId = crypto.randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);

    const created: z.infer<typeof conflictCheckOutputSchema> = {
      id: checkId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      candidatePartyId: input.candidatePartyId ?? null,
      matterTitle: input.matterTitle,
      searchedTerms: input.searchedTerms,
      matchedParties,
      riskStatus,
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    const insertCheck = ctx.db.insert(crmConflictChecks).values({
      id: checkId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      candidatePartyId: created.candidatePartyId,
      matterTitle: created.matterTitle,
      searchedTermsJson: JSON.stringify(created.searchedTerms),
      matchedPartiesJson: JSON.stringify(created.matchedParties),
      riskStatus,
      reviewedByUserId: ctx.actor.id,
      reviewedAt: nowSec,
      version: 1,
      createdAt: nowSec,
      updatedAt: nowSec,
    });

    const insertActionLog = buildActionLogInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      actor: ctx.actor,
      commandId: 'customers.conflicts.check',
      resourceKind: 'crm_conflict_check',
      resourceId: checkId,
      targetPartyId: created.candidatePartyId,
      snapshotAfterJson: responseJson,
      nowSec,
    });

    if (input.clientMutationId && requestHash) {
      await ctx.db.batch([
        insertCheck,
        buildIdempotencyInsert(ctx.db, {
          tenantId: ctx.tenantId,
          orgId: targetOrgId,
          clientMutationId: input.clientMutationId,
          commandId: 'customers.conflicts.check',
          requestHash,
          responseJson,
          nowSec,
        }),
        insertActionLog,
      ]);
    } else {
      await ctx.db.batch([insertCheck, insertActionLog]);
    }

    return created;
  },
});
