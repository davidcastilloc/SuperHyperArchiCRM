import {
  createD1Client,
  wrapD1WithCounter,
  type CountedD1,
  type ShacD1Database,
} from '@shac/db-d1';
import type { ActorType, ExecutionContext, TenantMarketProfile } from '@shac/kernel';
import migration0001Sql from '../../../db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import migration0004Sql from '../../../db-d1/migrations/0004_phase6_spaces_leases.sql?raw';
import migration0005Sql from '../../../db-d1/migrations/0005_phase7_services_cases_finance_portal.sql?raw';

const baseTestProfile: TenantMarketProfile = {
  deploymentId: 'dep_p7_auto_test',
  tenantId: 'ten_1',
  editionPreset: 'omni-enterprise',
  regionPack: 've',
  activeModules: ['iam', 'automation'],
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
    nodeDid: 'did:shac:auto-test',
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

export async function setupAutomationD1(d1: D1Database): Promise<void> {
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
      `INSERT OR IGNORE INTO auto_business_rules (id, tenant_id, org_id, rule_code, name, rule_kind, entity_type, lifecycle_event, priority, condition_ast_json, actions_json, is_enabled, created_at, updated_at)
       VALUES ('rule_1', 'ten_1', 'org_1_north', 'HIGH_VALUE_RMA', 'Flag High Value RMA', 'ACTION', 'rma_claim', 'on_create', 10, '{"all":[{"field":"amountMinor","op":"gte","value":50000},{"field":"tier","op":"eq","value":"VIP"}]}', '[{"type":"create_proposal","target":"finance.credit"}]', 1, ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO auto_business_rules (id, tenant_id, org_id, rule_code, name, rule_kind, entity_type, lifecycle_event, priority, condition_ast_json, actions_json, is_enabled, created_at, updated_at)
       VALUES ('rule_disabled', 'ten_1', 'org_1_north', 'DISABLED_RULE', 'Disabled Rule', 'ACTION', 'rma_claim', 'on_create', 5, '{}', '[{"type":"noop"}]', 0, ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO kernel_ai_proposals (id, tenant_id, org_id, owner_user_id, agent_id, model_id, target_command_id, target_record_id, proposed_diff_json, confidence_bps, disposition, created_at, updated_at)
       VALUES ('prop_approve', 'ten_1', 'org_1_north', 'usr_ten_1', 'inbox_ops', 'gemini-2.5', 'services.rma.claim', 'rma_1', '{"status":"APPROVED"}', 9400, 'PENDING', ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO kernel_ai_proposals (id, tenant_id, org_id, owner_user_id, agent_id, model_id, target_command_id, target_record_id, proposed_diff_json, confidence_bps, disposition, created_at, updated_at)
       VALUES ('prop_reject', 'ten_1', 'org_1_north', 'usr_ten_1', 'inbox_ops', 'gemini-2.5', 'services.rma.claim', 'rma_2', '{"status":"APPROVED"}', 6200, 'PENDING', ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO kernel_ai_proposals (id, tenant_id, org_id, owner_user_id, agent_id, model_id, target_command_id, target_record_id, proposed_diff_json, confidence_bps, disposition, created_at, updated_at)
       VALUES ('prop_south', 'ten_1', 'org_1_south', 'usr_ten_1', 'inbox_ops', 'gemini-2.5', 'services.rma.claim', 'rma_south', '{"status":"APPROVED"}', 9000, 'PENDING', ?, ?)`,
    ).bind(now, now),
    d1.prepare(
      `INSERT OR IGNORE INTO kernel_ai_proposals (id, tenant_id, org_id, owner_user_id, agent_id, model_id, target_command_id, target_record_id, proposed_diff_json, confidence_bps, disposition, created_at, updated_at)
       VALUES ('prop_ten2', 'ten_2', 'org_2', 'usr_ten_2', 'inbox_ops', 'gemini-2.5', 'services.rma.claim', 'rma_3', '{"status":"APPROVED"}', 9000, 'PENDING', ?, ?)`,
    ).bind(now, now),
  ]);
}

export function makeAutomationCtx(
  rawD1: D1Database,
  overrides?: {
    tenantId?: string;
    orgId?: string;
    orgPath?: string;
    actorType?: ActorType;
  },
): {
  ctx: ExecutionContext<ShacD1Database>;
  counted: CountedD1;
} {
  const counted = wrapD1WithCounter(rawD1);
  const tenantId = overrides?.tenantId ?? 'ten_1';
  const orgId = overrides?.orgId ?? 'org_1_north';
  const orgPath = overrides?.orgPath ?? '/org_1/north';
  const actorType = overrides?.actorType ?? 'staff';

  const ctx: ExecutionContext<ShacD1Database> = {
    tenantId,
    orgId,
    orgPath,
    actor: {
      id: `usr_${tenantId}`,
      type: actorType,
      perms: ['automation.*'],
    },
    profile: { ...baseTestProfile, tenantId },
    db: createD1Client(counted.db),
  };

  return { ctx, counted };
}
