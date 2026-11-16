import { sha256Hex } from '@shac/kernel';
import { describe, expect, it } from 'vitest';
import {
  iamApiKeysCreateCommand,
  iamDelegationIssuePinCommand,
  iamModule,
  iamOrgsCreateCommand,
  iamOrgsListCommand,
} from '../src/index.js';
import { makeCtx } from './test-helpers.js';

describe('@shac/mod-iam manifest and Zod contracts', () => {
  it('registers all 4 IAM commands with MCP metadata', () => {
    expect(iamModule.id).toBe('iam');
    expect(iamModule.commands.map((c) => c.id)).toEqual([
      'iam.orgs.create',
      'iam.orgs.list',
      'iam.apiKeys.create',
      'iam.delegation.issuePin',
    ]);

    for (const cmd of iamModule.commands) {
      expect(cmd.mcp.expose).toBe(true);
    }
    expect(iamOrgsListCommand.mcp.readOnlyHint).toBe(true);
    expect(iamOrgsCreateCommand.mcp.idempotentHint).toBe(true);
    expect(iamApiKeysCreateCommand.mcp.idempotentHint).toBe(true);
    expect(iamDelegationIssuePinCommand.mcp.idempotentHint).toBe(true);
  });

  it('validates write command inputs and delegation TTL enum', () => {
    expect(() =>
      iamOrgsCreateCommand.inputSchema.parse({
        name: 'Missing mutation id',
        slug: 'missing-id',
      }),
    ).toThrow();

    expect(() =>
      iamOrgsCreateCommand.inputSchema.parse({
        clientMutationId: 'mut_1',
        name: 'Bad Slug',
        slug: 'Bad_Slug!',
      }),
    ).toThrow();

    for (const ttl of ['4h', '8h', '24h'] as const) {
      const parsed = iamDelegationIssuePinCommand.inputSchema.parse({
        clientMutationId: `mut_${ttl}`,
        scopePermissions: ['pos.checkout'],
        ttl,
      });
      expect(parsed.ttl).toBe(ttl);
    }

    expect(() =>
      iamDelegationIssuePinCommand.inputSchema.parse({
        clientMutationId: 'mut_bad',
        scopePermissions: ['pos.checkout'],
        ttl: '1h',
      }),
    ).toThrow();
  });
});

describe('@shac/mod-iam organization handlers', () => {
  it('iam.orgs.list executes items and count queries in a single batch (<= 2 queries)', async () => {
    const sampleOrg = {
      id: 'org_1',
      tenantId: 'ten_a',
      parentId: null,
      rootId: 'org_root',
      treePath: '/root/north',
      depth: 2,
      slug: 'north',
      name: 'North Branch',
      orgKind: 'branch',
      timezone: 'UTC',
      isPrimary: false,
      isActive: true,
      createdAt: 1700000000,
    };

    const { ctx, batchSpy } = makeCtx({
      batchResult: [[sampleOrg], [{ count: 1 }]],
    });

    const parsedInput = iamOrgsListCommand.inputSchema.parse({});
    const res = await iamOrgsListCommand.handler(ctx, parsedInput);

    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy.mock.calls[0]?.[0]).toHaveLength(2);
    expect(res).toEqual({
      items: [sampleOrg],
      total: 1,
      limit: 50,
      offset: 0,
    });
  });

  it('iam.orgs.create inserts org, idempotency key, and action log, and replays idempotently', async () => {
    const { ctx, batchSpy, insertedValues } = makeCtx({ selectRows: [[]] });
    const input = iamOrgsCreateCommand.inputSchema.parse({
      clientMutationId: 'mut_org_1',
      name: 'South Branch',
      slug: 'south',
    });

    const created = await iamOrgsCreateCommand.handler(ctx, input);
    expect(created.treePath).toBe('/root/south');
    expect(created.tenantId).toBe('ten_a');
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(insertedValues).toHaveLength(3);

    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'iam.orgs.create',
        name: input.name,
        slug: input.slug,
        orgKind: input.orgKind,
        parentId: input.parentId ?? null,
        timezone: input.timezone,
        isPrimary: input.isPrimary,
      }),
    );

    const replayCtx = makeCtx({
      selectRows: [[{ requestHash, responseJson: JSON.stringify(created) }]],
    });

    const replayed = await iamOrgsCreateCommand.handler(replayCtx.ctx, input);
    expect(replayed).toEqual(created);
    expect(replayCtx.batchSpy).not.toHaveBeenCalled();

    const conflictCtx = makeCtx({
      selectRows: [[{ requestHash: 'different-hash', responseJson: JSON.stringify(created) }]],
    });

    await expect(
      iamOrgsCreateCommand.handler(conflictCtx.ctx, input),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409,
    });
  });
});
