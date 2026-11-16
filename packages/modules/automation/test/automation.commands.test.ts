import { env } from 'cloudflare:test';
import { kernelAiProposals } from '@shac/db-d1';
import { AppError } from '@shac/kernel';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  automationProposalsDecideCommand,
  automationRulesEvaluateCommand,
  modAutomationManifest,
} from '../src/index.js';
import { makeAutomationCtx, setupAutomationD1 } from './test-helpers.js';

describe('@shac/mod-automation commands on workerd', () => {
  beforeAll(async () => {
    await setupAutomationD1(env.DB);
  });

  it('registers modAutomationManifest with mcp.expose: true', () => {
    expect(modAutomationManifest.id).toBe('automation');
    expect(automationRulesEvaluateCommand.mcp.expose).toBe(true);
    expect(automationProposalsDecideCommand.mcp.expose).toBe(true);
  });

  it('evaluates enabled business rules in <= 2 D1 queries', async () => {
    const { ctx, counted } = makeAutomationCtx(env.DB);
    const matched = await automationRulesEvaluateCommand.handler(ctx, {
      entityType: 'rma_claim',
      lifecycleEvent: 'on_create',
      payload: { amountMinor: 75000, tier: 'VIP' },
    });

    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(matched.evaluatedCount).toBe(1);
    expect(matched.matchedRules).toHaveLength(1);
    expect(matched.matchedRules[0]?.ruleCode).toBe('HIGH_VALUE_RMA');

    const unmatched = await automationRulesEvaluateCommand.handler(ctx, {
      entityType: 'rma_claim',
      lifecycleEvent: 'on_create',
      payload: { amountMinor: 1000, tier: 'VIP' },
    });
    expect(unmatched.evaluatedCount).toBe(1);
    expect(unmatched.matchedRules).toHaveLength(0);
  });

  it('blocks Proposal Card execution without explicit human approval', async () => {
    const { ctx } = makeAutomationCtx(env.DB);

    await expect(
      automationProposalsDecideCommand.handler(ctx, {
        clientMutationId: 'mut_no_confirm',
        proposalId: 'prop_approve',
        decision: 'APPROVED',
        humanConfirmed: false,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'HUMAN_APPROVAL_REQUIRED',
    } satisfies Partial<AppError>);

    const { ctx: sysCtx } = makeAutomationCtx(env.DB, { actorType: 'system' });
    await expect(
      automationProposalsDecideCommand.handler(sysCtx, {
        clientMutationId: 'mut_sys_approve',
        proposalId: 'prop_approve',
        decision: 'APPROVED',
        humanConfirmed: true,
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'HUMAN_APPROVAL_REQUIRED',
    } satisfies Partial<AppError>);
  });

  it('executes Proposal Card on explicit human APPROVED and aborts on REJECTED', async () => {
    const { ctx } = makeAutomationCtx(env.DB);

    const approved = await automationProposalsDecideCommand.handler(ctx, {
      clientMutationId: 'mut_approve_1',
      proposalId: 'prop_approve',
      decision: 'APPROVED',
      humanConfirmed: true,
    });
    expect(approved.disposition).toBe('APPROVED');
    expect(approved.executionStatus).toBe('EXECUTED');
    expect(approved.executedAt).not.toBeNull();
    expect(approved.resolvedByUserId).toBe('usr_ten_1');

    // Idempotent replay returns exact same result
    const replay = await automationProposalsDecideCommand.handler(ctx, {
      clientMutationId: 'mut_approve_1',
      proposalId: 'prop_approve',
      decision: 'APPROVED',
      humanConfirmed: true,
    });
    expect(replay).toEqual(approved);

    // Different mutation ID on already-decided proposal -> 409
    await expect(
      automationProposalsDecideCommand.handler(ctx, {
        clientMutationId: 'mut_approve_2',
        proposalId: 'prop_approve',
        decision: 'REJECTED',
        humanConfirmed: false,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'PROPOSAL_ALREADY_DECIDED',
    } satisfies Partial<AppError>);

    const rejected = await automationProposalsDecideCommand.handler(ctx, {
      clientMutationId: 'mut_reject_1',
      proposalId: 'prop_reject',
      decision: 'REJECTED',
      humanConfirmed: false,
    });
    expect(rejected.disposition).toBe('REJECTED');
    expect(rejected.executionStatus).toBe('ABORTED');
    expect(rejected.executedAt).toBeNull();

    const [persisted] = await ctx.db
      .select({
        disposition: kernelAiProposals.disposition,
        executedAt: kernelAiProposals.executedAt,
      })
      .from(kernelAiProposals)
      .where(eq(kernelAiProposals.id, 'prop_reject'));
    expect(persisted).toEqual({ disposition: 'REJECTED', executedAt: null });
  });

  it('enforces 404 and 403 tenant/org isolation', async () => {
    const { ctx } = makeAutomationCtx(env.DB);

    await expect(
      automationRulesEvaluateCommand.handler(ctx, {
        orgId: 'org_missing',
        entityType: 'rma_claim',
        lifecycleEvent: 'on_create',
        payload: {},
      }),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<AppError>);

    await expect(
      automationRulesEvaluateCommand.handler(ctx, {
        orgId: 'org_1_south',
        entityType: 'rma_claim',
        lifecycleEvent: 'on_create',
        payload: {},
      }),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<AppError>);

    await expect(
      automationProposalsDecideCommand.handler(ctx, {
        clientMutationId: 'mut_missing',
        proposalId: 'prop_missing',
        decision: 'REJECTED',
        humanConfirmed: false,
      }),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<AppError>);

    await expect(
      automationProposalsDecideCommand.handler(ctx, {
        clientMutationId: 'mut_south',
        proposalId: 'prop_south',
        decision: 'REJECTED',
        humanConfirmed: false,
      }),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<AppError>);

    await expect(
      automationProposalsDecideCommand.handler(ctx, {
        clientMutationId: 'mut_ten2',
        proposalId: 'prop_ten2',
        decision: 'REJECTED',
        humanConfirmed: false,
      }),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<AppError>);
  });
});
