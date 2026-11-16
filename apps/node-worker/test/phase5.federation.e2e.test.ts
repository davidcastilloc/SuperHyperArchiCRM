import { createFederationHubApp } from '@shac/federation-hub';
import { signFederationEnvelope } from '@shac/federation-sdk';
import { generateEd25519KeyPair } from '@shac/kernel';
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../packages/db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../packages/db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../packages/db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import hubMigrationSql from '../../federation-hub/migrations/0001_federation_hub_core.sql?raw';
import { invalidateProfileCache, workerApp, type WorkerEnv } from '../src/router.js';
import { seedPhase3Fixtures } from './phase3-fixtures.js';
import { callWorkerJson, createPhase3Tokens } from './phase3-helpers.js';
import { applySqlScript, makeProfile, seedTenantsAndOrgs } from './test-helpers.js';

const hubApp = createFederationHubApp();

async function callHub(path: string, body: unknown): Promise<Response> {
  const req = new Request(`https://hub.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return hubApp.fetch(req, { HUB_DB: env.DB, HUB_KV: env.SESSION_KV });
}

describe('@shac/node-worker Phase 5 Federation E2E (workerd)', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let workerEnv: WorkerEnv;
  let tokenTen1: string;
  let tokenReadOnly: string;

  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await applySqlScript(env.DB, hubMigrationSql);
    await seedTenantsAndOrgs(env.DB);
    await seedPhase3Fixtures(env.DB, nowSec);

    const created = await createPhase3Tokens();
    tokenTen1 = created.tokenTen1;
    tokenReadOnly = created.tokenReadOnly;
    workerEnv = {
      ...(env as unknown as WorkerEnv),
      JWT_PUBLIC_KEY_JWK: JSON.stringify(created.keys.publicKeyJwk),
    };
    await env.CONFIG_KV.put(
      'profile:current',
      JSON.stringify(makeProfile(['iam', 'catalog', 'wms'])),
    );
  });

  beforeEach(() => {
    invalidateProfileCache();
  });

  it('evaluates reorder trigger & consolidates pending restocks on /api/federation/b2b/reorder-evaluate', async () => {
    const res = await callWorkerJson<{
      ok: boolean;
      decision: { action: string; windowHours: number };
      batches: Array<{ totalQty: number; itemCount: number; gtin: string }>;
    }>(workerApp, workerEnv, '/api/federation/b2b/reorder-evaluate', tokenReadOnly, {
      trigger: { availableQty: 3, reorderPoint: 10, urgent: false },
      pendingItems: [
        {
          supplierDid: 'did:shac:distro-b',
          gtin: '7591234567890',
          requestedQty: 5,
          queuedAtMs: 1_700_000_000_000,
          localSku: 'HARINA-P3',
          branchId: 'org_1',
        },
        {
          supplierDid: 'did:shac:distro-b',
          gtin: '07591234567890',
          requestedQty: 7,
          queuedAtMs: 1_700_003_600_000,
          localSku: 'HARINA-P3',
          branchId: 'org_1',
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(res.data.decision.action).toBe('BUFFER_FOR_CONSOLIDATION');
    expect(res.data.decision.windowHours).toBe(24);
    expect(res.data.batches).toHaveLength(1);
    expect(res.data.batches[0]?.totalQty).toBe(12);
    expect(res.data.batches[0]?.itemCount).toBe(2);
    expect(res.data.batches[0]?.gtin).toBe('07591234567890');
  });

  it('runs full Store-A <-> Hub <-> Distro-B B2B flow and creates idempotent asn_receipt in D1 A', async () => {
    const storeAKeys = await generateEd25519KeyPair();
    const distroBKeys = await generateEd25519KeyPair();
    const storeADid = 'did:shac:store-a';
    const distroBDid = 'did:shac:distro-b';
    const hubDid = 'did:shac:hub';

    const regA = await callHub('/api/hub/nodes/register', {
      deploymentId: 'store-a',
      companyName: 'Tienda A CA',
      publicKeyJwk: storeAKeys.publicKeyJwk,
      region: 've',
      city: 'Caracas',
    });
    expect(regA.status).toBe(201);

    const regB = await callHub('/api/hub/nodes/register', {
      deploymentId: 'distro-b',
      companyName: 'Distribuidora B CA',
      publicKeyJwk: distroBKeys.publicKeyJwk,
      region: 've',
      city: 'Caracas',
    });
    expect(regB.status).toBe(201);

    const offerEnv = await signFederationEnvelope(
      {
        envelopeId: 'env_e2e_offer_1',
        senderDid: distroBDid,
        recipientDid: hubDid,
        eventType: 'CATALOG_OFFER_UPSERTED',
        payload: {
          offerId: 'offer_distro_b_harina',
          gtin: '7591234567890',
          supplierSku: 'DIST-HAR-1',
          title: 'Harina Maiz 1kg',
          category: 'alimentos',
          city: 'Caracas',
          region: 've',
          unitPriceMinor: 850,
          minOrderQty: 1,
          uomFactorMicros: 1_000_000,
          availableQty: 200,
          deliveryHours: 12,
        },
      },
      distroBKeys.privateKeyJwk,
    );
    expect((await callHub('/api/hub/envelopes', offerEnv)).status).toBe(201);

    const bestRes = await callHub('/api/hub/b2b/find-best-offers', {
      gtin: '7591234567890',
      requiredQty: 12,
      buyerCity: 'Caracas',
      buyerRegion: 've',
    });
    expect(bestRes.status).toBe(200);
    const bestJson = (await bestRes.json()) as {
      offers: Array<{ offerId: string; supplierDid: string; unitPriceMinor: number }>;
    };
    expect(bestJson.offers.length).toBeGreaterThanOrEqual(1);
    expect(bestJson.offers[0]?.supplierDid).toBe(distroBDid);

    const poNumber = 'PO-E2E-5001';
    const poSub = await signFederationEnvelope(
      {
        envelopeId: 'env_e2e_po_sub_1',
        senderDid: storeADid,
        recipientDid: distroBDid,
        eventType: 'B2B_PO_SUBMITTED',
        payload: {
          orderId: 'ord_e2e_1',
          poNumber,
          supplierDid: distroBDid,
          items: [{ gtin: '7591234567890', supplierSku: 'DIST-HAR-1', qty: 12, unitPriceMinor: 850 }],
          totalMinor: 10_200,
        },
      },
      storeAKeys.privateKeyJwk,
    );
    expect((await callHub('/api/hub/envelopes', poSub)).status).toBe(201);

    const poAcc = await signFederationEnvelope(
      {
        envelopeId: 'env_e2e_po_acc_1',
        senderDid: distroBDid,
        recipientDid: storeADid,
        eventType: 'B2B_PO_ACCEPTED',
        payload: { orderId: 'ord_e2e_1', poNumber },
      },
      distroBKeys.privateKeyJwk,
    );
    expect((await callHub('/api/hub/envelopes', poAcc)).status).toBe(201);

    const shipEnv = await signFederationEnvelope(
      {
        envelopeId: 'env_e2e_ship_1',
        senderDid: distroBDid,
        recipientDid: storeADid,
        eventType: 'B2B_SHIPMENT_DISPATCHED',
        payload: {
          orderId: 'ord_e2e_1',
          poNumber,
          gs1Lot: '(10)LOT-2026-B1',
          qty: 12,
          unitCostMinor: 850,
          currency: 'USD',
        },
      },
      distroBKeys.privateKeyJwk,
    );
    expect((await callHub('/api/hub/envelopes', shipEnv)).status).toBe(201);

    const epodEnv = await signFederationEnvelope(
      {
        envelopeId: 'env_e2e_epod_1',
        senderDid: storeADid,
        recipientDid: distroBDid,
        eventType: 'B2B_EPOD_CONFIRMED',
        payload: { orderId: 'ord_e2e_1', poNumber },
      },
      storeAKeys.privateKeyJwk,
    );
    expect((await callHub('/api/hub/envelopes', epodEnv)).status).toBe(201);

    const badRes = await callWorkerJson(
      workerApp,
      workerEnv,
      '/api/federation/b2b/asn-receive',
      tokenTen1,
      {
        envelope: { ...shipEnv, payload: { ...shipEnv.payload, qty: 999 } },
        senderPublicKeyJwk: distroBKeys.publicKeyJwk,
        sourceLocationId: 'loc_p3_vendor',
        destLocationId: 'loc_p3_main',
        productId: 'prod_p3_harina',
      },
    );
    expect(badRes.status).toBe(401);

    const asnRes = await callWorkerJson<{
      ok: boolean;
      pickingId: string;
      operationKind: string;
      qtyMicros: number;
      lotCode: string;
      idempotentReplay: boolean;
    }>(workerApp, workerEnv, '/api/federation/b2b/asn-receive', tokenTen1, {
      envelope: shipEnv,
      senderPublicKeyJwk: distroBKeys.publicKeyJwk,
      sourceLocationId: 'loc_p3_vendor',
      destLocationId: 'loc_p3_main',
      productId: 'prod_p3_harina',
    });
    expect(asnRes.status).toBe(201);
    expect(asnRes.data.ok).toBe(true);
    expect(asnRes.data.operationKind).toBe('asn_receipt');
    expect(asnRes.data.qtyMicros).toBe(12_000_000);
    expect(asnRes.data.lotCode).toBe('(10)LOT-2026-B1');
    expect(asnRes.data.idempotentReplay).toBe(false);

    const picking = await env.DB.prepare(
      'SELECT operation_kind, status FROM wms_pickings WHERE id = ?',
    )
      .bind(asnRes.data.pickingId)
      .first<{ operation_kind: string; status: string }>();
    expect(picking?.operation_kind).toBe('asn_receipt');
    expect(picking?.status).toBe('done');

    const moves = await env.DB.prepare(
      'SELECT done_qty_micros, unit_cost_minor FROM wms_stock_moves WHERE picking_id = ?',
    )
      .bind(asnRes.data.pickingId)
      .all<{ done_qty_micros: number; unit_cost_minor: number }>();
    expect(moves.results).toHaveLength(1);
    expect(moves.results[0]?.done_qty_micros).toBe(12_000_000);
    expect(moves.results[0]?.unit_cost_minor).toBe(850);

    const replayRes = await callWorkerJson<{
      pickingId: string;
      idempotentReplay: boolean;
    }>(workerApp, workerEnv, '/api/federation/b2b/asn-receive', tokenTen1, {
      envelope: shipEnv,
      senderPublicKeyJwk: distroBKeys.publicKeyJwk,
      sourceLocationId: 'loc_p3_vendor',
      destLocationId: 'loc_p3_main',
      productId: 'prod_p3_harina',
    });
    expect(replayRes.status).toBe(200);
    expect(replayRes.data.idempotentReplay).toBe(true);
    expect(replayRes.data.pickingId).toBe(asnRes.data.pickingId);
  });
});
