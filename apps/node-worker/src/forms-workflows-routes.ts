import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const FormDefSchema = z.object({
  recordKind: z.enum(['form_definition', 'form_submission']).default('form_definition'),
  formSlug: z.string().regex(/^[a-z0-9_-]{2,48}$/),
  schemaJson: z.string().default('{}'),
  answersJson: z.string().default('{}'),
});

const WorkflowDefSchema = z.object({
  workflowCode: z.string().regex(/^[a-z0-9_-]{2,48}$/),
  nodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string() })).default([]),
  triggers: z.array(z.string()).default(['on_order_created']),
});

const TriggerWorkflowSchema = z.object({
  workflowId: z.string().min(1),
  correlationKey: z.string().min(1),
});

/** Mounts Forms Builder + Public Submissions and Visual Workflows + Instances routes. */
export function createFormsWorkflowsRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/portal/forms', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'portal', 'portal.records.read');
      const res = await c.env.DB.prepare(
        `SELECT id, record_kind, form_slug, schema_json, answers_encrypted_json, status, created_at
         FROM doc_forms_and_submissions WHERE tenant_id = ?1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 100`,
      ).bind(auth.actor.tenantId).all<{
        id: string; record_kind: string; form_slug: string; schema_json: string;
        answers_encrypted_json: string; status: string; created_at: number;
      }>();
      return c.json({
        items: (res.results ?? []).map((f) => ({
          id: f.id,
          recordKind: f.record_kind,
          formSlug: f.form_slug,
          schemaJson: f.schema_json,
          answersJson: f.answers_encrypted_json,
          status: f.status,
          createdAt: f.created_at,
        })),
      });
    })
    .post('/portal/forms', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'portal', 'portal.records.read');
      const parsed = FormDefSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid form payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO doc_forms_and_submissions
          (id, tenant_id, org_id, record_kind, form_slug, schema_json, answers_encrypted_json, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ACTIVE', ?8, ?8)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.recordKind, d.formSlug, d.schemaJson, d.answersJson, nowSec).run();
      return c.json({ id, ...d }, 201);
    })
    .get('/automation/workflows', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'automation', 'automation.rules.evaluate');
      const defsRes = await c.env.DB.prepare(
        `SELECT id, workflow_code, version_no, definition_graph_json, event_triggers_json, is_enabled, created_at
         FROM auto_workflows WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`,
      ).bind(auth.actor.tenantId).all<{
        id: string; workflow_code: string; version_no: number; definition_graph_json: string;
        event_triggers_json: string; is_enabled: number; created_at: number;
      }>();
      const instRes = await c.env.DB.prepare(
        `SELECT id, workflow_id, correlation_key, current_step_id, status, created_at
         FROM auto_workflow_instances_and_tasks WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`,
      ).bind(auth.actor.tenantId).all<{
        id: string; workflow_id: string; correlation_key: string; current_step_id: string; status: string; created_at: number;
      }>();
      return c.json({
        definitions: (defsRes.results ?? []).map((w) => ({
          id: w.id,
          workflowCode: w.workflow_code,
          versionNo: w.version_no,
          definitionGraphJson: w.definition_graph_json,
          eventTriggersJson: w.event_triggers_json,
          isEnabled: Boolean(w.is_enabled),
          createdAt: w.created_at,
        })),
        instances: (instRes.results ?? []).map((i) => ({
          id: i.id,
          workflowId: i.workflow_id,
          correlationKey: i.correlation_key,
          currentStepId: i.current_step_id,
          status: i.status,
          createdAt: i.created_at,
        })),
      });
    })
    .post('/automation/workflows', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'automation', 'automation.rules.evaluate');
      const parsed = WorkflowDefSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid workflow payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO auto_workflows (id, tenant_id, org_id, workflow_code, version_no, definition_graph_json, event_triggers_json, is_enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, 1, ?7, ?7)
         ON CONFLICT(tenant_id, workflow_code, version_no) DO UPDATE SET
           definition_graph_json = excluded.definition_graph_json, event_triggers_json = excluded.event_triggers_json, updated_at = excluded.updated_at`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.workflowCode, JSON.stringify({ nodes: d.nodes }), JSON.stringify(d.triggers), nowSec).run();
      return c.json({ id, ...d }, 201);
    })
    .post('/automation/workflows/run', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'automation', 'automation.rules.evaluate');
      const parsed = TriggerWorkflowSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid run payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO auto_workflow_instances_and_tasks (id, tenant_id, org_id, workflow_id, correlation_key, current_step_id, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'step_1_completed', 'completed', ?6, ?6)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.workflowId, d.correlationKey, nowSec).run();
      return c.json({ id, workflowId: d.workflowId, status: 'completed' }, 201);
    });
}
