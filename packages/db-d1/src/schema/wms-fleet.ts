import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const wmsReorderingAndPutawayRules = sqliteTable(
  'wms_reordering_and_putaway_rules',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    ruleKind: text('rule_kind').notNull().default('reorder_minmax'),
    warehouseId: text('warehouse_id').notNull(),
    productId: text('product_id'),
    categoryId: text('category_id'),
    targetLocationId: text('target_location_id'),
    minQtyMicros: integer('min_qty_micros').notNull().default(0),
    maxQtyMicros: integer('max_qty_micros').notNull().default(0),
    multipleQtyMicros: integer('multiple_qty_micros').notNull().default(1_000_000),
    leadTimeDays: integer('lead_time_days').notNull().default(0),
    preferredSupplierPartyId: text('preferred_supplier_party_id'),
    preferredSupplierDid: text('preferred_supplier_did'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('wms_rules_tenant_org_kind_idx').on(t.tenantId, t.orgId, t.ruleKind),
    index('wms_rules_tenant_warehouse_prod_idx').on(
      t.tenantId,
      t.warehouseId,
      t.productId,
    ),
  ],
);

export const wmsQcAndCycleCounts = sqliteTable(
  'wms_qc_and_cycle_counts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    recordKind: text('record_kind').notNull().default('quality_check'),
    warehouseId: text('warehouse_id').notNull(),
    locationId: text('location_id'),
    pickingId: text('picking_id'),
    productId: text('product_id'),
    lotId: text('lot_id'),
    abcClass: text('abc_class'),
    measuredValue: integer('measured_value'),
    normMin: integer('norm_min'),
    normMax: integer('norm_max'),
    itemsVarianceJson: text('items_variance_json').notNull().default('[]'),
    status: text('status').notNull().default('draft'),
    evidenceUrlsJson: text('evidence_urls_json').notNull().default('[]'),
    inspectorUserId: text('inspector_user_id'),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('wms_qc_tenant_org_kind_status_idx').on(
      t.tenantId,
      t.orgId,
      t.recordKind,
      t.status,
    ),
    index('wms_qc_tenant_picking_idx').on(t.tenantId, t.pickingId),
  ],
);

export const wmsPurchaseOrders = sqliteTable(
  'wms_purchase_orders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    poNumber: text('po_number').notNull(),
    supplierPartyId: text('supplier_party_id').notNull(),
    warehouseId: text('warehouse_id').notNull(),
    currency: text('currency').notNull().default('USD'),
    itemsJson: text('items_json').notNull().default('[]'),
    subtotalMinor: integer('subtotal_minor').notNull().default(0),
    taxMinor: integer('tax_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull().default(0),
    expectedAt: integer('expected_at'),
    receivedAt: integer('received_at'),
    orderedByUserId: text('ordered_by_user_id'),
    status: text('status').notNull().default('draft'),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('wms_purchase_orders_tenant_number_uniq').on(t.tenantId, t.poNumber),
    index('wms_purchase_orders_tenant_org_status_idx').on(
      t.tenantId,
      t.orgId,
      t.status,
    ),
    index('wms_purchase_orders_tenant_supplier_idx').on(
      t.tenantId,
      t.supplierPartyId,
    ),
  ],
);

export const wmsStockRequestsAndChat = sqliteTable(
  'wms_stock_requests_and_chat',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    requestingOrgId: text('requesting_org_id').notNull(),
    fulfillingOrgId: text('fulfilling_org_id').notNull(),
    priority: text('priority').notNull().default('normal'),
    crossDockReady: integer('cross_dock_ready', { mode: 'boolean' })
      .notNull()
      .default(false),
    itemsJson: text('items_json').notNull().default('[]'),
    messagesJson: text('messages_json').notNull().default('[]'),
    convertedOrderId: text('converted_order_id'),
    status: text('status').notNull().default('requested'),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('wms_stock_req_tenant_req_org_idx').on(
      t.tenantId,
      t.requestingOrgId,
      t.status,
    ),
    index('wms_stock_req_tenant_ful_org_idx').on(
      t.tenantId,
      t.fulfillingOrgId,
      t.status,
    ),
  ],
);

export const wmsFleetAndDeliveries = sqliteTable(
  'wms_fleet_and_deliveries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    recordKind: text('record_kind').notNull().default('delivery_trip'),
    vehicleCode: text('vehicle_code'),
    licensePlate: text('license_plate'),
    maxPallets: integer('max_pallets'),
    maxWeightGrams: integer('max_weight_grams'),
    isRefrigerated: integer('is_refrigerated', { mode: 'boolean' })
      .notNull()
      .default(false),
    driverStaffId: text('driver_staff_id'),
    orderId: text('order_id'),
    originCoordsJson: text('origin_coords_json').notNull().default('{}'),
    destCoordsJson: text('dest_coords_json').notNull().default('{}'),
    gpsBreadcrumbsJson: text('gps_breadcrumbs_json').notNull().default('[]'),
    departedAt: integer('departed_at'),
    arrivedAt: integer('arrived_at'),
    epodRecipientName: text('epod_recipient_name'),
    epodSignatureSvg: text('epod_signature_svg'),
    epodPhotoR2Key: text('epod_photo_r2_key'),
    epodLat: real('epod_lat'),
    epodLng: real('epod_lng'),
    autoRestocked: integer('auto_restocked', { mode: 'boolean' })
      .notNull()
      .default(false),
    autoInvoiced: integer('auto_invoiced', { mode: 'boolean' })
      .notNull()
      .default(false),
    status: text('status').notNull().default('available'),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('wms_fleet_tenant_org_kind_idx').on(t.tenantId, t.orgId, t.recordKind),
    index('wms_fleet_tenant_vehicle_code_idx').on(t.tenantId, t.vehicleCode),
    index('wms_fleet_tenant_order_idx').on(t.tenantId, t.orderId),
  ],
);
