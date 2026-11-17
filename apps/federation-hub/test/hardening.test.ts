import { AppError } from '@shac/kernel';
import { describe, expect, it } from 'vitest';
import { assertEnvelopeTimestampWindow } from '../src/envelopes.js';

describe('@shac/federation-hub envelope timestamp & replay hardening', () => {
  it('accepts timestamps within 300s skew and rejects stale timestamps', () => {
    expect(() => assertEnvelopeTimestampWindow(100_000, 150_000)).not.toThrow();
    try {
      assertEnvelopeTimestampWindow(100_000, 500_000);
      expect.unreachable('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ code: 'ENVELOPE_TIMESTAMP_SKEW', status: 409 });
    }
  });
});
