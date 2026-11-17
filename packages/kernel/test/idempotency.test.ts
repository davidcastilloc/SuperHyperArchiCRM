import { describe, expect, it } from 'vitest';
import {
  evaluateIdempotencyState,
  IdempotencyConflictError,
  type IdempotencyEnvelope,
} from '../src/index.js';

describe('@shac/kernel idempotency contract', () => {
  it('acquires when no existing record or expired', async () => {
    const res = await evaluateIdempotencyState(null, { amount: 100 }, 1000);
    expect(res.action).toBe('PROCEED_ACQUIRE');
    if (res.action === 'PROCEED_ACQUIRE') {
      expect(res.payloadHash).toHaveLength(64);
    }
  });

  it('replays completed response and rejects payload mismatch or active in-flight', async () => {
    const first = await evaluateIdempotencyState(null, { amount: 100 }, 1000);
    if (first.action !== 'PROCEED_ACQUIRE') throw new Error('expected acquire');

    const completed: IdempotencyEnvelope<{ ok: boolean }> = {
      scopeKey: 'org_1:pos.checkout:key_1',
      payloadHash: first.payloadHash,
      status: 'COMPLETED',
      responseJson: { ok: true },
      statusCode: 201,
      lockedAtMs: 1000,
      expiresAtMs: 10_000,
    };

    const replay = await evaluateIdempotencyState(completed, { amount: 100 }, 2000);
    expect(replay).toEqual({
      action: 'REPLAY_COMPLETED',
      cached: { ok: true },
      statusCode: 201,
    });

    await expect(
      evaluateIdempotencyState(completed, { amount: 200 }, 2000),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const inFlight: IdempotencyEnvelope = {
      ...completed,
      status: 'IN_PROGRESS',
      responseJson: null,
    };
    await expect(
      evaluateIdempotencyState(inFlight, { amount: 100 }, 5000, 30_000),
    ).rejects.toThrow('currently in flight');

    const staleRetry = await evaluateIdempotencyState(inFlight, { amount: 100 }, 40_000, 30_000);
    expect(staleRetry.action).toBe('PROCEED_ACQUIRE');
  });
});
