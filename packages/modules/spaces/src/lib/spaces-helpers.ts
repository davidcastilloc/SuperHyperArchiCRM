import {
  kernelIdempotencyKeys,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, type ExecutionContext } from '@shac/kernel';

export type SpacesCtx = ExecutionContext<ShacD1Database>;

const IDEMPOTENCY_TTL_SEC = 86_400;

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
    id: `idem_${crypto.randomUUID().replace(/-/g, '')}`,
    tenantId: params.tenantId,
    orgId: params.orgId,
    clientMutationId: params.clientMutationId,
    commandId: params.commandId,
    requestHash: params.requestHash,
    responseStatus: 200,
    responseJson: params.responseJson,
    createdAt: params.nowSec,
    expiresAt: params.nowSec + IDEMPOTENCY_TTL_SEC,
  });
}

export function resolveOrgId(ctx: SpacesCtx, orgId?: string): string {
  return orgId && orgId.trim().length > 0 ? orgId : ctx.orgId;
}

export function nowEpochSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Computes a deterministic SHA-256 hex digest of a command payload for idempotency checks.
 */
export async function computeCommandRequestHash(
  commandId: string,
  payload: unknown,
): Promise<string> {
  const canonical = JSON.stringify({ commandId, payload });
  const encoded = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Calls BranchInventoryDO over its ExecutionContext port for `${tenantId}:${orgId}`.
 */
export async function callBranchDoJson<TOut>(
  ctx: Pick<SpacesCtx, 'tenantId' | 'branchDo'>,
  orgId: string,
  path: string,
  body: unknown,
): Promise<TOut> {
  if (!ctx.branchDo) {
    throw new AppError(
      'BRANCH_DO_UNAVAILABLE',
      503,
      'BranchInventoryDO resolver is not configured on ExecutionContext',
    );
  }

  const stub = ctx.branchDo.getByBranchKey(`${ctx.tenantId}:${orgId}`);
  const response = await stub.fetch(`https://do.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as
    | TOut
    | {
        ok?: false;
        error?: {
          code?: string;
          status?: number;
          message?: string;
          details?: unknown;
        };
      };

  if (!response.ok) {
    const err =
      payload && typeof payload === 'object' && 'error' in payload
        ? payload.error
        : undefined;
    throw new AppError(
      err?.code ?? 'BRANCH_DO_ERROR',
      err?.status ?? response.status,
      err?.message ?? `BranchInventoryDO failed with status ${response.status}`,
      err?.details,
    );
  }

  return payload as TOut;
}
