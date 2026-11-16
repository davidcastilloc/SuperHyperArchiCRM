import { AppError, type ExecutionActor } from '@shac/kernel';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { kernelActionLogs, kernelIdempotencyKeys } from './schema/iam.js';
import type { ShacD1Database } from './scope.js';

export async function checkIdempotency<T>(
  db: ShacD1Database,
  tenantId: string,
  clientMutationId: string,
  requestHash: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const existing = await db
    .select()
    .from(kernelIdempotencyKeys)
    .where(
      and(
        eq(kernelIdempotencyKeys.tenantId, tenantId),
        eq(kernelIdempotencyKeys.clientMutationId, clientMutationId),
      ),
    )
    .limit(1);

  const hit = existing[0];
  if (!hit) {
    return null;
  }
  if (hit.requestHash !== requestHash) {
    throw new AppError(
      'IDEMPOTENCY_CONFLICT',
      409,
      'clientMutationId already used with a different payload',
    );
  }
  return schema.parse(JSON.parse(hit.responseJson));
}

export function buildIdempotencyInsert(
  db: ShacD1Database,
  params: {
    tenantId: string;
    orgId: string;
    clientMutationId: string;
    commandId: string;
    requestHash: string;
    responseJson: string;
    nowSec: number;
  },
) {
  return db.insert(kernelIdempotencyKeys).values({
    id: crypto.randomUUID(),
    tenantId: params.tenantId,
    orgId: params.orgId,
    clientMutationId: params.clientMutationId,
    commandId: params.commandId,
    requestHash: params.requestHash,
    responseStatus: 200,
    responseJson: params.responseJson,
    createdAt: params.nowSec,
    expiresAt: params.nowSec + 86_400,
  });
}

export function buildActionLogInsert(
  db: ShacD1Database,
  params: {
    tenantId: string;
    orgId: string;
    actor: ExecutionActor;
    commandId: string;
    resourceKind: string;
    resourceId: string;
    snapshotAfterJson: string;
    nowSec: number;
    targetPartyId?: string | null;
    snapshotBeforeJson?: string | null;
    logStream?: string;
  },
) {
  return db.insert(kernelActionLogs).values({
    id: crypto.randomUUID(),
    tenantId: params.tenantId,
    orgId: params.orgId,
    logStream: params.logStream ?? 'action_mutation',
    actorId: params.actor.id,
    delegatedById: params.actor.delegatedById ?? null,
    targetPartyId: params.targetPartyId ?? null,
    commandId: params.commandId,
    resourceKind: params.resourceKind,
    resourceId: params.resourceId,
    snapshotBeforeJson: params.snapshotBeforeJson ?? null,
    snapshotAfterJson: params.snapshotAfterJson,
    createdAt: params.nowSec,
  });
}
