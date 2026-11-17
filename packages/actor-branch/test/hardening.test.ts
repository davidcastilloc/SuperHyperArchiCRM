import { describe, expect, it } from 'vitest';
import {
  classifyOutboxFailure,
  computeOutboxBackoffMs,
  OUTBOX_MAX_ATTEMPTS,
  validateFencingToken,
} from '../src/index.js';

describe('@shac/actor-branch hardening: outbox backoff/DLQ & fencing tokens', () => {
  it('computes bounded exponential backoff with jitter and classifies DLQ at max attempts', () => {
    expect(OUTBOX_MAX_ATTEMPTS).toBe(8);
    expect(computeOutboxBackoffMs(0, 0)).toBe(250);
    expect(computeOutboxBackoffMs(1, 0)).toBe(500);
    expect(computeOutboxBackoffMs(20, 0)).toBe(60_000);
    expect(computeOutboxBackoffMs(2, 0.5)).toBeGreaterThan(1000);

    expect(classifyOutboxFailure(0)).toEqual({
      nextStatus: 'PENDING',
      nextDelayMs: expect.any(Number),
    });
    expect(classifyOutboxFailure(7)).toEqual({
      nextStatus: 'DLQ',
      nextDelayMs: 0,
    });
  });

  it('validates monotonic fencing tokens and preserves undefined compatibility', () => {
    expect(validateFencingToken(5, undefined)).toBe(true);
    expect(validateFencingToken(5, 5)).toBe(true);
    expect(validateFencingToken(5, 6)).toBe(true);
    expect(validateFencingToken(5, 4)).toBe(false);
    expect(validateFencingToken(5, 4.5)).toBe(false);
  });
});
