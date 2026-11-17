import { computeAuditEntryHashHex, GENESIS_AUDIT_HASH } from '@shac/kernel';
import { and, desc, eq } from 'drizzle-orm';
import type { ShacD1Database } from './scope.js';
import { immutableAuditChainLedger } from './schema/hardening.js';

export interface AppendAuditChainParams {
  readonly orgId: string;
  readonly streamKey: string;
  readonly actorId: string;
  readonly action: string;
  readonly targetId: string;
  readonly occurredAtMs: number;
  readonly payload: unknown;
}

/**
 * Computes the next sequential SHA-256 hash-chain entry for `(orgId, streamKey)`
 * and returns a Drizzle insert statement ready for `db.batch([...])`.
 * Returns `null` if migration 0008 (`immutable_audit_chain_ledger`) is not yet present in the DB.
 */
export async function buildNextAuditChainInsert(
  db: ShacD1Database,
  params: AppendAuditChainParams,
): Promise<{ stmt: Parameters<ShacD1Database['batch']>[0][number] } | null> {
  let prev: { seqNo: number; recordHashHex: string } | undefined;
  try {
    const rows = await db
      .select({
        seqNo: immutableAuditChainLedger.seqNo,
        recordHashHex: immutableAuditChainLedger.recordHashHex,
      })
      .from(immutableAuditChainLedger)
      .where(
        and(
          eq(immutableAuditChainLedger.orgId, params.orgId),
          eq(immutableAuditChainLedger.streamKey, params.streamKey),
        ),
      )
      .orderBy(desc(immutableAuditChainLedger.seqNo))
      .limit(1);
    prev = rows[0];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('no such table')) {
      return null;
    }
    throw err;
  }

  const seqNo = (prev?.seqNo ?? 0) + 1;
  const prevHashHex = prev?.recordHashHex ?? GENESIS_AUDIT_HASH;
  const recordHashHex = await computeAuditEntryHashHex({
    orgId: params.orgId,
    streamKey: params.streamKey,
    seqNo,
    actorId: params.actorId,
    action: params.action,
    targetId: params.targetId,
    occurredAtMs: params.occurredAtMs,
    prevHashHex,
    payload: params.payload,
  });

  return {
    stmt: db.insert(immutableAuditChainLedger).values({
      orgId: params.orgId,
      streamKey: params.streamKey,
      seqNo,
      actorId: params.actorId,
      action: params.action,
      targetId: params.targetId,
      occurredAtMs: params.occurredAtMs,
      prevHashHex,
      recordHashHex,
      payloadJson: JSON.stringify(params.payload),
    }),
  };
}
