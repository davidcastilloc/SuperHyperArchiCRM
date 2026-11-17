import {
  verifyAuditHashChain,
  type AuditChainEntryInput,
  type ProfileLoader,
} from '@shac/kernel';
import { Hono } from 'hono';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

export const AUDIT_CHAIN_STREAMS = [
  'finance:trust',
  'finance:journal',
  'clinical:soap',
  'legal:docket',
  'physical:tamper',
] as const;

export async function verifyAuditChainStream(
  db: D1Database,
  orgId: string,
  streamKey: string,
  limit = 500,
) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await db
    .prepare(
      `SELECT org_id, stream_key, seq_no, actor_id, action, target_id, occurred_at_ms, prev_hash_hex, record_hash_hex, payload_json
       FROM immutable_audit_chain_ledger
       WHERE org_id = ?1 AND stream_key = ?2
       ORDER BY seq_no ASC LIMIT ?3`,
    )
    .bind(orgId, streamKey, safeLimit)
    .all<{
      org_id: string;
      stream_key: string;
      seq_no: number;
      actor_id: string;
      action: string;
      target_id: string;
      occurred_at_ms: number;
      prev_hash_hex: string;
      record_hash_hex: string;
      payload_json: string;
    }>();
  const entries: Array<AuditChainEntryInput & { readonly recordHashHex: string }> = (
    rows.results ?? []
  ).map((r) => ({
    orgId: r.org_id,
    streamKey: r.stream_key,
    seqNo: r.seq_no,
    actorId: r.actor_id,
    action: r.action,
    targetId: r.target_id,
    occurredAtMs: r.occurred_at_ms,
    prevHashHex: r.prev_hash_hex,
    recordHashHex: r.record_hash_hex,
    payload: JSON.parse(r.payload_json) as unknown,
  }));
  const result = await verifyAuditHashChain(entries);
  return { streamKey, ...result };
}

export function createAuditChainRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/streams', async (c) => {
      const auth = await authenticateWorkerActor(
        c.env,
        c.req.raw.headers,
        profileLoader,
        'iam',
        'iam.orgs.read',
      );
      const orgId = c.req.query('orgId')?.trim() || auth.actor.orgId;
      const rows = await c.env.DB.prepare(
        `SELECT stream_key, COUNT(*) AS entry_count, MAX(seq_no) AS latest_seq
         FROM immutable_audit_chain_ledger
         WHERE org_id = ?1
         GROUP BY stream_key
         ORDER BY stream_key ASC`,
      )
        .bind(orgId)
        .all<{ stream_key: string; entry_count: number; latest_seq: number }>();
      return c.json(
        {
          orgId,
          supportedStreams: AUDIT_CHAIN_STREAMS,
          streams: (rows.results ?? []).map((r) => ({
            streamKey: r.stream_key,
            entryCount: Number(r.entry_count),
            latestSeq: Number(r.latest_seq),
          })),
        },
        200,
      );
    })
    .post('/verify', async (c) => {
      const auth = await authenticateWorkerActor(
        c.env,
        c.req.raw.headers,
        profileLoader,
        'iam',
        'iam.orgs.read',
      );
      const body = (await c.req.json().catch(() => ({}))) as {
        streamKey?: string;
        orgId?: string;
      };
      const streamKey =
        typeof body.streamKey === 'string' && body.streamKey.trim()
          ? body.streamKey.trim()
          : 'finance:trust';
      const orgId =
        typeof body.orgId === 'string' && body.orgId.trim()
          ? body.orgId.trim()
          : auth.actor.orgId;
      const result = await verifyAuditChainStream(c.env.DB, orgId, streamKey, 500);
      return c.json(result, 200);
    });
}
