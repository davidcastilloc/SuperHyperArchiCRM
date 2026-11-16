import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const crmParties = sqliteTable(
  'crm_parties',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    partyKind: text('party_kind').notNull().default('person'),
    rolesMaskJson: text('roles_mask_json').notNull().default('["customer"]'),
    displayName: text('display_name').notNull(),
    legalName: text('legal_name'),
    firstName: text('first_name'),
    middleName: text('middle_name'),
    lastName: text('last_name'),
    secondLastName: text('second_last_name'),
    nationality: text('nationality'),
    taxIdType: text('tax_id_type'),
    taxIdNumber: text('tax_id_number'),
    taxIdHash: text('tax_id_hash'),
    primaryEmail: text('primary_email'),
    emailHash: text('email_hash'),
    primaryPhone: text('primary_phone'),
    secondaryPhone: text('secondary_phone'),
    portalUserId: text('portal_user_id'),
    ownerUserId: text('owner_user_id'),
    lifecycleStage: text('lifecycle_stage').notNull().default('active'),
    leadSource: text('lead_source'),
    temperature: text('temperature'),
    vipStatus: text('vip_status').notNull().default('standard'),
    loyaltyPoints: integer('loyalty_points').notNull().default(0),
    creditLimitMinor: integer('credit_limit_minor').notNull().default(0),
    preferredCurrency: text('preferred_currency').notNull().default('USD'),
    paymentTermsCode: text('payment_terms_code'),
    is1099Vendor: integer('is_1099_vendor', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('crm_parties_tenant_org_idx').on(t.tenantId, t.orgId),
    index('crm_parties_tenant_tax_hash_idx').on(t.tenantId, t.taxIdHash),
    index('crm_parties_tenant_email_hash_idx').on(t.tenantId, t.emailHash),
    index('crm_parties_tenant_display_name_idx').on(t.tenantId, t.displayName),
  ],
);

export const crmPartyProfiles = sqliteTable(
  'crm_party_profiles',
  {
    partyId: text('party_id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    birthDate: text('birth_date'),
    gender: text('gender'),
    maritalStatus: text('marital_status'),
    preferredLanguage: text('preferred_language'),
    occupation: text('occupation'),
    employerName: text('employer_name'),
    annualIncomeMinor: integer('annual_income_minor'),
    screeningScore: integer('screening_score'),
    mrnCode: text('mrn_code'),
    guestPreferencesJson: text('guest_preferences_json').notNull().default('{}'),
    totalStays: integer('total_stays').notNull().default(0),
    totalSpentMinor: integer('total_spent_minor').notNull().default(0),
    hasEvictions: integer('has_evictions', { mode: 'boolean' }).notNull().default(false),
    agreedCreditCheck: integer('agreed_credit_check', { mode: 'boolean' })
      .notNull()
      .default(false),
    kycVerifiedAt: integer('kyc_verified_at'),
    kycDocumentUrlsJson: text('kyc_document_urls_json').notNull().default('[]'),
    notes: text('notes'),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('crm_party_profiles_tenant_mrn_idx').on(t.tenantId, t.mrnCode)],
);

export const crmPartyLinks = sqliteTable(
  'crm_party_links',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    fromPartyId: text('from_party_id').notNull(),
    toPartyId: text('to_party_id').notNull(),
    linkType: text('link_type').notNull(),
    roleTitle: text('role_title'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    canViewRecords: integer('can_view_records', { mode: 'boolean' })
      .notNull()
      .default(false),
    canJoinTelehealth: integer('can_join_telehealth', { mode: 'boolean' })
      .notNull()
      .default(false),
    sharePercentageBps: integer('share_percentage_bps').notNull().default(0),
    commercialTermsJson: text('commercial_terms_json').notNull().default('{}'),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('crm_party_links_tenant_from_idx').on(t.tenantId, t.fromPartyId),
    index('crm_party_links_tenant_to_idx').on(t.tenantId, t.toPartyId),
    uniqueIndex('crm_party_links_tenant_pair_type_uniq').on(
      t.tenantId,
      t.fromPartyId,
      t.toPartyId,
      t.linkType,
    ),
  ],
);

export const crmPartyAddresses = sqliteTable(
  'crm_party_addresses',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    partyId: text('party_id').notNull(),
    purpose: text('purpose').notNull().default('billing'),
    label: text('label'),
    line1: text('line1').notNull(),
    line2: text('line2'),
    buildingNo: text('building_no'),
    flatNo: text('flat_no'),
    city: text('city').notNull(),
    stateRegion: text('state_region'),
    postalCode: text('postal_code'),
    countryCode: text('country_code').notNull(),
    latitude: real('latitude'),
    longitude: real('longitude'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('crm_party_addresses_tenant_party_idx').on(t.tenantId, t.partyId)],
);

export const crmGroupsAndTerms = sqliteTable(
  'crm_groups_and_terms',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    orgId: text('org_id').notNull(),
    parentId: text('parent_id'),
    code: text('code').notNull(),
    name: text('name').notNull(),
    groupKind: text('group_kind').notNull().default('b2c'),
    priority: integer('priority').notNull().default(100),
    priceListId: text('price_list_id'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(0),
    defaultCreditLimitMinor: integer('default_credit_limit_minor').notNull().default(0),
    maxRepDiscountBps: integer('max_rep_discount_bps').notNull().default(0),
    allowBelowCost: integer('allow_below_cost', { mode: 'boolean' })
      .notNull()
      .default(false),
    autoInvoiceOnDelivery: integer('auto_invoice_on_delivery', { mode: 'boolean' })
      .notNull()
      .default(false),
    assortmentScopeJson: text('assortment_scope_json').notNull().default('{}'),
    customFields: text('custom_fields').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('crm_groups_tenant_code_uniq').on(t.tenantId, t.code),
    index('crm_groups_tenant_org_kind_idx').on(t.tenantId, t.orgId, t.groupKind),
  ],
);

export const crmGroupMemberships = sqliteTable(
  'crm_group_memberships',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    groupId: text('group_id').notNull(),
    partyId: text('party_id').notNull(),
    source: text('source').notNull().default('manual'),
    validFrom: integer('valid_from'),
    validUntil: integer('valid_until'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('crm_group_memberships_tenant_group_party_uniq').on(
      t.tenantId,
      t.groupId,
      t.partyId,
    ),
    index('crm_group_memberships_tenant_party_idx').on(t.tenantId, t.partyId),
  ],
);
