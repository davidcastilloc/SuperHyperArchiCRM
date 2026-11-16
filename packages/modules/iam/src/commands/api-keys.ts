import { iamApiKeys, type ShacD1Database } from '@shac/db-d1';
import { defineCommand, sha256Hex, type KvStore } from '@shac/kernel';
import { z } from 'zod';
import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
} from './idempotency.js';

export type WritableKvStore = KvStore & {
  put?: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<void>;
};

const createApiKeyInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  name: z.string().min(1).max(120),
  permissions: z.array(z.string().min(1)).min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const createApiKeyOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  plainTextKey: z.string().optional(),
  permissions: z.array(z.string()),
  expiresAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});

function generateRandomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const iamApiKeysCreateCommand = defineCommand<
  typeof createApiKeyInputSchema,
  z.infer<typeof createApiKeyOutputSchema>,
  ShacD1Database
>({
  id: 'iam.apiKeys.create',
  moduleId: 'iam',
  method: 'POST',
  path: '/api/iam/api-keys',
  summary: 'Create a scoped API key for machine-to-machine or MCP access',
  requiredPermission: 'iam.apiKeys.create',
  mcp: {
    expose: true,
    idempotentHint: true,
    description: 'Create a scoped API key with SHA-256 hash stored in D1 and SESSION_KV',
  },
  inputSchema: createApiKeyInputSchema,
  outputSchema: createApiKeyOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'iam.apiKeys.create',
        name: input.name,
        permissions: input.permissions,
        expiresInDays: input.expiresInDays ?? null,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      createApiKeyOutputSchema,
    );
    if (replay) {
      return replay;
    }

    const keyId = crypto.randomUUID();
    const plainTextKey = `mk_live_${generateRandomHex(24)}`;
    const keyPrefix = plainTextKey.slice(0, 16);
    const keySha256 = await sha256Hex(plainTextKey);
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt =
      input.expiresInDays !== undefined ? nowSec + input.expiresInDays * 86_400 : null;

    const storedSummary = {
      id: keyId,
      name: input.name,
      keyPrefix,
      permissions: input.permissions,
      expiresAt,
      createdAt: nowSec,
    };
    const storedResponseJson = JSON.stringify(storedSummary);

    await ctx.db.batch([
      ctx.db.insert(iamApiKeys).values({
        id: keyId,
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        name: input.name,
        keyPrefix,
        keySha256,
        permissionsJson: JSON.stringify(input.permissions),
        createdBy: ctx.actor.id,
        expiresAt,
        createdAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        clientMutationId: input.clientMutationId,
        commandId: 'iam.apiKeys.create',
        requestHash,
        responseJson: storedResponseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        actor: ctx.actor,
        commandId: 'iam.apiKeys.create',
        resourceKind: 'iam_api_key',
        resourceId: keyId,
        snapshotAfterJson: storedResponseJson,
        nowSec,
      }),
    ]);

    const kv = ctx.sessionKv as WritableKvStore | undefined;
    if (kv?.put) {
      await kv.put(
        `apikey:${keySha256}`,
        JSON.stringify({
          keyId,
          tenantId: ctx.tenantId,
          orgId: ctx.orgId,
          orgPath: ctx.orgPath,
          perms: input.permissions,
          ...(expiresAt !== null ? { expiresAt } : {}),
        }),
        expiresAt !== null ? { expirationTtl: expiresAt - nowSec } : undefined,
      );
    }

    return {
      ...storedSummary,
      plainTextKey,
    };
  },
});
