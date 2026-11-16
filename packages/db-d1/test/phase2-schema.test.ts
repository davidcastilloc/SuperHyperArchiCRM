import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import migration0001Sql from '../migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../migrations/0002_phase2_universal_trunk.sql?raw';
import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  buildVirtualColumnSql,
  catCurrenciesAndRates,
  catProducts,
  checkIdempotency,
  createD1Client,
  crmParties,
  crmPartyProfiles,
  iamOrganizations,
  iamTenants,
  kernelCustomRecords,
} from '../src/index.js';

async function applySqlScript(db: D1Database, sqlText: string): Promise<void> {
  const statements = sqlText
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
}

describe('@shac/db-d1 Phase 2 workerd schema, v_cf_* & FTS5', () => {
  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
  });

  it('creates all 25 Phase 2 tables plus kernel_custom_records_fts', async () => {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type IN ('table', 'shadow') OR name = 'kernel_custom_records_fts'`,
    ).all<{ name: string }>();
    const names = new Set(result.results.map((r) => r.name));

    const expectedTables = [
      'kernel_custom_field_defs',
      'kernel_custom_records',
      'kernel_custom_records_fts',
      'kernel_record_locks',
      'crm_parties',
      'crm_party_profiles',
      'crm_party_links',
      'crm_party_addresses',
      'crm_groups_and_terms',
      'crm_group_memberships',
      'crm_pipelines_and_stages',
      'crm_deals',
      'crm_interactions_and_tasks',
      'crm_conflict_checks',
      'hr_staff_profiles_and_credentials',
      'hr_shifts_timesheets_and_payroll',
      'cat_categories_and_dictionaries',
      'cat_products',
      'cat_variants_and_presentations',
      'cat_price_lists',
      'cat_price_rules',
      'cat_price_history_omnibus',
      'cat_promotions_and_coupons',
      'cat_coupon_usages_and_locks',
      'cat_currencies_and_rates',
      'cat_label_print_batches',
    ];

    for (const tbl of expectedTables) {
      expect(names.has(tbl), `missing table ${tbl}`).toBe(true);
    }
  });

  it('supports Phase 1+2 Drizzle client queries and shared idempotency helpers', async () => {
    const db = createD1Client(env.DB);
    const now = 1763300000;

    await db.batch([
      db.insert(iamTenants).values({
        id: 'ten_p2',
        slug: 'ten-p2',
        name: 'Phase 2 Tenant',
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(iamOrganizations).values({
        id: 'org_p2',
        tenantId: 'ten_p2',
        rootId: 'org_p2',
        treePath: '/org_p2',
        slug: 'hq',
        name: 'HQ Branch',
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(crmParties).values({
        id: 'pty_maria',
        tenantId: 'ten_p2',
        orgId: 'org_p2',
        partyKind: 'person',
        rolesMaskJson: JSON.stringify(['customer', 'patient']),
        displayName: 'María Gómez',
        taxIdType: 'CEDULA',
        taxIdNumber: 'V-18444555',
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(crmPartyProfiles).values({
        partyId: 'pty_maria',
        tenantId: 'ten_p2',
        mrnCode: 'MRN-001',
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(catCurrenciesAndRates).values({
        id: 'rate_bcv_1',
        tenantId: 'ten_p2',
        orgId: 'org_p2',
        fromCurrency: 'USD',
        toCurrency: 'VES',
        rateMicros: 45_500_000,
        source: 'BCV',
        effectiveAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const partyRows = await db
      .select()
      .from(crmParties)
      .where(and(eq(crmParties.tenantId, 'ten_p2'), eq(crmParties.id, 'pty_maria')));
    expect(partyRows[0]?.displayName).toBe('María Gómez');

    const receiptSchema = z.object({ ok: z.boolean(), partyId: z.string() });
    const receipt = { ok: true, partyId: 'pty_maria' };
    await db.batch([
      buildIdempotencyInsert(db, {
        tenantId: 'ten_p2',
        orgId: 'org_p2',
        clientMutationId: 'mut_p2_1',
        commandId: 'customers.parties.upsert',
        requestHash: 'hash_abc',
        responseJson: JSON.stringify(receipt),
        nowSec: now,
      }),
      buildActionLogInsert(db, {
        tenantId: 'ten_p2',
        orgId: 'org_p2',
        actor: { id: 'usr_1', type: 'staff', perms: ['*'] },
        commandId: 'customers.parties.upsert',
        resourceKind: 'crm_party',
        resourceId: 'pty_maria',
        targetPartyId: 'pty_maria',
        snapshotAfterJson: JSON.stringify(receipt),
        nowSec: now,
      }),
    ]);

    const replay = await checkIdempotency(
      db,
      'ten_p2',
      'mut_p2_1',
      'hash_abc',
      receiptSchema,
    );
    expect(replay).toEqual(receipt);

    await expect(
      checkIdempotency(db, 'ten_p2', 'mut_p2_1', 'hash_different', receiptSchema),
    ).rejects.toThrow(/already used with a different payload/);
  });

  it('validates and executes buildVirtualColumnSql for v_cf_registro_sanitario with indexed lookup', async () => {
    expect(() =>
      buildVirtualColumnSql({
        tableName: 'crm_deals' as never,
        fieldKey: 'registro_sanitario',
      }),
    ).toThrow(/Invalid virtual column tableName/);

    expect(() =>
      buildVirtualColumnSql({
        tableName: 'cat_products',
        fieldKey: 'Bad-Key; DROP TABLE cat_products',
      }),
    ).toThrow(/Invalid fieldKey/);

    const { columnName, alterSql, indexSql } = buildVirtualColumnSql({
      tableName: 'cat_products',
      fieldKey: 'registro_sanitario',
    });
    expect(columnName).toBe('v_cf_registro_sanitario');

    await env.DB.prepare(alterSql.replace(/;$/, '')).run();
    await env.DB.prepare(indexSql.replace(/;$/, '')).run();

    const db = createD1Client(env.DB);
    const now = 1763300100;
    await db.insert(catProducts).values({
      id: 'prod_amox',
      tenantId: 'ten_p2',
      orgId: 'org_p2',
      sku: 'AMOX-500',
      name: 'Amoxicilina 500mg',
      basePriceMinor: 850,
      costPriceMinor: 420,
      customFields: JSON.stringify({ registro_sanitario: 'MPPS-EF-2026-991' }),
      createdAt: now,
      updatedAt: now,
    });

    const found = await env.DB.prepare(
      `SELECT id, sku, v_cf_registro_sanitario FROM cat_products
       WHERE tenant_id = ? AND v_cf_registro_sanitario = ?`,
    )
      .bind('ten_p2', 'MPPS-EF-2026-991')
      .first<{ id: string; sku: string; v_cf_registro_sanitario: string }>();

    expect(found).toEqual({
      id: 'prod_amox',
      sku: 'AMOX-500',
      v_cf_registro_sanitario: 'MPPS-EF-2026-991',
    });

    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM cat_products
       WHERE tenant_id = ? AND v_cf_registro_sanitario = ?`,
    )
      .bind('ten_p2', 'MPPS-EF-2026-991')
      .all<{ detail: string }>();
    const planText = plan.results.map((r) => r.detail).join(' ');
    expect(planText).toContain('idx_cat_products_v_cf_registro_sanitario');
  });

  it('supports FTS5 MATCH queries on kernel_custom_records_fts', async () => {
    const db = createD1Client(env.DB);
    const now = 1763300200;

    await db.insert(kernelCustomRecords).values({
      id: 'crec_1',
      tenantId: 'ten_p2',
      orgId: 'org_p2',
      entitySlug: 'clinical_protocol',
      code: 'PROT-01',
      title: 'Protocolo Amoxicilina Pediátrica',
      dataJson: JSON.stringify({ dosis: '50mg/kg/day' }),
      createdAt: now,
      updatedAt: now,
    });

    await env.DB.prepare(
      `INSERT INTO kernel_custom_records_fts (tenant_id, org_id, record_id, entity_slug, code, title, search_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'ten_p2',
        'org_p2',
        'crec_1',
        'clinical_protocol',
        'PROT-01',
        'Protocolo Amoxicilina Pediátrica',
        'amoxicilina pediatrica antibiotico 50mg',
      )
      .run();

    const hits = await env.DB.prepare(
      `SELECT record_id, code, title FROM kernel_custom_records_fts
       WHERE kernel_custom_records_fts MATCH ? AND tenant_id = ?`,
    )
      .bind('amoxicilina', 'ten_p2')
      .all<{ record_id: string; code: string; title: string }>();

    expect(hits.results).toHaveLength(1);
    expect(hits.results[0]?.record_id).toBe('crec_1');
  });
});
