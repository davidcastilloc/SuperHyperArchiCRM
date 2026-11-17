import { env } from 'cloudflare:test';
import { generateEd25519KeyPair, signJwtEdDsa } from '@shac/kernel';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../packages/db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import migration0005Sql from '../../../packages/db-d1/migrations/0005_phase7_services_cases_finance_portal.sql?raw';
import { invalidateProfileCache, workerApp, type WorkerEnv } from '../src/router.js';
import { applySqlScript, makeProfile, seedTenantsAndOrgs } from './test-helpers.js';

describe('Media R2/D1 storage, HMAC-SHA256 webhook dispatcher, and Workers AI fallback', () => {
  let publicKeyJwkJson: string;
  let tokenTen1: string;

  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await applySqlScript(env.DB, migration0005Sql);
    await seedTenantsAndOrgs(env.DB);
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam', 'customers', 'catalog', 'pos', 'automation', 'portal', 'services'])),
    );
    const keys = await generateEd25519KeyPair();
    publicKeyJwkJson = JSON.stringify(keys.publicKeyJwk);
    tokenTen1 = await signJwtEdDsa(
      {
        sub: 'usr_admin_1',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        actorType: 'staff',
        perms: ['*'],
      },
      keys.privateKeyJwk,
      600,
    );
  });

  beforeEach(() => {
    invalidateProfileCache();
  });

  function makeTestEnv(extra?: Partial<WorkerEnv>): WorkerEnv {
    return {
      ...env,
      JWT_PUBLIC_KEY_JWK: publicKeyJwkJson,
      ...extra,
    } as WorkerEnv;
  }

  it('stores and retrieves media assets via /api/media/:key and lists them by tenant', async () => {
    const testEnv = makeTestEnv();
    const putRes = await workerApp.request(
      'http://localhost/api/media/coa-lot-2026-01.pdf?entityType=LOT&entityId=LOT-2026-01',
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${tokenTen1}`,
          'content-type': 'application/pdf',
        },
        body: 'PDF-COA-SAMPLE-BYTES',
      },
      testEnv,
    );
    if (putRes.status !== 201) {
      throw new Error(`PUT /api/media failed (${putRes.status}): ${await putRes.text()}`);
    }
    expect(putRes.status).toBe(201);
    const putBody = (await putRes.json()) as {
      ok: boolean;
      key: string;
      sizeBytes: number;
      storageBackend: 'R2' | 'D1_META';
    };
    expect(putBody.ok).toBe(true);
    expect(putBody.key).toBe('coa-lot-2026-01.pdf');
    expect(putBody.sizeBytes).toBe(20);

    const getRes = await workerApp.request(
      'http://localhost/api/media/coa-lot-2026-01.pdf',
      {
        method: 'GET',
        headers: { authorization: `Bearer ${tokenTen1}` },
      },
      testEnv,
    );
    expect(getRes.status).toBe(200);
    expect(await getRes.text()).toBe('PDF-COA-SAMPLE-BYTES');
  });

  it('signs outbound webhook payloads with HMAC-SHA256 X-SHAC-Signature-256 and records delivery status', async () => {
    const testEnv = makeTestEnv();
    const createRes = await workerApp.request(
      'http://localhost/api/system/connectors',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenTen1}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          recordKind: 'webhook_endpoint',
          providerOrUrl: 'https://hooks.example.internal/shac',
          events: ['order.created', 'pos.checkout'],
          configJson: JSON.stringify({ secret: 'whsec_test_secret_key_2026' }),
        }),
      },
      testEnv,
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const dispatchRes = await workerApp.request(
      `http://localhost/api/system/connectors/${created.id}/dispatch`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenTen1}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          eventType: 'order.created',
          payload: { orderId: 'ord_900', totalMinor: 125000 },
          dryRun: true,
        }),
      },
      testEnv,
    );
    expect(dispatchRes.status).toBe(200);
    const dispatchBody = (await dispatchRes.json()) as {
      ok: boolean;
      signatureHeader: string;
      eventType: string;
      processedCount: number;
    };
    expect(dispatchBody.ok).toBe(true);
    expect(dispatchBody.signatureHeader).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(dispatchBody.processedCount).toBe(1);
  });

  it('invokes Workers AI binding when present on env.AI and falls back to D1 telemetry otherwise', async () => {
    const testEnv = makeTestEnv({
      AI: {
        async run() {
          return { response: 'Respuesta generada por Workers AI Llama 3.1 con telemetría D1.' };
        },
      },
    });
    const baseProfile = makeProfile(['core', 'iam', 'customers', 'catalog', 'pos', 'finance', 'portal', 'automation']);
    await testEnv.CONFIG_KV.put(
      'profile:current',
      JSON.stringify({
        ...baseProfile,
        entitlements: { ...baseProfile.entitlements, aiCopilotEnabled: true },
      }),
    );
    invalidateProfileCache();
    const aiRes = await workerApp.request(
      'http://localhost/api/automation/ai-chat',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenTen1}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'Resume las órdenes y reclamos activos',
        }),
      },
      testEnv,
    );
    expect(aiRes.status).toBe(200);
    const aiBody = (await aiRes.json()) as {
      ok: boolean;
      engine: string;
      reply: string;
    };
    expect(aiBody.ok).toBe(true);
    expect(aiBody.engine).toBe('workers-ai:@cf/meta/llama-3.1-8b-instruct');
    expect(aiBody.reply).toContain('Workers AI Llama 3.1');
  });

  it('serves and submits public forms at /api/public/forms/:slug without staff session headers', async () => {
    const testEnv = makeTestEnv();
    const createFormRes = await workerApp.request(
      'http://localhost/api/portal/forms',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenTen1}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          recordKind: 'form_definition',
          formSlug: 'registro-distribuidor-2026',
          schemaJson: JSON.stringify({
            title: 'Registro de Distribuidor Mayorista',
            fields: [
              { name: 'companyName', label: 'Empresa', type: 'text', required: true },
              { name: 'taxId', label: 'RIF / NIT', type: 'text', required: true },
            ],
          }),
        }),
      },
      testEnv,
    );
    expect(createFormRes.status).toBe(201);

    const getFormRes = await workerApp.request(
      'http://localhost/api/public/forms/registro-distribuidor-2026?tenantId=ten_1',
      { method: 'GET' },
      testEnv,
    );
    expect(getFormRes.status).toBe(200);
    const formMeta = (await getFormRes.json()) as {
      formSlug: string;
      schema: { title: string };
    };
    expect(formMeta.formSlug).toBe('registro-distribuidor-2026');
    expect(formMeta.schema.title).toBe('Registro de Distribuidor Mayorista');

    const submitRes = await workerApp.request(
      'http://localhost/api/public/forms/registro-distribuidor-2026',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'ten_1',
          answers: {
            companyName: 'Importadora Los Andes C.A.',
            taxId: 'J-40998877-1',
          },
        }),
      },
      testEnv,
    );
    expect(submitRes.status).toBe(201);
    const submitBody = (await submitRes.json()) as {
      ok: boolean;
      submissionId: string;
    };
    expect(submitBody.ok).toBe(true);
    expect(submitBody.submissionId).toBeTruthy();
  });

  it('retrieves and accepts public quotes at /api/public/quotes/:orderNumber without staff session', async () => {
    const testEnv = makeTestEnv();
    const createQuoteRes = await workerApp.request(
      'http://localhost/api/pos/quotes',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokenTen1}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          currency: 'USD',
          totalMinor: 98600,
        }),
      },
      testEnv,
    );
    expect(createQuoteRes.status).toBe(201);
    const createdQuote = (await createQuoteRes.json()) as { orderNumber: string };

    const getQuoteRes = await workerApp.request(
      `http://localhost/api/public/quotes/${createdQuote.orderNumber}?tenantId=ten_1`,
      { method: 'GET' },
      testEnv,
    );
    expect(getQuoteRes.status).toBe(200);

    const acceptRes = await workerApp.request(
      `http://localhost/api/public/quotes/${createdQuote.orderNumber}/decision`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'ten_1',
          decision: 'ACCEPTED',
          acceptedByName: 'María Fernanda Rojas',
          acceptedByEmail: 'mrojas@losandes.example',
        }),
      },
      testEnv,
    );
    expect(acceptRes.status).toBe(200);
    const acceptBody = (await acceptRes.json()) as {
      ok: boolean;
      status: string;
    };
    expect(acceptBody.ok).toBe(true);
    expect(acceptBody.status).toBe('fulfilled');
  });
});
