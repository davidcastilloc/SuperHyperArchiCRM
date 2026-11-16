import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const baseCols = () => ({
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  orgId: text('org_id').notNull(),
});

const tailCols = () => ({
  customFields: text('custom_fields').notNull().default('{}'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export const finTrustEscrowLedgers = sqliteTable(
  'fin_trust_escrow_ledgers',
  {
    ...baseCols(),
    ledgerKind: text('ledger_kind').notNull().default('legal_iolta_trust'),
    partyId: text('party_id').notNull(),
    matterOrLeaseId: text('matter_or_lease_id').notNull(),
    bankAccountId: text('bank_account_id').notNull(),
    currency: text('currency').notNull().default('USD'),
    balanceMinor: integer('balance_minor').notNull().default(0),
    transactionsJson: text('transactions_json').notNull().default('[]'),
    status: text('status').notNull().default('ACTIVE'),
    ...tailCols(),
  },
  (t) => [
    check('fin_trust_balance_non_negative', sql`${t.balanceMinor} >= 0`),
    index('fin_trust_tenant_org_kind_idx').on(t.tenantId, t.orgId, t.ledgerKind),
    index('fin_trust_tenant_party_idx').on(t.tenantId, t.partyId),
    index('fin_trust_tenant_ref_idx').on(t.tenantId, t.matterOrLeaseId),
  ],
);

export const finChartOfAccountsAndPeriods = sqliteTable(
  'fin_chart_of_accounts_and_periods',
  {
    ...baseCols(),
    recordKind: text('record_kind').notNull().default('gl_account'),
    accountCode: text('account_code').notNull(),
    name: text('name').notNull(),
    classification: text('classification').notNull().default('asset'),
    normalBalance: text('normal_balance').notNull().default('debit'),
    parentId: text('parent_id'),
    currency: text('currency').notNull().default('USD'),
    currentBalanceMinor: integer('current_balance_minor').notNull().default(0),
    fiscalYear: integer('fiscal_year'),
    periodNumber: integer('period_number'),
    startDate: integer('start_date'),
    endDate: integer('end_date'),
    isClosed: integer('is_closed', { mode: 'boolean' }).notNull().default(false),
    ...tailCols(),
  },
  (t) => [
    uniqueIndex('fin_coa_tenant_code_uniq').on(t.tenantId, t.recordKind, t.accountCode),
    index('fin_coa_tenant_org_class_idx').on(t.tenantId, t.orgId, t.classification),
  ],
);

export const finJournalEntries = sqliteTable(
  'fin_journal_entries',
  {
    ...baseCols(),
    entryNumber: text('entry_number').notNull(),
    entryDate: integer('entry_date').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    fiscalPeriod: integer('fiscal_period').notNull(),
    sourceModule: text('source_module').notNull().default('finance'),
    sourceRecordId: text('source_record_id'),
    reference: text('reference'),
    description: text('description').notNull(),
    linesJson: text('lines_json').notNull().default('[]'),
    totalDebitMinor: integer('total_debit_minor').notNull().default(0),
    totalCreditMinor: integer('total_credit_minor').notNull().default(0),
    status: text('status').notNull().default('draft'),
    postedByUserId: text('posted_by_user_id'),
    ...tailCols(),
  },
  (t) => [
    uniqueIndex('fin_je_tenant_number_uniq').on(t.tenantId, t.entryNumber),
    index('fin_je_tenant_org_period_idx').on(t.tenantId, t.orgId, t.fiscalYear, t.fiscalPeriod),
    index('fin_je_tenant_status_idx').on(t.tenantId, t.status),
  ],
);

export const finApBillsAndExpenses = sqliteTable(
  'fin_ap_bills_and_expenses',
  {
    ...baseCols(),
    recordKind: text('record_kind').notNull().default('vendor_bill'),
    billOrExpenseNo: text('bill_or_expense_no').notNull(),
    vendorPartyId: text('vendor_party_id'),
    category: text('category').notNull().default('OPERATING'),
    currency: text('currency').notNull().default('USD'),
    subtotalMinor: integer('subtotal_minor').notNull().default(0),
    taxMinor: integer('tax_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull().default(0),
    paidMinor: integer('paid_minor').notNull().default(0),
    balanceDueMinor: integer('balance_due_minor').notNull().default(0),
    issueDate: integer('issue_date').notNull(),
    dueDate: integer('due_date'),
    recurrenceFreq: text('recurrence_freq'),
    nextRunDate: integer('next_run_date'),
    isReimbursable: integer('is_reimbursable', { mode: 'boolean' }).notNull().default(false),
    receiptR2Key: text('receipt_r2_key'),
    linesJson: text('lines_json').notNull().default('[]'),
    approvedByUserId: text('approved_by_user_id'),
    status: text('status').notNull().default('DRAFT'),
    ...tailCols(),
  },
  (t) => [
    uniqueIndex('fin_ap_tenant_no_uniq').on(t.tenantId, t.billOrExpenseNo),
    index('fin_ap_tenant_org_status_idx').on(t.tenantId, t.orgId, t.status),
  ],
);

export const finBankReconciliations = sqliteTable(
  'fin_bank_reconciliations',
  {
    ...baseCols(),
    financialAccountId: text('financial_account_id').notNull(),
    statementDate: integer('statement_date').notNull(),
    statementBalanceMinor: integer('statement_balance_minor').notNull().default(0),
    bookBalanceMinor: integer('book_balance_minor').notNull().default(0),
    differenceMinor: integer('difference_minor').notNull().default(0),
    matchedTxIdsJson: text('matched_tx_ids_json').notNull().default('[]'),
    reconciledByUserId: text('reconciled_by_user_id'),
    completedAt: integer('completed_at'),
    status: text('status').notNull().default('IN_PROGRESS'),
    ...tailCols(),
  },
  (t) => [
    index('fin_recon_tenant_acct_idx').on(t.tenantId, t.financialAccountId, t.statementDate),
  ],
);

export const finFixedAssetsAndBudgets = sqliteTable(
  'fin_fixed_assets_and_budgets',
  {
    ...baseCols(),
    recordKind: text('record_kind').notNull().default('fixed_asset'),
    codeOrTag: text('code_or_tag').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull().default('EQUIPMENT'),
    serialNumber: text('serial_number'),
    acquisitionDate: integer('acquisition_date'),
    acquisitionCostMinor: integer('acquisition_cost_minor').notNull().default(0),
    salvageValueMinor: integer('salvage_value_minor').notNull().default(0),
    usefulLifeMonths: integer('useful_life_months').notNull().default(36),
    depreciationMethod: text('depreciation_method').notNull().default('straight_line'),
    accumulatedDepreciationMinor: integer('accumulated_depreciation_minor').notNull().default(0),
    fiscalYear: integer('fiscal_year'),
    monthlyBudgetMinorJson: text('monthly_budget_minor_json').notNull().default('[]'),
    actualSpentMinor: integer('actual_spent_minor').notNull().default(0),
    status: text('status').notNull().default('ACTIVE'),
    ...tailCols(),
  },
  (t) => [
    uniqueIndex('fin_assets_tenant_code_uniq').on(t.tenantId, t.recordKind, t.codeOrTag),
    index('fin_assets_tenant_org_status_idx').on(t.tenantId, t.orgId, t.status),
  ],
);
