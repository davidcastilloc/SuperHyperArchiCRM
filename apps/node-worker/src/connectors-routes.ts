import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const ConnectorSchema = z.object({
  recordKind: z.enum([
    'webhook_endpoint',
    'payment_gateway',
    'messaging_channel',
    'carrier_sync',
    'web_research',
    'excel_sync',
  ]),
  providerOrUrl: z.string().min(1).max(240),
  events: z.array(z.string()).default(['order.created']),
  configJson: z.string().default('{}'),
});

const AiChatSchema = z.object({
  prompt: z.string().min(1).max(2000),
});

/** Mounts Part B Satellite Connectors (Gateways, Messaging, Carriers, Webhooks, Research) & AI Chat. */
export function createConnectorsRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/system/connectors', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.read');
      const res = await c.env.DB.prepare(
        `SELECT id, record_kind, provider_or_url, subscribed_events_json, processed_count, status, created_at
         FROM int_webhooks_and_sync_jobs WHERE tenant_id = ?1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
      ).bind(auth.actor.tenantId).all<{
        id: string; record_kind: string; provider_or_url: string;
        subscribed_events_json: string; processed_count: number; status: string; created_at: number;
      }>();
      return c.json({
        items: (res.results ?? []).map((j) => ({
          id: j.id,
          recordKind: j.record_kind,
          providerOrUrl: j.provider_or_url,
          subscribedEventsJson: j.subscribed_events_json,
          processedCount: j.processed_count,
          status: j.status,
          createdAt: j.created_at,
        })),
      });
    })
    .post('/system/connectors', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'iam', 'iam.orgs.write');
      const parsed = ConnectorSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid connector payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO int_webhooks_and_sync_jobs
          (id, tenant_id, org_id, record_kind, provider_or_url, subscribed_events_json, field_mapping_json, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ACTIVE', ?8, ?8)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.recordKind, d.providerOrUrl.trim(), JSON.stringify(d.events), d.configJson, nowSec).run();
      return c.json({ id, ...d, status: 'ACTIVE' }, 201);
    })
    .post('/automation/ai-chat', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'core', 'customers.read');
      if (!auth.profile.entitlements.aiCopilotEnabled) {
        throw new AppError('MODULE_NOT_ENABLED', 403, 'AI Copilot is disabled in active market profile');
      }
      const parsed = AiChatSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid AI prompt', parsed.error.flatten());
      const prompt = parsed.data.prompt.trim();

      const [partiesRes, ordersRes, dealsRes] = await c.env.DB.batch([
        c.env.DB.prepare(`SELECT COUNT(*) AS cnt FROM crm_parties WHERE tenant_id = ?1 AND deleted_at IS NULL`).bind(auth.actor.tenantId),
        c.env.DB.prepare(`SELECT COUNT(*) AS cnt, COALESCE(SUM(grand_total_minor), 0) AS total FROM com_orders WHERE tenant_id = ?1 AND deleted_at IS NULL`).bind(auth.actor.tenantId),
        c.env.DB.prepare(`SELECT COUNT(*) AS cnt, COALESCE(SUM(value_minor), 0) AS total FROM crm_deals WHERE tenant_id = ?1 AND outcome = 'open' AND deleted_at IS NULL`).bind(auth.actor.tenantId),
      ]);

      const partyCount = (partiesRes?.results?.[0] as { cnt?: number } | undefined)?.cnt ?? 0;
      const orderStats = (ordersRes?.results?.[0] as { cnt?: number; total?: number } | undefined) ?? { cnt: 0, total: 0 };
      const dealStats = (dealsRes?.results?.[0] as { cnt?: number; total?: number } | undefined) ?? { cnt: 0, total: 0 };

      const telemetrySummary = [
        `Tenant: ${auth.profile.tenantId} (${auth.actor.orgId})`,
        `Clientes activos: ${partyCount}`,
        `Órdenes registradas: ${orderStats.cnt ?? 0} ($${((orderStats.total ?? 0) / 100).toFixed(2)})`,
        `Pipeline abierto: ${dealStats.cnt ?? 0} oportunidades ($${((dealStats.total ?? 0) / 100).toFixed(2)})`,
      ].join(' | ');

      let engine = 'd1-deterministic-copilot';
      let reply = [
        `Consulta ejecutada sobre el Edge D1 de ${auth.profile.tenantId} (${auth.actor.orgId}):`,
        `• Clientes activos: ${partyCount}`,
        `• Órdenes registradas: ${orderStats.cnt ?? 0} ($${((orderStats.total ?? 0) / 100).toFixed(2)})`,
        `• Pipeline abierto: ${dealStats.cnt ?? 0} oportunidades ($${((dealStats.total ?? 0) / 100).toFixed(2)})`,
        `Acción sugerida para "${prompt}": puedes abrir /orders, /deals o /custom-fields desde la paleta ⌘K.`,
      ].join('\n');

      if (c.env.AI) {
        try {
          const aiOut = (await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [
              {
                role: 'system',
                content: `Eres el copiloto operativo de SuperHyperArchiCRM. Responde en español conciso usando esta telemetría viva: ${telemetrySummary}`,
              },
              { role: 'user', content: prompt },
            ],
          })) as { response?: string } | undefined;
          if (aiOut?.response?.trim()) {
            engine = 'workers-ai:@cf/meta/llama-3.1-8b-instruct';
            reply = aiOut.response.trim();
          }
        } catch {
          // Graceful fallback to D1 deterministic summary when AI binding fails
        }
      }

      return c.json({ ok: true, engine, reply, metrics: { partyCount, ordersCount: orderStats.cnt ?? 0, openDealsCount: dealStats.cnt ?? 0 } }, 200);
    });
}
