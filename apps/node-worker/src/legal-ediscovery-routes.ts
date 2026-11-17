import { AppError, sha256Hex, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const EdiscoveryHoldSchema = z.object({
  matterId: z.string().min(1),
  title: z.string().min(1).max(180),
  custodian: z.string().min(1).max(120),
  privilegeTag: z.enum(['PRIVILEGED', 'RESPONSIVE', 'HOT_DOC', 'REDACTED']).default('RESPONSIVE'),
  snippetText: z.string().min(1).max(4000),
});

const AiBriefSchema = z.object({
  matterId: z.string().min(1),
  title: z.string().min(1).max(180),
  courtName: z.string().min(1).max(160),
  keyArguments: z.string().min(1).max(4000),
});

const CitationOrEthicsSchema = z.object({
  recordKind: z.enum(['legal_citation', 'ethics_license']),
  title: z.string().min(1).max(180),
  jurisdiction: z.string().min(1).max(120),
  statusTag: z.string().min(1).max(40).default('COMPLIANT'),
  cleCompletedHours: z.number().int().nonnegative().default(0),
  cleRequiredHours: z.number().int().nonnegative().default(20),
  expiresAtIso: z.string().max(40).optional(),
});

/** Mounts Legal e-Discovery (Bates), AI Briefs Generator, Citations & Bar/CLE Ethics routes. */
export function createLegalEdiscoveryRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/legal/ediscovery-ethics', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.read');
      const res = await c.env.DB.prepare(
        `SELECT id, folder_id, title, content_html, custom_fields, created_at
         FROM doc_collaborative_pages
         WHERE tenant_id = ?1 AND folder_id IN ('ediscovery_hold', 'legal_brief', 'legal_citation', 'ethics_license') AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
      ).bind(auth.actor.tenantId).all<{
        id: string;
        folder_id: string;
        title: string;
        content_html: string | null;
        custom_fields: string;
        created_at: number;
      }>();

      const rows = (res.results ?? []).map((r) => ({
        id: r.id,
        folderId: r.folder_id,
        title: r.title,
        content: r.content_html ?? '',
        meta: JSON.parse(r.custom_fields || '{}') as Record<string, unknown>,
        createdAt: r.created_at,
      }));

      return c.json({
        ediscoveryHolds: rows.filter((r) => r.folderId === 'ediscovery_hold'),
        briefs: rows.filter((r) => r.folderId === 'legal_brief'),
        ethicsAndCitations: rows.filter((r) => r.folderId === 'legal_citation' || r.folderId === 'ethics_license'),
      });
    })
    .post('/legal/ediscovery-hold', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.write');
      const parsed = EdiscoveryHoldSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid e-Discovery payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      const batesNumber = `BATES-2026-${String(nowSec).slice(-4)}${id.slice(0, 2).toUpperCase()}`;
      const sha256Hash = await sha256Hex(`${batesNumber}|${d.matterId}|${d.snippetText}`);
      const meta = JSON.stringify({
        matterId: d.matterId,
        custodian: d.custodian,
        privilegeTag: d.privilegeTag,
        batesNumber,
        sha256Hash,
      });
      await c.env.DB.prepare(
        `INSERT INTO doc_collaborative_pages
          (id, tenant_id, org_id, folder_id, title, content_html, custom_fields, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'ediscovery_hold', ?4, ?5, ?6, ?7, ?7)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.title.trim(), d.snippetText, meta, nowSec).run();
      return c.json({ ok: true, id, batesNumber, sha256Hash, privilegeTag: d.privilegeTag }, 201);
    })
    .post('/legal/ai-brief', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.write');
      const parsed = AiBriefSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid brief payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);

      let draftedBrief = [
        `AL ${d.courtName.toUpperCase()}`,
        `ASUNTO: ${d.title} (Expediente ${d.matterId})`,
        `I. OBJETO Y HECHOS: Se presenta solicitud formal fundamentada en los hechos del expediente.`,
        `II. FUNDAMENTOS DE DERECHO: ${d.keyArguments}`,
        `III. PETITORIO: Se solicita admitir y decretar las medidas requeridas conforme a derecho.`,
      ].join('\n\n');

      if (c.env.AI) {
        try {
          const aiOut = (await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [
              { role: 'system', content: 'Redacta un borrador formal de escrito judicial en español con secciones I. Hechos, II. Derecho y III. Petitorio.' },
              { role: 'user', content: `Tribunal: ${d.courtName}. Título: ${d.title}. Argumentos: ${d.keyArguments}` },
            ],
          })) as { response?: string } | undefined;
          if (aiOut?.response?.trim()) draftedBrief = aiOut.response.trim();
        } catch {
          // Graceful deterministic fallback
        }
      }

      const meta = JSON.stringify({ matterId: d.matterId, courtName: d.courtName });
      await c.env.DB.prepare(
        `INSERT INTO doc_collaborative_pages
          (id, tenant_id, org_id, folder_id, title, content_html, custom_fields, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'legal_brief', ?4, ?5, ?6, ?7, ?7)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.title.trim(), draftedBrief, meta, nowSec).run();

      return c.json({ ok: true, id, draftedBrief }, 201);
    })
    .post('/legal/citations-and-ethics', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.write');
      const parsed = CitationOrEthicsSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid citation/ethics payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      const meta = JSON.stringify({
        jurisdiction: d.jurisdiction,
        statusTag: d.statusTag,
        cleCompletedHours: d.cleCompletedHours,
        cleRequiredHours: d.cleRequiredHours,
        expiresAtIso: d.expiresAtIso ?? null,
      });
      await c.env.DB.prepare(
        `INSERT INTO doc_collaborative_pages
          (id, tenant_id, org_id, folder_id, title, content_html, custom_fields, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?7, ?7)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.recordKind, d.title.trim(), meta, nowSec).run();
      return c.json({ ok: true, id, ...d }, 201);
    });
}
