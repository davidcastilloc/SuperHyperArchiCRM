import { AppError, sha256Hex, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const DispatchWebhookSchema = z.object({
  eventType: z.string().min(1).max(80),
  payload: z.record(z.unknown()).default({}),
  dryRun: z.boolean().default(false),
});

function sanitizeMediaKey(rawKey: string): string {
  const cleaned = rawKey.trim().replace(/^\/+/, '');
  if (!/^[a-zA-Z0-9._/-]{1,160}$/.test(cleaned) || cleaned.includes('..')) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid media object key');
  }
  return cleaned;
}

async function signHmacSha256Hex(secret: string, bodyText: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(bodyText));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mounts R2/D1 media object storage (`doc_attachments`) and HMAC-SHA256 webhook dispatcher routes. */
export function createMediaAndWebhooksRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/media', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.read');
      const res = await c.env.DB.prepare(
        `SELECT id, entity_type, record_id, file_name, mime_type, file_size_bytes, r2_object_key, sha256_hash, created_at
         FROM doc_attachments
         WHERE tenant_id = ?1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
      ).bind(auth.actor.tenantId).all<{
        id: string;
        entity_type: string;
        record_id: string;
        file_name: string;
        mime_type: string;
        file_size_bytes: number;
        r2_object_key: string;
        sha256_hash: string;
        created_at: number;
      }>();
      return c.json({
        items: (res.results ?? []).map((row) => ({
          id: row.id,
          key: row.file_name,
          entityType: row.entity_type,
          entityId: row.record_id,
          contentType: row.mime_type,
          sizeBytes: row.file_size_bytes,
          r2ObjectKey: row.r2_object_key,
          sha256Hash: row.sha256_hash,
          createdAt: row.created_at,
        })),
      });
    })
    .put('/media/:key', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.write');
      const key = sanitizeMediaKey(c.req.param('key'));
      const entityType = c.req.query('entityType') ?? 'GENERAL';
      const entityId = c.req.query('entityId') ?? 'unlinked';
      const contentType = c.req.header('content-type') ?? 'application/octet-stream';
      const bodyBuf = await c.req.arrayBuffer();
      const sizeBytes = bodyBuf.byteLength;
      if (sizeBytes === 0 || sizeBytes > 5_000_000) {
        throw new AppError('VALIDATION_ERROR', 400, 'Media payload must be between 1 byte and 5 MB');
      }

      const objectPath = `${auth.actor.tenantId}/${key}`;
      let storageBackend: 'R2' | 'D1_META' = 'D1_META';
      if (c.env.MEDIA_BUCKET) {
        await c.env.MEDIA_BUCKET.put(objectPath, bodyBuf, {
          httpMetadata: { contentType },
          customMetadata: { tenantId: auth.actor.tenantId, entityType, entityId },
        });
        storageBackend = 'R2';
      }

      const bodyBytes = new Uint8Array(bodyBuf);
      const hashInput = Array.from(bodyBytes, (b) => String.fromCharCode(b)).join('');
      const sha256Hash = await sha256Hex(hashInput);
      const inlineBodyBase64 =
        storageBackend === 'D1_META' && sizeBytes <= 250_000 ? btoa(hashInput) : null;
      const customFields = JSON.stringify({ storageBackend, inlineBodyBase64 });

      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO doc_attachments
          (id, tenant_id, org_id, entity_type, record_id, file_name, mime_type, file_size_bytes, r2_object_key, sha256_hash, uploaded_by_user_id, custom_fields, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      )
        .bind(
          id,
          auth.actor.tenantId,
          auth.actor.orgId,
          entityType,
          entityId,
          key,
          contentType,
          sizeBytes,
          objectPath,
          sha256Hash,
          auth.actor.id || 'usr_system',
          customFields,
          nowSec,
          nowSec,
        )
        .run();

      return c.json({ ok: true, id, key, contentType, sizeBytes, sha256Hash, storageBackend }, 201);
    })
    .get('/media/:key', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.read');
      const key = sanitizeMediaKey(c.req.param('key'));
      const objectPath = `${auth.actor.tenantId}/${key}`;

      if (c.env.MEDIA_BUCKET) {
        const obj = await c.env.MEDIA_BUCKET.get(objectPath);
        if (obj) {
          const headers = new Headers();
          obj.writeHttpMetadata(headers);
          headers.set('etag', obj.httpEtag);
          return new Response(obj.body, { status: 200, headers });
        }
      }

      const row = await c.env.DB.prepare(
        `SELECT mime_type, custom_fields FROM doc_attachments
         WHERE tenant_id = ?1 AND r2_object_key = ?2 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      ).bind(auth.actor.tenantId, objectPath).first<{ mime_type: string; custom_fields: string }>();

      if (!row) {
        throw new AppError('NOT_FOUND', 404, `Media object '${key}' not found`);
      }

      const meta = JSON.parse(row.custom_fields || '{}') as { inlineBodyBase64?: string | null };
      if (!meta.inlineBodyBase64) {
        throw new AppError('NOT_FOUND', 404, `Media bytes for '${key}' are unavailable`);
      }
      const binary = Uint8Array.from(atob(meta.inlineBodyBase64), (ch) => ch.charCodeAt(0));
      return new Response(binary, {
        status: 200,
        headers: { 'content-type': row.mime_type || 'application/octet-stream' },
      });
    })
    .post('/system/connectors/:id/dispatch', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.write');
      const connectorId = c.req.param('id');
      const parsed = DispatchWebhookSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid webhook dispatch payload', parsed.error.flatten());
      }

      const connector = await c.env.DB.prepare(
        `SELECT id, provider_or_url, field_mapping_json, processed_count, failed_count
         FROM int_webhooks_and_sync_jobs
         WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL LIMIT 1`,
      ).bind(connectorId, auth.actor.tenantId).first<{
        id: string;
        provider_or_url: string;
        field_mapping_json: string;
        processed_count: number;
        failed_count: number;
      }>();

      if (!connector) {
        throw new AppError('NOT_FOUND', 404, 'Connector not found');
      }

      const cfg = JSON.parse(connector.field_mapping_json || '{}') as { secret?: string };
      const signingSecret = cfg.secret ?? c.env.LICENSE_HMAC_SECRET ?? 'shac-default-webhook-secret';
      const envelope = JSON.stringify({
        id: crypto.randomUUID(),
        tenantId: auth.actor.tenantId,
        eventType: parsed.data.eventType,
        occurredAt: new Date().toISOString(),
        payload: parsed.data.payload,
      });
      const signatureHeader = `sha256=${await signHmacSha256Hex(signingSecret, envelope)}`;

      let delivered = true;
      let statusCode = 200;
      let lastError: string | null = null;
      if (!parsed.data.dryRun) {
        try {
          const res = await fetch(connector.provider_or_url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-shac-event': parsed.data.eventType,
              'x-shac-signature-256': signatureHeader,
            },
            body: envelope,
          });
          statusCode = res.status;
          delivered = res.ok;
          if (!res.ok) lastError = `HTTP ${res.status}`;
        } catch (err) {
          delivered = false;
          statusCode = 502;
          lastError = err instanceof Error ? err.message : 'Network error';
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const nextProcessed = connector.processed_count + (delivered ? 1 : 0);
      const nextFailed = connector.failed_count + (delivered ? 0 : 1);
      await c.env.DB.prepare(
        `UPDATE int_webhooks_and_sync_jobs
         SET processed_count = ?1, failed_count = ?2, last_error = ?3, updated_at = ?4
         WHERE id = ?5 AND tenant_id = ?6`,
      ).bind(nextProcessed, nextFailed, lastError, nowSec, connectorId, auth.actor.tenantId).run();

      return c.json({
        ok: delivered,
        connectorId,
        eventType: parsed.data.eventType,
        signatureHeader,
        statusCode,
        processedCount: nextProcessed,
        failedCount: nextFailed,
      });
    });
}
