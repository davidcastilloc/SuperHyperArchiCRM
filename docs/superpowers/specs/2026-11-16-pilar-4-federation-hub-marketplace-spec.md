# Especificación Detallada — Pilar 4: Hub Federado B2B, Buffer de 24h y Marketplace B2C

**Carpeta Drive Asociada:** `04_Hub_Federado_B2B_y_Marketplace`  
**Paquetes Cubiertos:** `@shac/federation-sdk`, `@shac/federation-hub`

---

## 1. Identidad Criptográfica (`did:shac:*`) y Frontera de Privacidad

1. **Par de Claves Ed25519 en WebCrypto:** Al habilitar federación para un cliente, el Control Plane genera un par de claves Ed25519, inyecta la clave privada como secreto aislado del Worker del cliente (`FEDERATION_PRIVATE_KEY_JWK`) y publica la clave pública en el registro del Hub bajo `did:shac:<deploymentId>`.
2. **Privacidad Absoluta del Nodo:** Nunca abandonan el D1 privado del cliente su lista de consumidores finales, sus costos promedio de compra, sus márgenes brutos, sus salarios ni sus cierres de caja. Solo cruzan hacia el Hub:
   - Ofertas mayoristas o públicas marcadas explícitamente con `is_public_in_network = true`.
   - Sobres B2B firmados dirigidos a un `recipientDid` autorizado en `allowedSupplierDids`.
3. **Emparejamiento Determinista de Catálogos:** Unión automática entre el comprador (tienda, clínica, hotel o taller) y la distribuidora mediante `gtin` normalizado (EAN-13 / UPC-A / GS1) o mapeo explícito `(supplier_did, supplier_sku)` con conversión automática de unidades de empaque (ej. distribuidora vende `CAJA x24`, tienda recibe `24 UNIDADES`).

---

## 2. Contrato Criptográfico (`FederationEnvelope`)

```ts
// packages/federation-sdk/src/envelope.ts
import { z } from 'zod';

export const FederationEnvelopeSchema = z.object({
  envelopeId: z.string(), // ULID para idempotencia estricta en el receptor
  protocolVersion: z.literal('1.0'),
  senderDid: z.string(),
  recipientDid: z.string(),
  eventType: z.enum([
    'CATALOG_OFFER_UPSERTED',
    'CATALOG_OFFER_WITHDRAWN',
    'B2B_RFQ_REQUESTED',
    'B2B_PO_SUBMITTED',
    'B2B_PO_ACCEPTED',
    'B2B_PO_BACKORDERED',
    'B2B_SHIPMENT_DISPATCHED',
    'B2B_EPOD_CONFIRMED',
  ]),
  issuedAt: z.number(),
  payloadHashSha256: z.string(),
  signatureEd25519: z.string(),
  payload: z.record(z.unknown()),
});
```

Toda recepción en el Hub o en un nodo par verifica:
1. Ventana temporal anti-replay (`|now - issuedAt| <= 300_000 ms`).
2. `SHA-256(canonicalJson(payload)) === payloadHashSha256`.
3. `crypto.subtle.verify('Ed25519', senderPublicKey, signature, canonicalHeaderAndHash)`.
4. Registro atómico de `envelopeId` en la tabla de idempotencia antes de ejecutar efectos secundarios.

---

## 3. Flujo A: Reabastecimiento B2B Automatizado con Buffer de Consolidación de 24h

1. **Detección en `BranchInventoryDO`:** Cuando el saldo disponible de un insumo o producto cae por debajo de `reorder_point` tras ventas en POS o consumos en taller/clínica/hotel:
   - Si el artículo es crítico (`stock === 0` y prioridad `URGENT`) o `consolidateLowStockHours === 0`, dispara solicitud inmediata.
   - En operación normal (`consolidateLowStockHours === 24`), acumula los faltantes en el **Buffer de Consolidación de 24h** (`b2b_pending_consolidation` mediante `ctx.storage.setAlarm`), evitando emitir decenas de micro-órdenes y micro-facturas durante el día.
2. **Descubrimiento de Mejor Oferta en la Malla MCP:** Al cumplirse la ventana (o a petición del comprador), el nodo consulta `federation.b2b.findBestOffers({ gtin, qty, region, city })` evaluando precio escalonado por volumen, disponibilidad real y tiempo de entrega entre sus proveedores autorizados.
3. **Reserva Atómica y Manejo de Déficit (`-BACKORDER`):** El comprador firma y envía `B2B_PO_SUBMITTED`. El `BranchInventoryDO` de la distribuidora reserva el stock disponible; si hay déficit parcial, responde `B2B_PO_ACCEPTED` por lo reservado y opcionalmente `B2B_PO_BACKORDERED` según la política comercial acordada.
4. **Despacho con `e-POD` y Recepción `ASN` Sin Tipeo:** Cuando el chofer de la distribuidora despacha (`B2B_SHIPMENT_DISPATCHED`) incluyendo lotes GS1 y fechas de vencimiento, el nodo comprador crea automáticamente un **Aviso Anticipado de Recepción (`ASN`)** en estado `IN_TRANSIT`. Al capturar la firma `e-POD` en destino (`B2B_EPOD_CONFIRMED`), el encargado de tienda solo escanea las cajas para ingresar lotes, vencimientos y costos actualizados en segundos.

---

## 4. Flujo B: Marketplace en Tiempo Real y Super-Agente Comprador B2C

1. **Ingesta Asíncrona por Colas:** Los deltas de precio y disponibilidad pública publicados por los comercios viajan por `Cloudflare Queues` hacia `@shac/federation-hub`.
2. **Doble Indexación Global de Baja Latencia:**
   - **Relacional Exacta:** Base D1 en el Hub con **Read Replicas globales** para filtrado sub-10ms por ciudad, categoría, GTIN, rango de precio en unidades menores y retiro en tienda vs. envío.
   - **Semántica Multimodal:** Índice en **Cloudflare Vectorize** con embeddings `@cf/baai/bge-m3` generados en Workers AI para búsquedas en lenguaje natural desde la web o agentes MCP externos.
3. **Reserva Directa Pre-Cobro:** Antes de capturar el pago del comprador final, el Hub solicita un bloqueo temporal (`holdInventoryTTL`) contra el `BranchInventoryDO` de la sucursal vendedora, garantizando cero ventas de productos agotados en mostrador un segundo antes.
