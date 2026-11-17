import { canonicalizeJson } from './crypto.js';

const encoder = new TextEncoder();
export const GENESIS_AUDIT_HASH = '0'.repeat(64);

export interface AuditChainEntryInput {
  readonly orgId: string;
  readonly streamKey: string;
  readonly seqNo: number;
  readonly actorId: string;
  readonly action: string;
  readonly targetId: string;
  readonly occurredAtMs: number;
  readonly prevHashHex: string;
  readonly payload: unknown;
}

export interface VerifiedAuditChainResult {
  readonly valid: boolean;
  readonly checkedCount: number;
  readonly brokenAtSeqNo: number | null;
  readonly expectedHashHex: string | null;
  readonly actualHashHex: string | null;
}

export async function computeAuditEntryHashHex(
  entry: AuditChainEntryInput,
): Promise<string> {
  const canonicalPayload = canonicalizeJson(entry.payload);
  const preimage = [
    entry.prevHashHex || GENESIS_AUDIT_HASH,
    entry.orgId,
    entry.streamKey,
    String(entry.seqNo),
    entry.actorId,
    entry.action,
    entry.targetId,
    String(entry.occurredAtMs),
    canonicalPayload,
  ].join('|');

  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(preimage));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyAuditHashChain(
  entries: readonly (AuditChainEntryInput & { readonly recordHashHex: string })[],
): Promise<VerifiedAuditChainResult> {
  let expectedPrev = entries.length > 0 ? entries[0]!.prevHashHex : GENESIS_AUDIT_HASH;

  for (let i = 0; i < entries.length; i++) {
    const item = entries[i]!;
    if (i > 0 && item.prevHashHex !== expectedPrev) {
      return {
        valid: false,
        checkedCount: i,
        brokenAtSeqNo: item.seqNo,
        expectedHashHex: expectedPrev,
        actualHashHex: item.prevHashHex,
      };
    }
    const computed = await computeAuditEntryHashHex(item);
    if (computed !== item.recordHashHex) {
      return {
        valid: false,
        checkedCount: i,
        brokenAtSeqNo: item.seqNo,
        expectedHashHex: computed,
        actualHashHex: item.recordHashHex,
      };
    }
    expectedPrev = item.recordHashHex;
  }

  return {
    valid: true,
    checkedCount: entries.length,
    brokenAtSeqNo: null,
    expectedHashHex: null,
    actualHashHex: null,
  };
}
