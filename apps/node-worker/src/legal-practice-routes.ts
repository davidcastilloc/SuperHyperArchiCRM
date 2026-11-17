import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const TimeEntrySchema = z.object({
  matterId: z.string().min(1),
  durationMinutes: z.number().int().positive(),
  hourlyRateMinor: z.number().int().nonnegative(),
  description: z.string().min(1).max(300),
  isBillable: z.boolean().default(true),
});

const ContractReviewSchema = z.object({
  opposingPartyName: z.string().max(160).default(''),
  contractText: z.string().min(1).max(8000),
});

const MatterSchema = z.object({
  referenceNumber: z.string().min(1).max(64),
  clientPartyId: z.string().min(1),
  practiceArea: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
});

/** Mounts Legal Practice Suite: Matters, Court Dockets, Billable Time Entries, IOLTA Ledgers & AI Contract/Conflict Review. */
export function createLegalPracticeRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/legal/overview', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.read');
      const [mattersRes, docketsRes, timeRes, trustRes] = await c.env.DB.batch([
        c.env.DB.prepare(
          `SELECT id, reference_number, client_party_id, practice_area, title, status, opened_at
           FROM leg_matters WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, matter_id, case_number, case_title, court_name, filing_status, created_at
           FROM leg_dockets_and_events WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, matter_id, staff_id, duration_minutes, hourly_rate_minor, amount_minor, description, status, entry_date
           FROM leg_time_entries WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY entry_date DESC LIMIT 50`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, party_id, matter_or_lease_id, currency, balance_minor, status, updated_at
           FROM fin_trust_escrow_ledgers WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
      ]);
      return c.json({
        matters: mattersRes?.results ?? [],
        dockets: docketsRes?.results ?? [],
        timeEntries: timeRes?.results ?? [],
        trustLedgers: trustRes?.results ?? [],
      });
    })
    .post('/legal/matters', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.write');
      const parsed = MatterSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid matter input', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO leg_matters
          (id, tenant_id, org_id, reference_number, client_party_id, lead_lawyer_staff_id, practice_area, title, opened_at, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'OPEN', ?9, ?9)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.referenceNumber.trim(), d.clientPartyId, auth.actor.id || 'usr_attorney', d.practiceArea, d.title.trim(), nowSec).run();
      return c.json({ ok: true, id, ...d }, 201);
    })
    .post('/legal/time-entries', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.write');
      const parsed = TimeEntrySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid time entry', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      const amountMinor = Math.round((d.durationMinutes * d.hourlyRateMinor) / 60);
      await c.env.DB.prepare(
        `INSERT INTO leg_time_entries
          (id, tenant_id, org_id, matter_id, staff_id, entry_date, duration_minutes, hourly_rate_minor, amount_minor, is_billable, description, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'APPROVED', ?6, ?6)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.matterId, auth.actor.id || 'usr_attorney', nowSec, d.durationMinutes, d.hourlyRateMinor, amountMinor, d.isBillable ? 1 : 0, d.description.trim()).run();
      return c.json({ ok: true, id, amountMinor }, 201);
    })
    .post('/legal/ai-contract-review', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'cases', 'cases.records.read');
      const parsed = ContractReviewSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid contract review payload', parsed.error.flatten());
      const { opposingPartyName, contractText } = parsed.data;

      const conflictsRes = opposingPartyName.trim()
        ? await c.env.DB.prepare(
            `SELECT id, legal_name, party_kind FROM crm_parties
             WHERE tenant_id = ?1 AND LOWER(legal_name) LIKE ?2 AND deleted_at IS NULL LIMIT 10`,
          ).bind(auth.actor.tenantId, `%${opposingPartyName.trim().toLowerCase()}%`).all()
        : { results: [] };

      const lower = contractText.toLowerCase();
      const flaggedClauses: string[] = [];
      if (lower.includes('penalidad') || lower.includes('penalty')) flaggedClauses.push('Penalidad contractual elevada detectada');
      if (lower.includes('unilateral')) flaggedClauses.push('Cláusula de terminación o modificación unilateral');
      if (lower.includes('renuncia') || lower.includes('waiver')) flaggedClauses.push('Renuncia de derechos o jurisdicción');
      if (flaggedClauses.length === 0) flaggedClauses.push('Sin cláusulas críticas de riesgo inmediato detectadas');

      const riskScore = Math.min(100, flaggedClauses.length * 25 + ((conflictsRes.results?.length ?? 0) > 0 ? 25 : 0));
      let summary = `Análisis legal: ${flaggedClauses.length} observación(es), riesgo ${riskScore}/100.`;

      if (c.env.AI) {
        try {
          const aiOut = (await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [
              { role: 'system', content: 'Eres un abogado corporativo senior. Resume riesgos contractuales en máximo 3 líneas en español.' },
              { role: 'user', content: contractText.slice(0, 3000) },
            ],
          })) as { response?: string } | undefined;
          if (aiOut?.response?.trim()) summary = aiOut.response.trim();
        } catch {
          // Graceful deterministic fallback
        }
      }

      return c.json({
        ok: true,
        riskScore,
        flaggedClauses,
        conflictsFound: conflictsRes.results ?? [],
        summary,
      });
    });
}
