import {
  createD1Client,
  wrapD1WithCounter,
  type CountedD1,
  type ShacD1Database,
} from '@shac/db-d1';
import type { ExecutionContext, TenantMarketProfile } from '@shac/kernel';
import migration0001Sql from '../../../db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import migration0004Sql from '../../../db-d1/migrations/0004_phase6_spaces_leases.sql?raw';
import migration0005Sql from '../../../db-d1/migrations/0005_phase7_services_cases_finance_portal.sql?raw';

const baseTestProfile: TenantMarketProfile = {
  deploymentId: 'dep_p7_portal_test',
  tenantId: 'ten_1',
  editionPreset: 'omni-enterprise',
  regionPack: 've',
  activeModules: ['iam', 'customers', 'portal'],
  vocabulary: {
    partySingular: 'Cliente',
    partyPlural: 'Clientes',
    orderSingular: 'Orden',
    branchSingular: 'Sede',
    spaceSingular: 'Espacio',
    caseSingular: 'Caso',
  },
  currency: {
    baseCurrency: 'USD',
    operatingCurrencies: ['USD', 'VES'],
    rateSource: 'bcv',
    enforceAccountCurrencyMatch: true,
  },
  entitlements: {
    maxBranches: 10,
    maxPosRegisters: 20,
    maxSpacesOrUnits: 100,
    aiCopilotEnabled: true,
    customEntitiesLimit: 25,
  },
  federation: {
    enabled: false,
    nodeDid: 'did:shac:portal-test',
    publishPublicCatalog: false,
    acceptPeerB2BOrders: false,
    consolidateLowStockHours: 24,
    allowedSupplierDids: [],
  },
  updatedAt: '2026-11-16T00:00:00.000Z',
};

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

export async function setupPortalD1(d1: D1Database): Promise<void> {
  await applySqlScript(d1, migration0001Sql);
  await applySqlScript(d1, migration0002Sql);
  await applySqlScript(d1, migration0003Sql);
  await applySqlScript(d1, migration0004Sql);
  await applySqlScript(d1, migration0005Sql);

  const now = 1763300000;
  await d1.batch([
    d1.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_1', 'ten-1', 'Tenant One', 'USD', 'es-VE', 'active', ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO iam_tenants (id, slug, name, primary_currency, default_locale, status, created_at, updated_at)
       VALUES ('ten_2', 'ten-2', 'Tenant Two', 'USD', 'es-VE', 'active', ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_1', 'ten_1', NULL, 'org_1', '/org_1', 0, 'hq-1', 'HQ One', 'company', 'UTC', 1, 1, ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_1_north', 'ten_1', 'org_1', 'org_1', '/org_1/north', 1, 'north', 'North Branch', 'branch', 'UTC', 0, 1, ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_1_south', 'ten_1', 'org_1', 'org_1', '/org_1/south', 1, 'south', 'South Branch', 'branch', 'UTC', 0, 1, ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO iam_organizations (id, tenant_id, parent_id, root_id, tree_path, depth, slug, name, org_kind, timezone, is_primary, is_active, created_at, updated_at)
       VALUES ('org_2', 'ten_2', NULL, 'org_2', '/org_2', 0, 'hq-2', 'HQ Two', 'company', 'UTC', 1, 1, ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO doc_attachments (id, tenant_id, org_id, partition_code, entity_type, record_id, party_id, file_name, mime_type, file_size_bytes, r2_object_key, sha256_hash, is_confidential, uploaded_by_user_id, created_at, updated_at)
       VALUES ('doc_pub_1', 'ten_1', 'org_1_north', 'portal_shared', 'invoice', 'inv_1', 'party_1', 'receipt.pdf', 'application/pdf', 1024, 'r2/receipt.pdf', 'hash1', 0, 'usr_1', ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO doc_attachments (id, tenant_id, org_id, partition_code, entity_type, record_id, party_id, file_name, mime_type, file_size_bytes, r2_object_key, sha256_hash, is_confidential, uploaded_by_user_id, created_at, updated_at)
       VALUES ('doc_phi_secret', 'ten_1', 'org_1_north', 'private_docs', 'med_clinical_note', 'note_1', 'party_1', 'psych_eval_phi.pdf', 'application/pdf', 2048, 'r2/phi.pdf', 'hash2', 1, 'usr_1', ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO comm_threads_and_messages (id, tenant_id, org_id, thread_kind, subject, party_id, sender_id, sender_type, body, is_confidential, sent_at, created_at, updated_at)
       VALUES ('msg_pub_1', 'ten_1', 'org_1_north', 'portal_support', 'Appointment Confirmed', 'party_1', 'usr_1', 'staff', 'Your appointment is confirmed for tomorrow.', 0, ?, ?, ?)`,
    ).bind(now, now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO comm_threads_and_messages (id, tenant_id, org_id, thread_kind, subject, party_id, sender_id, sender_type, body, is_confidential, sent_at, created_at, updated_at)
       VALUES ('msg_legal_secret', 'ten_1', 'org_1_north', 'internal_legal_memo', 'Privileged Strategy', 'party_1', 'usr_1', 'staff', 'Attorney-client privileged settlement floor.', 1, ?, ?, ?)`,
    ).bind(now, now, now),
  ]);
}

export function makePortalCtx(
  rawD1: D1Database,
  overrides?: Partial<Pick<ExecutionContext, 'tenantId' | 'orgId' | 'orgPath'>>,
): {
  ctx: ExecutionContext<ShacD1Database>;
  counted: CountedD1;
} {
  const counted = wrapD1WithCounter(rawD1);
  const tenantId = overrides?.tenantId ?? 'ten_1';
  const orgId = overrides?.orgId ?? 'org_1_north';
  const orgPath = overrides?.orgPath ?? '/org_1/north';

  const ctx: ExecutionContext<ShacD1Database> = {
    tenantId,
    orgId,
    orgPath,
    actor: {
      id: `usr_${tenantId}`,
      type: 'portal_user',
      perms: ['portal.*'],
    },
    profile: { ...baseTestProfile, tenantId },
    db: createD1Client(counted.db),
  };

  return { ctx, counted };
}
