import { AppError, sha256Hex } from '@shac/kernel';
import { describe, expect, it } from 'vitest';
import {
  iamApiKeysCreateCommand,
  iamDelegationIssuePinCommand,
} from '../src/index.js';
import { makeCtx } from './test-helpers.js';

describe('@shac/mod-iam delegation and API key handlers', () => {
  it('iam.delegation.issuePin issues 6-digit PIN and stores session in SESSION_KV with exact TTL', async () => {
    const { ctx, kvPut, batchSpy } = makeCtx();
    const input = iamDelegationIssuePinCommand.inputSchema.parse({
      clientMutationId: 'mut_pin_1',
      redeemerUserId: 'usr_cashier',
      scopePermissions: ['pos.checkout', 'pos.refund'],
      ttl: '4h',
    });

    const res = await iamDelegationIssuePinCommand.handler(ctx, input);
    expect(res.pin).toMatch(/^\d{6}$/);
    expect(res.ttl).toBe('4h');
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(kvPut).toHaveBeenCalledTimes(1);

    const [kvKey, kvVal, kvOpts] = kvPut.mock.calls[0] as [
      string,
      string,
      { expirationTtl?: number },
    ];
    const expectedHash = await sha256Hex(res.pin!);
    expect(kvKey).toBe(`delegation:${expectedHash}`);
    expect(kvOpts.expirationTtl).toBe(4 * 3600);
    expect(JSON.parse(kvVal)).toMatchObject({
      userId: 'usr_cashier',
      tenantId: 'ten_a',
      orgId: 'org_root',
      orgPath: '/root',
      perms: ['pos.checkout', 'pos.refund'],
      delegatedById: 'usr_admin',
    });

    const noKv = makeCtx({ withKv: false });
    await expect(
      iamDelegationIssuePinCommand.handler(noKv.ctx, input),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('iam.apiKeys.create generates mk_live_ token and stores hash in D1 and SESSION_KV', async () => {
    const { ctx, kvPut, batchSpy } = makeCtx();
    const input = iamApiKeysCreateCommand.inputSchema.parse({
      clientMutationId: 'mut_key_1',
      name: 'POS Sync Key',
      permissions: ['iam.orgs.read'],
      expiresInDays: 30,
    });

    const res = await iamApiKeysCreateCommand.handler(ctx, input);
    expect(res.plainTextKey).toMatch(/^mk_live_[0-9a-f]{48}$/);
    expect(res.keyPrefix).toBe(res.plainTextKey!.slice(0, 16));
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(kvPut).toHaveBeenCalledTimes(1);
  });
});
