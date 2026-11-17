import {
  ALLOWED_VIRTUAL_COLUMN_TABLES,
  buildVirtualColumnSql,
  type VirtualColumnTable,
} from '@shac/db-d1';
import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const CreateCustomFieldSchema = z.object({
  entityType: z.enum(ALLOWED_VIRTUAL_COLUMN_TABLES),
  fieldKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  label: z.string().min(1).max(120),
  dataType: z.enum(['text', 'number', 'boolean', 'date', 'select']).default('text'),
  isRequired: z.boolean().default(false),
  isIndexed: z.boolean().default(false),
});

interface CustomFieldRow {
  id: string;
  entity_type: string;
  field_key: string;
  label: string;
  data_type: string;
  is_required: number;
  is_indexed: number;
  virtual_column_name: string | null;
  created_at: number;
}

/** Mounts GET/POST /api/system/custom-fields backed by kernel_custom_field_defs (v_cf_*). */
export function createCustomFieldsRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/custom-fields', async (c) => {
      const auth = await authenticateWorkerActor(
        c.env,
        c.req.raw.headers,
        profileLoader,
        'core',
        'iam.orgs.read',
      );
      const entityType = c.req.query('entityType');
      const stmt = entityType
        ? c.env.DB.prepare(
            `SELECT id, entity_type, field_key, label, data_type, is_required, is_indexed, virtual_column_name, created_at
             FROM kernel_custom_field_defs
             WHERE tenant_id = ?1 AND entity_type = ?2 AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 100`,
          ).bind(auth.actor.tenantId, entityType)
        : c.env.DB.prepare(
            `SELECT id, entity_type, field_key, label, data_type, is_required, is_indexed, virtual_column_name, created_at
             FROM kernel_custom_field_defs
             WHERE tenant_id = ?1 AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 100`,
          ).bind(auth.actor.tenantId);

      const res = await stmt.all<CustomFieldRow>();
      const items = (res.results ?? []).map((r) => {
        const ddl = r.is_indexed
          ? buildVirtualColumnSql({
              tableName: r.entity_type as VirtualColumnTable,
              fieldKey: r.field_key,
            })
          : null;
        return {
          id: r.id,
          entityType: r.entity_type,
          fieldKey: r.field_key,
          label: r.label,
          dataType: r.data_type,
          isRequired: Boolean(r.is_required),
          isIndexed: Boolean(r.is_indexed),
          virtualColumnName: r.virtual_column_name,
          alterSql: ddl?.alterSql ?? null,
          indexSql: ddl?.indexSql ?? null,
          createdAt: r.created_at,
        };
      });
      return c.json({ items }, 200);
    })
    .post('/custom-fields', async (c) => {
      const auth = await authenticateWorkerActor(
        c.env,
        c.req.raw.headers,
        profileLoader,
        'core',
        'iam.orgs.write',
      );
      const raw = await c.req.json().catch(() => null);
      const parsed = CreateCustomFieldSchema.safeParse(raw);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', 400, 'Invalid custom field definition', parsed.error.flatten());
      }
      const data = parsed.data;
      const ddl = data.isIndexed
        ? buildVirtualColumnSql({ tableName: data.entityType, fieldKey: data.fieldKey })
        : null;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);

      await c.env.DB.prepare(
        `INSERT INTO kernel_custom_field_defs
          (id, tenant_id, entity_type, fieldset_code, field_key, label, data_type, is_required, is_encrypted, is_indexed, virtual_column_name, validation_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'default', ?4, ?5, ?6, ?7, 0, ?8, ?9, '{}', ?10, ?10)
         ON CONFLICT(tenant_id, entity_type, field_key) DO UPDATE SET
           label = excluded.label,
           data_type = excluded.data_type,
           is_required = excluded.is_required,
           is_indexed = excluded.is_indexed,
           virtual_column_name = excluded.virtual_column_name,
           updated_at = excluded.updated_at`,
      )
        .bind(
          id,
          auth.actor.tenantId,
          data.entityType,
          data.fieldKey,
          data.label,
          data.dataType,
          data.isRequired ? 1 : 0,
          data.isIndexed ? 1 : 0,
          ddl?.columnName ?? null,
          nowSec,
        )
        .run();

      let indexExecuted = false;
      if (ddl) {
        const info = await c.env.DB.prepare(`PRAGMA table_xinfo(${data.entityType})`).all<{ name: string }>();
        const hasCol = (info.results ?? []).some((col) => col.name === ddl.columnName);
        if (!hasCol) {
          await c.env.DB.prepare(ddl.alterSql).run();
        }
        await c.env.DB.prepare(ddl.indexSql).run();
        indexExecuted = true;
      }

      return c.json(
        {
          id,
          entityType: data.entityType,
          fieldKey: data.fieldKey,
          label: data.label,
          dataType: data.dataType,
          isRequired: data.isRequired,
          isIndexed: data.isIndexed,
          virtualColumnName: ddl?.columnName ?? null,
          alterSql: ddl?.alterSql ?? null,
          indexSql: ddl?.indexSql ?? null,
          indexExecuted,
        },
        201,
      );
    });
}
