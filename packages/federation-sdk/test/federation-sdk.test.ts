import { AppError, generateEd25519KeyPair } from '@shac/kernel';
import { describe, expect, it } from 'vitest';
import {
  ANTI_REPLAY_WINDOW_MS,
  assertPublicOfferSafe,
  canonicalJson,
  computePayloadSha256Hex,
  consolidatePendingRestocks,
  convertPackQtyToBaseUnits,
  evaluateReorderTrigger,
  matchCatalogItem,
  normalizeGtin,
  signFederationEnvelope,
  verifyFederationEnvelope,
} from '../src/index.js';

describe('@shac/federation-sdk', () => {
  describe('envelope sign & verify', () => {
    it('canonicalizes JSON keys deterministically regardless of insertion order', async () => {
      const a = { z: 1, a: { d: 4, b: 2 }, arr: [{ y: 2, x: 1 }] };
      const b = { arr: [{ x: 1, y: 2 }], a: { b: 2, d: 4 }, z: 1 };
      expect(canonicalJson(a)).toBe(canonicalJson(b));
      expect(await computePayloadSha256Hex(a)).toBe(
        await computePayloadSha256Hex(b),
      );
    });

    it('signs and verifies a FederationEnvelope with Ed25519 within anti-replay window', async () => {
      const { publicKeyJwk, privateKeyJwk } = await generateEd25519KeyPair();
      const issuedAt = 1_763_300_000_000;

      const envelope = await signFederationEnvelope(
        {
          envelopeId: '01JFEDENV00000000000000001',
          senderDid: 'did:shac:store-a',
          recipientDid: 'did:shac:hub',
          eventType: 'B2B_PO_SUBMITTED',
          issuedAt,
          payload: {
            poNumber: 'PO-2026-001',
            totalMinor: 125_000,
            items: [{ gtin: '7501055311239', qty: 2 }],
          },
        },
        privateKeyJwk,
      );

      const verified = await verifyFederationEnvelope(
        envelope,
        publicKeyJwk,
        issuedAt + ANTI_REPLAY_WINDOW_MS,
      );
      expect(verified.envelopeId).toBe('01JFEDENV00000000000000001');
      expect(verified.protocolVersion).toBe('1.0');
    });

    it('rejects envelopes outside the 300_000 ms anti-replay window', async () => {
      const { publicKeyJwk, privateKeyJwk } = await generateEd25519KeyPair();
      const issuedAt = 1_763_300_000_000;

      const envelope = await signFederationEnvelope(
        {
          envelopeId: '01JFEDENV00000000000000002',
          senderDid: 'did:shac:store-a',
          recipientDid: 'did:shac:hub',
          eventType: 'B2B_PO_SUBMITTED',
          issuedAt,
          payload: { poNumber: 'PO-2026-002' },
        },
        privateKeyJwk,
      );

      await expect(
        verifyFederationEnvelope(
          envelope,
          publicKeyJwk,
          issuedAt + ANTI_REPLAY_WINDOW_MS + 1,
        ),
      ).rejects.toThrowError(AppError);

      await expect(
        verifyFederationEnvelope(
          envelope,
          publicKeyJwk,
          issuedAt - ANTI_REPLAY_WINDOW_MS - 1,
        ),
      ).rejects.toMatchObject({ code: 'REPLAY_WINDOW_EXCEEDED' });
    });

    it('rejects tampered payload and tampered header/signature', async () => {
      const { publicKeyJwk, privateKeyJwk } = await generateEd25519KeyPair();
      const issuedAt = 1_763_300_000_000;

      const envelope = await signFederationEnvelope(
        {
          envelopeId: '01JFEDENV00000000000000003',
          senderDid: 'did:shac:store-a',
          recipientDid: 'did:shac:distro-b',
          eventType: 'B2B_PO_SUBMITTED',
          issuedAt,
          payload: { poNumber: 'PO-2026-003', totalMinor: 50_000 },
        },
        privateKeyJwk,
      );

      const tamperedPayload = {
        ...envelope,
        payload: { poNumber: 'PO-2026-003', totalMinor: 1 },
      };
      await expect(
        verifyFederationEnvelope(tamperedPayload, publicKeyJwk, issuedAt),
      ).rejects.toMatchObject({ code: 'PAYLOAD_HASH_MISMATCH' });

      const tamperedHeader = {
        ...envelope,
        recipientDid: 'did:shac:evil-node',
      };
      await expect(
        verifyFederationEnvelope(tamperedHeader, publicKeyJwk, issuedAt),
      ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    });
  });

  describe('catalog matcher, UOM conversion, and privacy guard', () => {
    it('normalizes UPC-A, EAN-13, and GTIN-14 and matches items deterministically', () => {
      expect(normalizeGtin('012345678905')).toBe('00012345678905');
      expect(normalizeGtin('0012345678905')).toBe('00012345678905');
      expect(normalizeGtin('750-1055-31123-9')).toBe('07501055311239');

      const mappings = [
        {
          localSku: 'SKU-COLA-UNIT',
          gtin: '0012345678905',
          supplierDid: 'did:shac:distro-b',
          supplierSku: 'CAJA-COLA-24',
          uomFactorMicros: 24_000_000,
        },
        {
          localSku: 'SKU-WATER-UNIT',
          supplierDid: 'did:shac:distro-b',
          supplierSku: 'PACK-WATER-12',
          uomFactorMicros: 12_000_000,
        },
      ];

      const gtinMatch = matchCatalogItem(
        { gtin: '012345678905' },
        mappings,
      );
      expect(gtinMatch?.matchedBy).toBe('gtin');
      expect(gtinMatch?.mapping.localSku).toBe('SKU-COLA-UNIT');

      const skuMatch = matchCatalogItem(
        { supplierDid: 'did:shac:distro-b', supplierSku: 'PACK-WATER-12' },
        mappings,
      );
      expect(skuMatch?.matchedBy).toBe('supplier_sku');
      expect(skuMatch?.mapping.localSku).toBe('SKU-WATER-UNIT');

      expect(convertPackQtyToBaseUnits(1, 24_000_000)).toBe(24);
      expect(convertPackQtyToBaseUnits(3, 24_000_000)).toBe(72);
    });

    it('enforces privacy boundary on public offers', () => {
      const safeOffer = assertPublicOfferSafe({
        supplierDid: 'did:shac:distro-b',
        gtin: '7501055311239',
        priceMinor: 24_000,
        isPublicInNetwork: true,
      });
      expect(safeOffer.priceMinor).toBe(24_000);

      expect(() =>
        assertPublicOfferSafe({
          supplierDid: 'did:shac:distro-b',
          priceMinor: 24_000,
          costPriceMinor: 18_000,
        }),
      ).toThrowError(AppError);

      expect(() =>
        assertPublicOfferSafe({
          supplierDid: 'did:shac:distro-b',
          marginBps: 2500,
        }),
      ).toThrowError(AppError);

      expect(() =>
        assertPublicOfferSafe({
          supplierDid: 'did:shac:distro-b',
          nested: { customerList: ['cust-1'] },
        }),
      ).toThrowError(AppError);
    });
  });

  describe('24h consolidation buffer', () => {
    it('evaluates reorder triggers for immediate vs 24h buffered restock', () => {
      expect(
        evaluateReorderTrigger({
          availableQty: 15,
          reorderPoint: 10,
          urgent: false,
          consolidateLowStockHours: 24,
        }),
      ).toEqual({ action: 'NONE', reason: 'ABOVE_REORDER_POINT' });

      expect(
        evaluateReorderTrigger({
          availableQty: 0,
          reorderPoint: 10,
          urgent: true,
          consolidateLowStockHours: 24,
        }),
      ).toEqual({
        action: 'DISPATCH_IMMEDIATE',
        reason: 'CRITICAL_STOCKOUT_URGENT',
      });

      expect(
        evaluateReorderTrigger({
          availableQty: 4,
          reorderPoint: 10,
          urgent: false,
          consolidateLowStockHours: 0,
        }),
      ).toEqual({
        action: 'DISPATCH_IMMEDIATE',
        reason: 'CONSOLIDATION_DISABLED',
      });

      expect(
        evaluateReorderTrigger({
          availableQty: 4,
          reorderPoint: 10,
          urgent: false,
          consolidateLowStockHours: 24,
        }),
      ).toEqual({
        action: 'BUFFER_FOR_CONSOLIDATION',
        reason: 'LOW_STOCK_BUFFERED',
        windowHours: 24,
      });
    });

    it('consolidates pending restocks by (supplierDid, gtin) within 24h window', () => {
      const t0 = 1_763_300_000_000;
      const batches = consolidatePendingRestocks([
        {
          supplierDid: 'did:shac:distro-b',
          gtin: '012345678905',
          requestedQty: 2,
          queuedAtMs: t0,
          localSku: 'SKU-A',
          branchId: 'branch-1',
        },
        {
          supplierDid: 'did:shac:distro-b',
          gtin: '0012345678905',
          requestedQty: 3,
          queuedAtMs: t0 + 3_600_000,
          localSku: 'SKU-A',
          branchId: 'branch-2',
        },
        {
          supplierDid: 'did:shac:distro-b',
          gtin: '012345678905',
          requestedQty: 1,
          queuedAtMs: t0 + 25 * 3_600_000,
          localSku: 'SKU-A',
          branchId: 'branch-1',
        },
      ]);

      expect(batches).toHaveLength(2);
      expect(batches[0]).toMatchObject({
        supplierDid: 'did:shac:distro-b',
        gtin: '00012345678905',
        totalQty: 5,
        itemCount: 2,
        branchIds: ['branch-1', 'branch-2'],
      });
      expect(batches[1]).toMatchObject({
        supplierDid: 'did:shac:distro-b',
        gtin: '00012345678905',
        totalQty: 1,
        itemCount: 1,
      });
    });
  });
});
