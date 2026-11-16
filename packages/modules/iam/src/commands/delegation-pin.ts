import { iamDelegationPins, type ShacD1Database } from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { z } from 'zod';
import type { WritableKvStore } from './api-keys.js';
import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
} from './idempotency.js';

const TTL_SECONDS_MAP = {
  '4h': 4 * 3600,
  '8h': 8 * 3600,
  '24h': 24 * 3600,
} as const;

const issuePinInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  redeemerUserId: z.string().min(1).optional(),
  scopePermissions: z.array(z.string().min(1)).min(1),
  ttl: z.enum(['4h', '8h', '24h']),
});

const issuePinOutputSchema = z.object({
  id: z.string(),
  pin: z.string().optional(),
  ttl: z.enum(['4h', '8h', '24h']),
  scopePermissions: z.array(z.string()),
  expiresAt: z.number().int(),
  createdAt: z.number().int(),
});

function generateSixDigitPin(): string {
  const buf = new Uint32Array(1);
  // Rejection sampling avoids modulo bias over 0..999_999
  const limit = 4_294_000_000;
  let value = limit;
  while (value >= limit) {
    crypto.getRandomValues(buf);
    value = buf[0] ?? limit;
  }
  return String(value % 1_000_000).padStart(6, '0');
}

export const iamDelegationIssuePinCommand = defineCommand<
  typeof issuePinInputSchema,
  z.infer<typeof issuePinOutputSchema>,
  ShacD1Database
>({
  id: 'iam.delegation.issuePin',
  moduleId: 'iam',
  method: 'POST',
  path: '/api/iam/delegation/pins',
  summary: 'Issue a 6-digit floor delegation PIN with 4h, 8h, or 24h TTL',
  requiredPermission: 'iam.delegation.issue',
  mcp: {
    expose: true,
    idempotentHint: true,
    description: 'Issue a cryptographic 6-digit delegation PIN stored in D1 and SESSION_KV',
  },
  inputSchema: issuePinInputSchema,
  outputSchema: issuePinOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'iam.delegation.issuePin',
        redeemerUserId: input.redeemerUserId ?? null,
        scopePermissions: input.scopePermissions,
        ttl: input.ttl,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      issuePinOutputSchema,
    );
    if (replay) {
      return replay;
    }

    const kv = ctx.sessionKv as WritableKvStore | undefined;
    if (!kv?.put) {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        503,
        'SESSION_KV is required to issue a delegation PIN',
      );
    }

    const pinId = crypto.randomUUID();
    const pin = generateSixDigitPin();
    const pinSha256 = await sha256Hex(pin);
    const ttlSeconds = TTL_SECONDS_MAP[input.ttl];
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = nowSec + ttlSeconds;

    const storedSummary = {
      id: pinId,
      ttl: input.ttl,
      scopePermissions: input.scopePermissions,
      expiresAt,
      createdAt: nowSec,
    };
    const storedResponseJson = JSON.stringify(storedSummary);

    await ctx.db.batch([
      ctx.db.insert(iamDelegationPins).values({
        id: pinId,
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        grantorUserId: ctx.actor.id,
        redeemerUserId: input.redeemerUserId ?? null,
        pinSha256,
        scopePermissionsJson: JSON.stringify(input.scopePermissions),
        durationLabel: input.ttl,
        expiresAt,
        status: 'active',
        createdAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        clientMutationId: input.clientMutationId,
        commandId: 'iam.delegation.issuePin',
        requestHash,
        responseJson: storedResponseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        actor: ctx.actor,
        commandId: 'iam.delegation.issuePin',
        resourceKind: 'iam_delegation_pin',
        resourceId: pinId,
        snapshotAfterJson: storedResponseJson,
        nowSec,
      }),
    ]);

    await kv.put(
      `delegation:${pinSha256}`,
      JSON.stringify({
        userId: input.redeemerUserId ?? ctx.actor.id,
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        orgPath: ctx.orgPath,
        perms: input.scopePermissions,
        delegatedById: ctx.actor.id,
        expiresAt,
      }),
      { expirationTtl: ttlSeconds },
    );

    return {
      ...storedSummary,
      pin,
    };
  },
});
