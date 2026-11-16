import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const hubNodes = sqliteTable(
  'hub_nodes',
  {
    did: text('did').primaryKey(),
    deploymentId: text('deployment_id').notNull(),
    companyName: text('company_name').notNull(),
    region: text('region').notNull(),
    city: text('city').notNull(),
    publicKeyJwk: text('public_key_jwk').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('hub_nodes_deployment_idx').on(t.deploymentId),
    index('hub_nodes_region_city_idx').on(t.region, t.city, t.status),
  ],
);

export const hubPublicOffers = sqliteTable(
  'hub_public_offers',
  {
    id: text('id').primaryKey(),
    supplierDid: text('supplier_did').notNull(),
    gtin: text('gtin').notNull(),
    supplierSku: text('supplier_sku').notNull(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    city: text('city').notNull(),
    region: text('region').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    minOrderQty: integer('min_order_qty').notNull().default(1),
    uomFactorMicros: integer('uom_factor_micros').notNull().default(1_000_000),
    availableQty: integer('available_qty').notNull().default(0),
    deliveryHours: integer('delivery_hours').notNull().default(24),
    isActive: integer('is_active').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('hub_public_offers_gtin_idx').on(t.gtin, t.isActive, t.unitPriceMinor),
    index('hub_public_offers_supplier_sku_idx').on(t.supplierDid, t.supplierSku),
    index('hub_public_offers_market_idx').on(t.city, t.category, t.isActive),
  ],
);

export const hubEnvelopesIdempotency = sqliteTable(
  'hub_envelopes_idempotency',
  {
    envelopeId: text('envelope_id').primaryKey(),
    senderDid: text('sender_did').notNull(),
    eventType: text('event_type').notNull(),
    payloadHash: text('payload_hash').notNull(),
    responseJson: text('response_json').notNull(),
    processedAt: text('processed_at').notNull(),
  },
  (t) => [index('hub_envelopes_sender_idx').on(t.senderDid, t.processedAt)],
);

export const hubB2bOrders = sqliteTable(
  'hub_b2b_orders',
  {
    id: text('id').primaryKey(),
    poNumber: text('po_number').notNull(),
    buyerDid: text('buyer_did').notNull(),
    supplierDid: text('supplier_did').notNull(),
    status: text('status').notNull(),
    itemsJson: text('items_json').notNull(),
    totalMinor: integer('total_minor').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('hub_b2b_orders_buyer_idx').on(t.buyerDid, t.updatedAt),
    index('hub_b2b_orders_supplier_idx').on(t.supplierDid, t.updatedAt),
  ],
);

export const hubInventoryHolds = sqliteTable(
  'hub_inventory_holds',
  {
    holdId: text('hold_id').primaryKey(),
    offerId: text('offer_id').notNull(),
    buyerRef: text('buyer_ref').notNull(),
    qty: integer('qty').notNull(),
    expiresAt: integer('expires_at').notNull(),
    status: text('status').notNull().default('HELD'),
  },
  (t) => [index('hub_inventory_holds_offer_idx').on(t.offerId, t.status, t.expiresAt)],
);
