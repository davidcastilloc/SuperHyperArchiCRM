import {
  assertOrgScope,
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  iamOrganizations,
  kernelAiProposals,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

const decideProposalInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  proposalId: z.string().min(1),
  decision: z.enum(['APPROVED', 'REJECTED']),
  humanConfirmed: z.boolean().default(false),
});

const decideProposalOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  targetCommandId: z.string(),
  targetRecordId: z.string().nullable(),
  disposition: z.enum(['APPROVED', 'REJECTED']),
  executionStatus: z.enum(['EXECUTED', 'ABORTED']),
  resolvedByUserId: z.string(),
  executedAt: z.number().int().nullable(),
});

export const automationProposalsDecideCommand = defineCommand<
  typeof decideProposalInputSchema,
  z.infer<typeof decideProposalOutputSchema>,
  ShacD1Database
>({
  id: 'automation.proposals.decide',
  moduleId: 'automation',
  method: 'POST',
  path: '/api/automation/proposals/decide',
  summary:
    'Approve or reject an AI Proposal Card; APPROVED requires explicit human approval before marking executed',
  requiredPermission: 'automation.proposals.decide',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Decide on a kernel_ai_proposals Proposal Card (APPROVED requires humanConfirmed=true and human actor; REJECTED aborts execution)',
  },
  inputSchema: decideProposalInputSchema,
  outputSchema: decideProposalOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'automation.proposals.decide',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      decideProposalOutputSchema,
    );
    if (replay) return replay;

    // Proposal Cards require explicit human approval before marking executed.
    if (input.decision === 'APPROVED') {
      if (ctx.actor.type === 'system' || ctx.actor.type === 'api_key') {
        throw new AppError(
          'HUMAN_APPROVAL_REQUIRED',
          403,
          'AI Proposal Cards cannot be auto-approved by system or api_key actors',
        );
      }
      if (!input.humanConfirmed) {
        throw new AppError(
          'HUMAN_APPROVAL_REQUIRED',
          422,
          'Proposal Cards require explicit human approval (humanConfirmed: true) before execution',
        );
      }
    }

    const rows = await ctx.db
      .select({
        proposal: kernelAiProposals,
        orgTreePath: iamOrganizations.treePath,
      })
      .from(kernelAiProposals)
      .leftJoin(
        iamOrganizations,
        and(
          eq(kernelAiProposals.orgId, iamOrganizations.id),
          eq(kernelAiProposals.tenantId, iamOrganizations.tenantId),
          isNull(iamOrganizations.deletedAt),
        ),
      )
      .where(
        and(
          eq(kernelAiProposals.id, input.proposalId),
          isNull(kernelAiProposals.deletedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new AppError('NOT_FOUND', 404, 'AI proposal not found');
    }

    const effectiveOrgPath =
      row.orgTreePath ??
      (row.proposal.orgId === ctx.orgId ? ctx.orgPath : '/__out_of_scope__');
    assertOrgScope(ctx, row.proposal.tenantId, effectiveOrgPath);

    if (row.proposal.disposition !== 'PENDING') {
      throw new AppError(
        'PROPOSAL_ALREADY_DECIDED',
        409,
        `Proposal already decided with disposition ${row.proposal.disposition}`,
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const executedAt = input.decision === 'APPROVED' ? nowSec : null;
    const executionStatus =
      input.decision === 'APPROVED' ? ('EXECUTED' as const) : ('ABORTED' as const);

    const result: z.infer<typeof decideProposalOutputSchema> = {
      id: row.proposal.id,
      tenantId: row.proposal.tenantId,
      orgId: row.proposal.orgId,
      targetCommandId: row.proposal.targetCommandId,
      targetRecordId: row.proposal.targetRecordId,
      disposition: input.decision,
      executionStatus,
      resolvedByUserId: ctx.actor.id,
      executedAt,
    };

    const responseJson = JSON.stringify(result);

    await ctx.db.batch([
      ctx.db
        .update(kernelAiProposals)
        .set({
          disposition: input.decision,
          resolvedByUserId: ctx.actor.id,
          executedAt,
          version: row.proposal.version + 1,
          updatedAt: nowSec,
        })
        .where(
          and(
            eq(kernelAiProposals.id, row.proposal.id),
            eq(kernelAiProposals.tenantId, row.proposal.tenantId),
            eq(kernelAiProposals.disposition, 'PENDING'),
          ),
        ),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: row.proposal.orgId,
        clientMutationId: input.clientMutationId,
        commandId: 'automation.proposals.decide',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: row.proposal.orgId,
        actor: ctx.actor,
        commandId: 'automation.proposals.decide',
        resourceKind: 'kernel_ai_proposals',
        resourceId: row.proposal.id,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return result;
  },
});
