# Phase 5 Implementation Plan: Hub Federado B2B, Buffer 24h y Marketplace B2C

> **For agentic workers:** Executed via Native Swarm (`shac-phase-5-federation-hub`) using `model: "gemini-4-hydrogen-medium"` and `workspace: "inherit"`. Keep every `.ts`/`.tsx` `<= 300` lines, `"type": "module"`, `"sideEffects": false`, zero floats for money (`*Minor`/`*Bps`/`*Micros`), zero OS paths, additive SQL only (`0` `DROP TABLE`/`DROP COLUMN`).

**Goal:** Implementar `@shac/federation-sdk` (identidad `did:shac:*`, `FederationEnvelope` Ed25519 + SHA-256 anti-replay `<= 300_000 ms`, buffer de consolidación 24h y emparejamiento GTIN/UOM), `@shac/federation-hub` (base D1 global separada con registro DID, ofertas `is_public_in_network = true`, idempotencia por `envelopeId`, `federation.b2b.findBestOffers`, marketplace B2C con ranking + hook Vectorize opcional y `holdInventoryTTL`), y la integración extremo a extremo entre **Nodo Tienda (D1 A)** y **Nodo Distribuidora (D1 B)** generando **ASN** automático tras `B2B_PO_SUBMITTED -> B2B_SHIPMENT_DISPATCHED -> B2B_EPOD_CONFIRMED`.

---

## Task 1: `@shac/federation-sdk` (`packages/federation-sdk/**`) (`fed-sdk-author`)

- [x] **Step 1:** Crear `packages/federation-sdk/{package.json,tsconfig.json,vitest.config.ts}` (`"name": "@shac/federation-sdk"`, `"type": "module"`, `"sideEffects": false`, deps `@shac/kernel`, `zod`).
- [x] **Step 2:** Implementar `src/envelope.ts`: `FederationEnvelopeSchema`, `canonicalJson(value)`, `signFederationEnvelope(input, privateKeyJwk)` y `verifyFederationEnvelope(envelope, senderPublicKeyJwk, nowMs)` (WebCrypto `SHA-256` + `Ed25519` + ventana anti-replay `|nowMs - issuedAt| <= 300_000`).
- [x] **Step 3:** Implementar `src/catalog-matcher.ts`: normalización GTIN (EAN-13 / UPC-A / GS1) y conversión de empaque (`CAJA x24 -> 24 UNIDADES` en enteros `uomFactorMicros`), además de filtro de privacidad (`assertPublicOfferOnly` rechazando costos/márgenes/clientes finales).
- [x] **Step 4:** Implementar `src/consolidation-buffer.ts`: buffer de consolidación 24h (`consolidateLowStockHours`: disparo inmediato si `stock === 0 && urgent` o `consolidateLowStockHours === 0`, o acumulación consolidada por proveedor/GTIN en ventana de 24h).
- [x] **Step 5:** Implementar `src/index.ts` y `test/federation-sdk.test.ts` (firma/verificación Ed25519, rechazo anti-replay `> 300_000 ms`, rechazo payload adulterado, matcher GTIN/UOM y buffer 24h).

## Task 2: `@shac/federation-hub` (`apps/federation-hub/**`) (`fed-hub-author`)

- [x] **Step 1:** Crear `apps/federation-hub/{package.json,tsconfig.json,vitest.config.ts,wrangler.test.jsonc}` con D1 `HUB_DB` y KV `HUB_KV`.
- [x] **Step 2:** Crear `migrations/0001_federation_hub_core.sql` y `src/schema.ts` con tablas aditivas (`hub_nodes`, `hub_public_offers`, `hub_envelopes_idempotency`, `hub_b2b_orders`, `hub_inventory_holds`).
- [x] **Step 3:** Implementar `src/router.ts` & `src/index.ts` (`createFederationHubApp`):
  - `POST /api/hub/nodes/register`: registra `did:shac:<deploymentId>` + `publicKeyJwk`.
  - `POST /api/hub/envelopes`: verifica `FederationEnvelope` (anti-replay + SHA-256 + Ed25519), registra `envelopeId` en `hub_envelopes_idempotency` (idempotente `200` en reintento, `409` en conflicto) y procesa `CATALOG_OFFER_UPSERTED`, `CATALOG_OFFER_WITHDRAWN`, `B2B_PO_SUBMITTED`, `B2B_PO_ACCEPTED`, `B2B_PO_BACKORDERED`, `B2B_SHIPMENT_DISPATCHED`, `B2B_EPOD_CONFIRMED`.
  - `POST /api/hub/b2b/find-best-offers` (y tool MCP `federation.b2b.findBestOffers`): filtra ofertas públicas por `gtin`, `qty`, `region`, `city`, `allowedSupplierDids` ordenando por mejor precio escalonado y disponibilidad.
  - `GET /api/hub/marketplace/search`: búsqueda B2C en D1 (con hook opcional Vectorize `ai`/`vectorize` para ranking semántico).
  - `POST /api/hub/marketplace/hold`: reserva temporal `holdInventoryTTL` antes de captura de pago.
- [x] **Step 4:** Implementar `test/federation-hub.worker.test.ts` en `workerd` cubriendo registro DID, verificación Ed25519 + idempotencia por `envelopeId`, `findBestOffers`, búsqueda B2C y `holdInventoryTTL`.

## Task 3: Integración E2E `Nodo Tienda (D1 A) <-> Nodo Distribuidora (D1 B)` + `@shac/node-worker` + RDD & Deploy (`app-author-4`)

- [x] **Step 1:** Conectar `@shac/federation-sdk` en `apps/node-worker` exponiendo `/api/federation/b2b/reorder-evaluate` y `/api/federation/b2b/asn-receive` (creando `wms_pickings` en `asn_receipt` al recibir `B2B_SHIPMENT_DISPATCHED` / `B2B_EPOD_CONFIRMED` verificado).
- [x] **Step 2:** Crear `apps/node-worker/test/phase5.federation.e2e.test.ts` en `workerd` simulando **D1 A (Tienda) <-> Hub <-> D1 B (Distribuidora)**: `B2B_PO_SUBMITTED -> B2B_SHIPMENT_DISPATCHED (con lotes GS1) -> B2B_EPOD_CONFIRMED` generando automáticamente el **ASN** en D1 A sin tipeo.
- [x] **Step 3:** Actualizar `knip.json`, correr RDD completo (`typecheck`, `knip --strict`, `test:run`, `web-spa build`, `wrangler deploy --dry-run` `gzip < 500 KiB`), marcar `- [x]`, actualizar `DECISIONS.md` (`ADR-011`), commit en `main`, desplegar a `PC911 IT Services Global` y probar en vivo.
