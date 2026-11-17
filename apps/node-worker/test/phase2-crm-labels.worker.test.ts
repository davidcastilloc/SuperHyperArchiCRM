import { env } from 'cloudflare:test';
import { wrapD1WithCounter } from '@shac/db-d1';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import {
  invalidateProfileCache,
  workerApp,
  type WorkerEnv,
} from '../src/router.js';
import { callWorkerJson, createTenantTokens } from './phase2-helpers.js';
import {
  applySqlScript,
  makeProfile,
  seedTenantsAndOrgs,
} from './test-helpers.js';

describe('@shac/node-worker Phase 2 CRM links, deals, conflicts & labels', () => {
  let publicKeyJwkJson: string;
  let tokenTen1: string;

  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await seedTenantsAndOrgs(env.DB);
    const created = await createTenantTokens();
    publicKeyJwkJson = JSON.stringify(created.keys.publicKeyJwk);
    tokenTen1 = created.tokenTen1;
  });

  beforeEach(() => {
    invalidateProfileCache();
  });

  it('handles party links, deals, conflict-checks, and dual-currency label batches', async () => {
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam', 'customers', 'catalog', 'wms'])),
    );
    const counted = wrapD1WithCounter(env.DB);
    const testEnv: WorkerEnv = {
      ...env,
      DB: counted.db,
      JWT_PUBLIC_KEY_JWK: publicKeyJwkJson,
    };

    const contact = await callWorkerJson<{ id: string }>(
      workerApp,
      testEnv,
      '/api/customers/parties',
      tokenTen1,
      {
        clientMutationId: 'mut-crm-contact',
        rolesMask: ['customer', 'patient'],
        displayName: 'María Gómez',
        taxIdNumber: 'V-12345678',
      },
    );
    expect(contact.status).toBe(200);

    const supplier = await callWorkerJson<{ id: string }>(
      workerApp,
      testEnv,
      '/api/customers/parties',
      tokenTen1,
      {
        clientMutationId: 'mut-crm-supplier',
        partyKind: 'company',
        rolesMask: ['vendor'],
        displayName: 'Droguería Caracas C.A.',
      },
    );
    expect(supplier.status).toBe(200);

    const linkRes = await callWorkerJson<{ id: string }>(
      workerApp,
      testEnv,
      '/api/customers/links',
      tokenTen1,
      {
        clientMutationId: 'mut-crm-link',
        fromPartyId: supplier.data.id,
        toPartyId: contact.data.id,
        linkType: 'company_contact',
      },
    );
    expect(linkRes.status).toBe(200);

    const dealRes = await callWorkerJson<{ valueMinor: number }>(
      workerApp,
      testEnv,
      '/api/customers/deals',
      tokenTen1,
      {
        clientMutationId: 'mut-crm-deal',
        pipelineId: 'pipe_default',
        stageId: 'stage_qualified',
        partyId: contact.data.id,
        title: 'Plan Corporativo Salud',
        valueMinor: 250_000,
      },
    );
    expect(dealRes.status).toBe(200);
    expect(dealRes.data.valueMinor).toBe(250_000);

    const conflictRes = await callWorkerJson<{ riskStatus: string }>(
      workerApp,
      testEnv,
      '/api/customers/conflict-checks',
      tokenTen1,
      {
        clientMutationId: 'mut-crm-conflict',
        matterTitle: 'Revisión V-12345678',
        searchedTerms: ['María Gómez'],
      },
    );
    expect(conflictRes.status).toBe(200);
    expect(conflictRes.data.riskStatus).toBe('potential_conflict');

    await callWorkerJson(workerApp, testEnv, '/api/catalog/rates', tokenTen1, {
      clientMutationId: 'mut-crm-bcv',
      fromCurrency: 'USD',
      toCurrency: 'VES',
      rateMicros: 45_500_000,
      source: 'BCV',
    });

    await callWorkerJson(workerApp, testEnv, '/api/catalog/products', tokenTen1, {
      clientMutationId: 'mut-crm-prod',
      sku: 'AMOX-500',
      name: 'Amoxicilina 500mg',
      basePriceMinor: 2000,
      costPriceMinor: 1000,
    });

    const labelRes = await callWorkerJson<{
      rateMicrosSnapshot: number;
      items: Array<{ priceSecondaryMinor: number }>;
    }>(workerApp, testEnv, '/api/catalog/labels/batches', tokenTen1, {
      clientMutationId: 'mut-crm-label',
      items: [{ sku: 'AMOX-500', qtyCopies: 4 }],
    });
    expect(labelRes.status).toBe(200);
    expect(labelRes.data.rateMicrosSnapshot).toBe(45_500_000);
    expect(labelRes.data.items[0]?.priceSecondaryMinor).toBe(91_000);
  });

  it('executes live v_cf_* DDL idempotently on D1 when creating indexed custom fields', async () => {
    await env.CONFIG_KV.put('profile:current', JSON.stringify(makeProfile(['core', 'iam', 'customers'])));
    invalidateProfileCache();
    const testEnv: WorkerEnv = { ...env, JWT_PUBLIC_KEY_JWK: publicKeyJwkJson };

    const payload = {
      entityType: 'crm_parties',
      fieldKey: 'registro_sanitario',
      label: 'Registro Sanitario',
      dataType: 'text',
      isIndexed: true,
    };
    const res1 = await callWorkerJson<{ indexExecuted: boolean; virtualColumnName: string }>(
      workerApp,
      testEnv,
      '/api/system/custom-fields',
      tokenTen1,
      payload,
    );
    expect(res1.status).toBe(201);
    expect(res1.data.virtualColumnName).toBe('v_cf_registro_sanitario');
    expect(res1.data.indexExecuted).toBe(true);

    const checkRow = await env.DB.prepare('SELECT v_cf_registro_sanitario FROM crm_parties LIMIT 1').all();
    expect(checkRow.success).toBe(true);

    const res2 = await callWorkerJson<{ indexExecuted: boolean }>(
      workerApp,
      testEnv,
      '/api/system/custom-fields',
      tokenTen1,
      payload,
    );
    expect(res2.status).toBe(201);
  });
});
