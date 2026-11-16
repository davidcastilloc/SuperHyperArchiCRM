import { env } from 'cloudflare:test';
import { AppError } from '@shac/kernel';
import { beforeAll, describe, expect, it } from 'vitest';
import { modPortalManifest, portalRecordsListCommand } from '../src/index.js';
import { makePortalCtx, setupPortalD1 } from './test-helpers.js';

describe('@shac/mod-portal commands on workerd', () => {
  beforeAll(async () => {
    await setupPortalD1(env.DB);
  });

  it('registers modPortalManifest with mcp.expose: true', () => {
    expect(modPortalManifest.id).toBe('portal');
    expect(portalRecordsListCommand.mcp.expose).toBe(true);
  });

  it('enforces strict SQL is_confidential = 0 filter and <= 2 D1 queries', async () => {
    const { ctx, counted } = makePortalCtx(env.DB);
    const result = await portalRecordsListCommand.handler(ctx, {
      limit: 50,
    });

    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(result.orgId).toBe('org_1_north');
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.id).toBe('doc_pub_1');
    expect(result.attachments[0]?.isConfidential).toBe(false);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.id).toBe('msg_pub_1');
    expect(result.messages[0]?.isConfidential).toBe(false);

    const allIds = [
      ...result.attachments.map((a) => a.id),
      ...result.messages.map((m) => m.id),
    ];
    expect(allIds).not.toContain('doc_phi_secret');
    expect(allIds).not.toContain('msg_legal_secret');
  });

  it('supports entityType and partyId filters', async () => {
    const { ctx } = makePortalCtx(env.DB);
    const empty = await portalRecordsListCommand.handler(ctx, {
      entityType: 'med_clinical_note',
      partyId: 'party_1',
      limit: 50,
    });
    expect(empty.attachments).toHaveLength(0);
    expect(empty.messages).toHaveLength(1);
  });

  it('enforces 404 and 403 tenant/org isolation', async () => {
    const { ctx } = makePortalCtx(env.DB);

    await expect(
      portalRecordsListCommand.handler(ctx, {
        orgId: 'org_missing',
        limit: 50,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' } satisfies Partial<AppError>);

    await expect(
      portalRecordsListCommand.handler(ctx, {
        orgId: 'org_1_south',
        limit: 50,
      }),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<AppError>);

    await expect(
      portalRecordsListCommand.handler(ctx, {
        orgId: 'org_2',
        limit: 50,
      }),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<AppError>);
  });
});
