import { canonicalJsonSha256Hex } from './crypto.js';

export type IdempotencyStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED_RETRYABLE';

export interface IdempotencyEnvelope<T = unknown> {
  readonly scopeKey: string;
  readonly payloadHash: string;
  readonly status: IdempotencyStatus;
  readonly responseJson: T | null;
  readonly statusCode: number;
  readonly lockedAtMs: number;
  readonly expiresAtMs: number;
}

export class IdempotencyConflictError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(
    code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' | 'IDEMPOTENCY_IN_FLIGHT',
    message: string,
  ) {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.code = code;
    this.statusCode = 409;
  }
}

export async function evaluateIdempotencyState<T>(
  existing: IdempotencyEnvelope<T> | null,
  incomingPayload: unknown,
  nowMs: number = Date.now(),
  staleLockMs: number = 30_000,
): Promise<
  | { action: 'PROCEED_ACQUIRE'; payloadHash: string }
  | { action: 'REPLAY_COMPLETED'; cached: T; statusCode: number }
> {
  const payloadHash = await canonicalJsonSha256Hex(incomingPayload);
  if (!existing || existing.expiresAtMs <= nowMs) {
    return { action: 'PROCEED_ACQUIRE', payloadHash };
  }

  if (existing.payloadHash !== payloadHash) {
    throw new IdempotencyConflictError(
      'IDEMPOTENCY_PAYLOAD_MISMATCH',
      `Idempotency key reused with a different payload for scope ${existing.scopeKey}`,
    );
  }

  if (existing.status === 'COMPLETED' && existing.responseJson !== null) {
    return {
      action: 'REPLAY_COMPLETED',
      cached: existing.responseJson,
      statusCode: existing.statusCode || 200,
    };
  }

  if (existing.status === 'IN_PROGRESS' && nowMs - existing.lockedAtMs < staleLockMs) {
    throw new IdempotencyConflictError(
      'IDEMPOTENCY_IN_FLIGHT',
      `Mutation ${existing.scopeKey} is currently in flight`,
    );
  }

  return { action: 'PROCEED_ACQUIRE', payloadHash };
}
