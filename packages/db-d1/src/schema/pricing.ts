import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const catPriceHistoryOmnibus = sqliteTable(
  'cat_price_history_omnibus',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    productId: text('product_id').notNull(),
    variantId: text('variant_id'),
    currency: text('currency').notNull().default('USD'),
    priceMinor: integer('price_minor').notNull(),
    lowest30dMinor: integer('lowest_30d_minor').notNull(),
    changeSource: text('change_source').notNull().default('manual'),
    recordedAt: integer('recorded_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('cat_price_history_tenant_product_rec_idx').on(
      t.tenantId,
      t.productId,
      t.recordedAt,
    ),
  ],
);

export const catPromotionsAndCoupons = sqliteTable(
  'cat_promotions_and_coupons',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    priority: integer('priority').notNull().default(100),
    isCumulative: integer('is_cumulative', { mode: 'boolean' }).notNull().default(false),
    maxBudgetMinor: integer('max_budget_minor'),
    consumedBudgetMinor: integer('consumed_budget_minor').notNull().default(0),
    rulesTreeJson: text('rules_tree_json').notNull().default('{}'),
    benefitsJson: text('benefits_json').notNull().default('{}'),
    couponPrefix: text('coupon_prefix'),
    couponCode: text('coupon_code'),
    maxUses: integer('max_uses'),
    maxUsesPerParty: integer('max_uses_per_party'),
    usedCount: integer('used_count').notNull().default(0),
    startsAt: integer('starts_at'),
    endsAt: integer('ends_at'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('cat_promotions_tenant_org_active_idx').on(t.tenantId, t.orgId, t.isActive),
    index('cat_promotions_tenant_coupon_idx').on(t.tenantId, t.couponCode),
  ],
);

export const catCouponUsagesAndLocks = sqliteTable(
  'cat_coupon_usages_and_locks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    promotionId: text('promotion_id').notNull(),
    codeString: text('code_string').notNull(),
    cartId: text('cart_id'),
    orderId: text('order_id'),
    partyId: text('party_id'),
    discountAppliedMinor: integer('discount_applied_minor').notNull().default(0),
    status: text('status').notNull().default('reserved'),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('cat_coupon_usages_tenant_promo_idx').on(t.tenantId, t.promotionId),
    index('cat_coupon_usages_tenant_code_idx').on(t.tenantId, t.codeString),
  ],
);

export const catCurrenciesAndRates = sqliteTable(
  'cat_currencies_and_rates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    fromCurrency: text('from_currency').notNull(),
    toCurrency: text('to_currency').notNull(),
    rateMicros: integer('rate_micros').notNull(),
    buyRateMicros: integer('buy_rate_micros'),
    sellRateMicros: integer('sell_rate_micros'),
    source: text('source').notNull().default('BCV'),
    effectiveAt: integer('effective_at').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('cat_rates_tenant_pair_eff_idx').on(
      t.tenantId,
      t.fromCurrency,
      t.toCurrency,
      t.effectiveAt,
    ),
    index('cat_rates_tenant_org_active_idx').on(t.tenantId, t.orgId, t.isActive),
  ],
);

export const catLabelPrintBatches = sqliteTable(
  'cat_label_print_batches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    templateCode: text('template_code').notNull().default('THERMAL_28x18'),
    rateMicrosSnapshot: integer('rate_micros_snapshot').notNull(),
    secondaryCurrency: text('secondary_currency').notNull().default('VES'),
    itemsJson: text('items_json').notNull().default('[]'),
    printedByUserId: text('printed_by_user_id').notNull(),
    printedAt: integer('printed_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('cat_label_batches_tenant_org_printed_idx').on(
      t.tenantId,
      t.orgId,
      t.printedAt,
    ),
  ],
);
