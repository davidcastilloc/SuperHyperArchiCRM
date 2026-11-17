import { AppError } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from './command-registry.js';

const PublicFormSubmitSchema = z.object({
  tenantId: z.string().min(1).default('ten_1'),
  answers: z.record(z.unknown()),
});

const PublicQuoteDecisionSchema = z.object({
  tenantId: z.string().min(1).default('ten_1'),
  decision: z.enum(['ACCEPTED', 'REJECTED']),
  acceptedByName: z.string().min(1).max(120),
  acceptedByEmail: z.string().email().optional(),
  comment: z.string().max(400).optional(),
});

/** Mounts unauthenticated public routes for external forms (/api/public/forms/:slug) and quotes (/api/public/quotes/:orderNumber). */
export function createPublicPortalRoutes() {
  return new Hono<HonoEnv>()
    .get('/public/forms/:slug', async (c) => {
      const slug = c.req.param('slug').trim();
      const tenantId = c.req.query('tenantId') ?? 'ten_1';
      const row = await c.env.DB.prepare(
        `SELECT id, form_slug, schema_json, status, created_at
         FROM doc_forms_and_submissions
         WHERE tenant_id = ?1 AND form_slug = ?2 AND record_kind = 'form_definition' AND status = 'ACTIVE' AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(tenantId, slug)
        .first<{ id: string; form_slug: string; schema_json: string; status: string; created_at: number }>();

      if (!row) {
        throw new AppError('NOT_FOUND', 404, `Public form '${slug}' not found`);
      }

      let schema: unknown = {};
      try {
        schema = JSON.parse(row.schema_json || '{}');
      } catch {
        schema = {};
      }
      return c.json({
        id: row.id,
        tenantId,
        formSlug: row.form_slug,
        status: row.status,
        schema,
        createdAt: row.created_at,
      });
    })
    .post('/public/forms/:slug', async (c) => {
      const slug = c.req.param('slug').trim();
      const parsed = PublicFormSubmitSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid form submission', parsed.error.flatten());
      }
      const { tenantId, answers } = parsed.data;
      const def = await c.env.DB.prepare(
        `SELECT id, org_id FROM doc_forms_and_submissions
         WHERE tenant_id = ?1 AND form_slug = ?2 AND record_kind = 'form_definition' AND status = 'ACTIVE' AND deleted_at IS NULL
         LIMIT 1`,
      )
        .bind(tenantId, slug)
        .first<{ id: string; org_id: string }>();

      if (!def) {
        throw new AppError('NOT_FOUND', 404, `Public form '${slug}' not found`);
      }

      const submissionId = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO doc_forms_and_submissions
          (id, tenant_id, org_id, record_kind, form_slug, schema_json, answers_encrypted_json, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'form_submission', ?4, '{}', ?5, 'SUBMITTED', ?6, ?6)`,
      )
        .bind(submissionId, tenantId, def.org_id, slug, JSON.stringify(answers), nowSec)
        .run();

      return c.json({ ok: true, submissionId, formSlug: slug, status: 'SUBMITTED' }, 201);
    })
    .get('/public/quotes/:orderNumber', async (c) => {
      const orderNumber = c.req.param('orderNumber').trim();
      const tenantId = c.req.query('tenantId') ?? 'ten_1';
      const quote = await c.env.DB.prepare(
        `SELECT id, order_number, currency, grand_total_minor, status, custom_fields, created_at
         FROM com_orders
         WHERE tenant_id = ?1 AND order_number = ?2 AND order_kind = 'quote' AND deleted_at IS NULL
         LIMIT 1`,
      )
        .bind(tenantId, orderNumber)
        .first<{
          id: string;
          order_number: string;
          currency: string;
          grand_total_minor: number;
          status: string;
          custom_fields: string;
          created_at: number;
        }>();

      if (!quote) {
        throw new AppError('NOT_FOUND', 404, `Quote '${orderNumber}' not found`);
      }

      return c.json({
        id: quote.id,
        tenantId,
        orderNumber: quote.order_number,
        currency: quote.currency,
        grandTotalMinor: quote.grand_total_minor,
        status: quote.status,
        createdAt: quote.created_at,
      });
    })
    .post('/public/quotes/:orderNumber/decision', async (c) => {
      const orderNumber = c.req.param('orderNumber').trim();
      const parsed = PublicQuoteDecisionSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid quote decision', parsed.error.flatten());
      }
      const { tenantId, decision, acceptedByName, acceptedByEmail, comment } = parsed.data;
      const existing = await c.env.DB.prepare(
        `SELECT id, custom_fields FROM com_orders
         WHERE tenant_id = ?1 AND order_number = ?2 AND order_kind = 'quote' AND deleted_at IS NULL LIMIT 1`,
      )
        .bind(tenantId, orderNumber)
        .first<{ id: string; custom_fields: string }>();

      if (!existing) {
        throw new AppError('NOT_FOUND', 404, `Quote '${orderNumber}' not found`);
      }

      const nextStatus = decision === 'ACCEPTED' ? 'fulfilled' : 'cancelled';
      const nowSec = Math.floor(Date.now() / 1000);
      const prevMeta = JSON.parse(existing.custom_fields || '{}') as Record<string, unknown>;
      const nextMeta = JSON.stringify({
        ...prevMeta,
        publicDecision: {
          decision,
          acceptedByName,
          acceptedByEmail: acceptedByEmail ?? null,
          comment: comment ?? null,
          decidedAt: nowSec,
        },
      });

      await c.env.DB.prepare(
        `UPDATE com_orders SET status = ?1, custom_fields = ?2, updated_at = ?3 WHERE id = ?4 AND tenant_id = ?5`,
      )
        .bind(nextStatus, nextMeta, nowSec, existing.id, tenantId)
        .run();

      return c.json({ ok: true, orderNumber, decision, status: nextStatus }, 200);
    });
}
