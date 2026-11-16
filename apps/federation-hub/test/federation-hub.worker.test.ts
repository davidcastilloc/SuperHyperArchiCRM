import { signFederationEnvelope } from '@shac/federation-sdk';
import { generateEd25519KeyPair } from '@shac/kernel';
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import migrationSql from '../migrations/0001_federation_hub_core.sql?raw';
import { createFederationHubApp } from '../src/index.js';

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

const app = createFederationHubApp();

function callHub(path: string, body?: unknown, method = 'POST'): Promise<Response> {
  const req = new Request(`https://hub.test${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return Promise.resolve(app.fetch(req, env));
}

describe('@shac/federation-hub on workerd', () => {
  let supplierAKeys: Awaited<ReturnType<typeof generateEd25519KeyPair>>;
  let supplierBKeys: Awaited<ReturnType<typeof generateEd25519KeyPair>>;
  let buyerKeys: Awaited<ReturnType<typeof generateEd25519KeyPair>>;

  const supplierADid = 'did:shac:dep_dist_a';
  const supplierBDid = 'did:shac:dep_dist_b';
  const buyerDid = 'did:shac:dep_tienda_1';
  const hubDid = 'did:shac:hub';

  beforeAll(async () => {
    await applySqlScript(env.HUB_DB, migrationSql);
    supplierAKeys = await generateEd25519KeyPair();
    supplierBKeys = await generateEd25519KeyPair();
    buyerKeys = await generateEd25519KeyPair();
  });

  it('registers DID nodes, verifies Ed25519 envelopes, and enforces idempotency + privacy', async () => {
    const nodes = [
      { deploymentId: 'dep_dist_a', companyName: 'Distribuidora Alpha CA', publicKeyJwk: supplierAKeys.publicKeyJwk },
      { deploymentId: 'dep_dist_b', companyName: 'Distribuidora Beta CA', publicKeyJwk: supplierBKeys.publicKeyJwk },
      { deploymentId: 'dep_tienda_1', companyName: 'Tienda Centro', publicKeyJwk: buyerKeys.publicKeyJwk },
    ];
    for (const node of nodes) {
      const regRes = await callHub('/api/hub/nodes/register', { ...node, region: 've', city: 'Caracas' });
      expect(regRes.status).toBe(201);
    }

    // Upsert public offer from Supplier A (cheaper, 24h)
    const offerEnvA = await signFederationEnvelope(
      {
        envelopeId: 'env_offer_a_1',
        senderDid: supplierADid,
        recipientDid: hubDid,
        eventType: 'CATALOG_OFFER_UPSERTED',
        payload: {
          offerId: 'offer_a_harina',
          gtin: '7591234567890',
          supplierSku: 'HAR-24',
          title: 'Harina Pan Caja x24',
          category: 'alimentos',
          city: 'Caracas',
          region: 've',
          unitPriceMinor: 2400,
          minOrderQty: 1,
          uomFactorMicros: 24_000_000,
          availableQty: 100,
          deliveryHours: 24,
        },
      },
      supplierAKeys.privateKeyJwk,
    );

    const resA = await callHub('/api/hub/envelopes', offerEnvA);
    expect(resA.status).toBe(201);
    const jsonA = (await resA.json()) as { idempotentReplay: boolean; result: { offerId: string } };
    expect(jsonA.idempotentReplay).toBe(false);
    expect(jsonA.result.offerId).toBe('offer_a_harina');

    // Idempotent replay returns 200
    const replayRes = await callHub('/api/hub/envelopes', offerEnvA);
    expect(replayRes.status).toBe(200);
    const replayJson = (await replayRes.json()) as { idempotentReplay: boolean };
    expect(replayJson.idempotentReplay).toBe(true);

    // Conflict: same envelopeId with different payload returns 409
    const conflictEnv = await signFederationEnvelope(
      {
        envelopeId: 'env_offer_a_1',
        senderDid: supplierADid,
        recipientDid: hubDid,
        eventType: 'CATALOG_OFFER_UPSERTED',
        payload: {
          offerId: 'offer_a_harina',
          gtin: '7591234567890',
          supplierSku: 'HAR-24',
          title: 'Harina Pan Caja x24 MODIFIED',
          category: 'alimentos',
          city: 'Caracas',
          region: 've',
          unitPriceMinor: 2500,
          availableQty: 50,
        },
      },
      supplierAKeys.privateKeyJwk,
    );
    const conflictRes = await callHub('/api/hub/envelopes', conflictEnv);
    expect(conflictRes.status).toBe(409);

    // Privacy guard: rejects costPriceMinor
    const privateEnv = await signFederationEnvelope(
      {
        envelopeId: 'env_private_leak',
        senderDid: supplierADid,
        recipientDid: hubDid,
        eventType: 'CATALOG_OFFER_UPSERTED',
        payload: {
          gtin: '7591234567890',
          supplierSku: 'HAR-SECRET',
          title: 'Secret Offer',
          city: 'Caracas',
          region: 've',
          unitPriceMinor: 2400,
          availableQty: 10,
          costPriceMinor: 1500,
        },
      },
      supplierAKeys.privateKeyJwk,
    );
    const privateRes = await callHub('/api/hub/envelopes', privateEnv);
    expect(privateRes.status).toBe(403);

    // Tampered payload rejected with 401
    const tamperedEnv = {
      ...offerEnvA,
      envelopeId: 'env_tampered',
      payload: { ...offerEnvA.payload, unitPriceMinor: 100 },
    };
    const tamperedRes = await callHub('/api/hub/envelopes', tamperedEnv);
    expect(tamperedRes.status).toBe(401);

    // Upsert offer from Supplier B (higher price, faster delivery)
    const offerEnvB = await signFederationEnvelope(
      {
        envelopeId: 'env_offer_b_1',
        senderDid: supplierBDid,
        recipientDid: hubDid,
        eventType: 'CATALOG_OFFER_UPSERTED',
        payload: {
          offerId: 'offer_b_harina',
          gtin: '7591234567890',
          supplierSku: 'HAR-B24',
          title: 'Harina Pan Express x24',
          category: 'alimentos',
          city: 'Caracas',
          region: 've',
          unitPriceMinor: 2650,
          minOrderQty: 1,
          uomFactorMicros: 24_000_000,
          availableQty: 50,
          deliveryHours: 6,
        },
      },
      supplierBKeys.privateKeyJwk,
    );
    expect((await callHub('/api/hub/envelopes', offerEnvB)).status).toBe(201);
  });

  it('finds best B2B offers, searches B2C marketplace, and holds inventory TTL', async () => {
    const bestRes = await callHub('/api/hub/b2b/find-best-offers', {
      gtin: '7591234567890',
      qty: 10,
      region: 've',
      city: 'Caracas',
      allowedSupplierDids: [supplierADid, supplierBDid],
    });
    expect(bestRes.status).toBe(200);
    const bestJson = (await bestRes.json()) as {
      offers: Array<{ id: string; unitPriceMinor: number }>;
    };
    expect(bestJson.offers.length).toBe(2);
    expect(bestJson.offers[0]?.id).toBe('offer_a_harina');
    expect(bestJson.offers[1]?.id).toBe('offer_b_harina');

    // B2C search
    const searchRes = await callHub(
      '/api/hub/marketplace/search?q=Harina&city=Caracas&category=alimentos&maxPriceMinor=2500',
      undefined,
      'GET',
    );
    expect(searchRes.status).toBe(200);
    const searchJson = (await searchRes.json()) as { offers: Array<{ id: string }> };
    expect(searchJson.offers.map((o) => o.id)).toEqual(['offer_a_harina']);

    // Hold inventory TTL
    const hold1 = await callHub('/api/hub/marketplace/hold', {
      offerId: 'offer_b_harina',
      buyerRef: 'b2c_cart_1',
      qty: 40,
      ttlSeconds: 300,
    });
    expect(hold1.status).toBe(201);
    const hold1Json = (await hold1.json()) as { holdId: string; remainingQty: number };
    expect(hold1Json.remainingQty).toBe(10);

    const kvVal = await env.HUB_KV.get(`hold:${hold1Json.holdId}`);
    expect(kvVal).not.toBeNull();

    // Over-hold rejected with 409
    const hold2 = await callHub('/api/hub/marketplace/hold', {
      offerId: 'offer_b_harina',
      buyerRef: 'b2c_cart_2',
      qty: 15,
      ttlSeconds: 300,
    });
    expect(hold2.status).toBe(409);
  });

  it('tracks B2B PO lifecycle and offer withdrawal via signed envelopes', async () => {
    const poSubmit = await signFederationEnvelope(
      {
        envelopeId: 'env_po_sub_1',
        senderDid: buyerDid,
        recipientDid: supplierADid,
        eventType: 'B2B_PO_SUBMITTED',
        payload: {
          orderId: 'ord_po_100',
          poNumber: 'PO-2026-100',
          supplierDid: supplierADid,
          items: [{ gtin: '7591234567890', qty: 10, unitPriceMinor: 2400 }],
          totalMinor: 24000,
        },
      },
      buyerKeys.privateKeyJwk,
    );
    expect((await callHub('/api/hub/envelopes', poSubmit)).status).toBe(201);

    const stepEvents: Array<{ id: string; sender: string; recipient: string; keys: typeof buyerKeys; eventType: 'B2B_PO_ACCEPTED' | 'B2B_SHIPMENT_DISPATCHED' | 'B2B_EPOD_CONFIRMED' }> = [
      { id: 'env_po_acc_1', sender: supplierADid, recipient: buyerDid, keys: supplierAKeys, eventType: 'B2B_PO_ACCEPTED' },
      { id: 'env_po_disp_1', sender: supplierADid, recipient: buyerDid, keys: supplierAKeys, eventType: 'B2B_SHIPMENT_DISPATCHED' },
      { id: 'env_po_epod_1', sender: buyerDid, recipient: supplierADid, keys: buyerKeys, eventType: 'B2B_EPOD_CONFIRMED' },
    ];
    let lastJson: { result: { status: string } } | undefined;
    for (const step of stepEvents) {
      const envSigned = await signFederationEnvelope(
        {
          envelopeId: step.id,
          senderDid: step.sender,
          recipientDid: step.recipient,
          eventType: step.eventType,
          payload: { orderId: 'ord_po_100', poNumber: 'PO-2026-100' },
        },
        step.keys.privateKeyJwk,
      );
      const res = await callHub('/api/hub/envelopes', envSigned);
      expect(res.status).toBe(201);
      lastJson = (await res.json()) as { result: { status: string } };
    }
    expect(lastJson?.result.status).toBe('EPOD_CONFIRMED');

    const withdraw = await signFederationEnvelope(
      {
        envelopeId: 'env_withdraw_b',
        senderDid: supplierBDid,
        recipientDid: hubDid,
        eventType: 'CATALOG_OFFER_WITHDRAWN',
        payload: { offerId: 'offer_b_harina' },
      },
      supplierBKeys.privateKeyJwk,
    );
    expect((await callHub('/api/hub/envelopes', withdraw)).status).toBe(201);

    const afterWithdraw = await callHub('/api/hub/b2b/find-best-offers', {
      gtin: '7591234567890',
      qty: 1,
    });
    const afterJson = (await afterWithdraw.json()) as { offers: Array<{ id: string }> };
    expect(afterJson.offers.map((o) => o.id)).toEqual(['offer_a_harina']);
  });
});
