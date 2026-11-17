import { describe, expect, it } from 'vitest';
import {
  computeAuditEntryHashHex,
  GENESIS_AUDIT_HASH,
  verifyAuditHashChain,
  type AuditChainEntryInput,
} from '../src/index.js';

describe('@shac/kernel hash-chained audit ledger', () => {
  it('verifies an intact SHA-256 hash chain and detects tampering or broken links', async () => {
    const e1Base: AuditChainEntryInput = {
      orgId: 'org_1',
      streamKey: 'finance:trust',
      seqNo: 1,
      actorId: 'usr_1',
      action: 'DISBURSEMENT',
      targetId: 'led_1',
      occurredAtMs: 1_000,
      prevHashHex: GENESIS_AUDIT_HASH,
      payload: { amountMinor: 5000 },
    };
    const h1 = await computeAuditEntryHashHex(e1Base);

    const e2Base: AuditChainEntryInput = {
      orgId: 'org_1',
      streamKey: 'finance:trust',
      seqNo: 2,
      actorId: 'usr_1',
      action: 'DEPOSIT',
      targetId: 'led_1',
      occurredAtMs: 2_000,
      prevHashHex: h1,
      payload: { amountMinor: 10000 },
    };
    const h2 = await computeAuditEntryHashHex(e2Base);

    const validResult = await verifyAuditHashChain([
      { ...e1Base, recordHashHex: h1 },
      { ...e2Base, recordHashHex: h2 },
    ]);
    expect(validResult).toEqual({
      valid: true,
      checkedCount: 2,
      brokenAtSeqNo: null,
      expectedHashHex: null,
      actualHashHex: null,
    });

    const tamperedPayload = await verifyAuditHashChain([
      { ...e1Base, recordHashHex: h1 },
      { ...e2Base, payload: { amountMinor: 99999 }, recordHashHex: h2 },
    ]);
    expect(tamperedPayload.valid).toBe(false);
    expect(tamperedPayload.brokenAtSeqNo).toBe(2);

    const brokenLink = await verifyAuditHashChain([
      { ...e1Base, recordHashHex: h1 },
      { ...e2Base, prevHashHex: 'f'.repeat(64), recordHashHex: h2 },
    ]);
    expect(brokenLink.valid).toBe(false);
    expect(brokenLink.brokenAtSeqNo).toBe(2);
  });
});
