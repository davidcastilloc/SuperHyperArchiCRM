import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import { authenticateWorkerActor, type HonoEnv } from './command-registry.js';

const CoaAccountSchema = z.object({
  accountCode: z.string().min(2).max(40),
  name: z.string().min(1).max(120),
  classification: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']).default('asset'),
  normalBalance: z.enum(['debit', 'credit']).default('debit'),
  currentBalanceMinor: z.number().int().default(0),
});

const ApBillSchema = z.object({
  billOrExpenseNo: z.string().min(1).max(64),
  category: z.string().min(1).max(64).default('OPERATING'),
  totalMinor: z.number().int().nonnegative(),
  paidMinor: z.number().int().nonnegative().default(0),
  currency: z.string().length(3).default('USD'),
});

const ReconSchema = z.object({
  financialAccountId: z.string().min(1).max(64),
  statementBalanceMinor: z.number().int(),
  bookBalanceMinor: z.number().int(),
});

/** Mounts Full GAAP Accounting Suite: Chart of Accounts / Trial Balance, GL Journal, AP Bills & Bank Reconciliation. */
export function createFinanceGaapRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .get('/finance/overview', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'finance', 'finance.journal.read');
      const [coaRes, jeRes, apRes, reconRes, trustRes] = await c.env.DB.batch([
        c.env.DB.prepare(
          `SELECT id, account_code, name, classification, normal_balance, current_balance_minor, currency
           FROM fin_chart_of_accounts_and_periods
           WHERE tenant_id = ?1 AND record_kind = 'gl_account' AND deleted_at IS NULL
           ORDER BY account_code ASC LIMIT 100`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, entry_number, entry_date, description, total_debit_minor, total_credit_minor, status
           FROM fin_journal_entries WHERE tenant_id = ?1 AND deleted_at IS NULL
           ORDER BY entry_date DESC LIMIT 50`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, bill_or_expense_no, category, currency, total_minor, paid_minor, balance_due_minor, status, issue_date
           FROM fin_ap_bills_and_expenses WHERE tenant_id = ?1 AND deleted_at IS NULL
           ORDER BY issue_date DESC LIMIT 50`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, financial_account_id, statement_date, statement_balance_minor, book_balance_minor, difference_minor, status
           FROM fin_bank_reconciliations WHERE tenant_id = ?1 AND deleted_at IS NULL
           ORDER BY statement_date DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
        c.env.DB.prepare(
          `SELECT id, party_id, matter_or_lease_id, currency, balance_minor, status
           FROM fin_trust_escrow_ledgers WHERE tenant_id = ?1 AND deleted_at IS NULL
           ORDER BY updated_at DESC LIMIT 40`,
        ).bind(auth.actor.tenantId),
      ]);
      return c.json({
        accounts: coaRes?.results ?? [],
        journalEntries: jeRes?.results ?? [],
        apBills: apRes?.results ?? [],
        reconciliations: reconRes?.results ?? [],
        trustLedgers: trustRes?.results ?? [],
      });
    })
    .post('/finance/coa', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'finance', 'finance.journal.write');
      const parsed = CoaAccountSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid COA account', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO fin_chart_of_accounts_and_periods
          (id, tenant_id, org_id, record_kind, account_code, name, classification, normal_balance, current_balance_minor, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'gl_account', ?4, ?5, ?6, ?7, ?8, ?9, ?9)
         ON CONFLICT(tenant_id, record_kind, account_code) DO UPDATE SET
           name = excluded.name, classification = excluded.classification, normal_balance = excluded.normal_balance,
           current_balance_minor = excluded.current_balance_minor, updated_at = excluded.updated_at`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.accountCode.trim().toUpperCase(), d.name.trim(), d.classification, d.normalBalance, d.currentBalanceMinor, nowSec).run();
      return c.json({ ok: true, id, ...d }, 201);
    })
    .post('/finance/ap-bills', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'finance', 'finance.journal.write');
      const parsed = ApBillSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid AP bill payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      const balanceDueMinor = Math.max(0, d.totalMinor - d.paidMinor);
      const status = balanceDueMinor === 0 ? 'PAID' : d.paidMinor > 0 ? 'PARTIAL' : 'OPEN';
      await c.env.DB.prepare(
        `INSERT INTO fin_ap_bills_and_expenses
          (id, tenant_id, org_id, record_kind, bill_or_expense_no, category, currency, subtotal_minor, total_minor, paid_minor, balance_due_minor, issue_date, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'vendor_bill', ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?10, ?11, ?10, ?10)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.billOrExpenseNo.trim(), d.category, d.currency, d.totalMinor, d.paidMinor, balanceDueMinor, nowSec, status).run();
      return c.json({ ok: true, id, balanceDueMinor, status }, 201);
    })
    .post('/finance/reconciliations', async (c) => {
      const auth = await authenticateWorkerActor(c.env, c.req.raw.headers, profileLoader, 'finance', 'finance.journal.write');
      const parsed = ReconSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 400, 'Invalid reconciliation payload', parsed.error.flatten());
      const d = parsed.data;
      const id = crypto.randomUUID();
      const nowSec = Math.floor(Date.now() / 1000);
      const differenceMinor = d.statementBalanceMinor - d.bookBalanceMinor;
      const status = differenceMinor === 0 ? 'RECONCILED' : 'DISCREPANCY';
      await c.env.DB.prepare(
        `INSERT INTO fin_bank_reconciliations
          (id, tenant_id, org_id, financial_account_id, statement_date, statement_balance_minor, book_balance_minor, difference_minor, reconciled_by_user_id, completed_at, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?5, ?10, ?5, ?5)`,
      ).bind(id, auth.actor.tenantId, auth.actor.orgId, d.financialAccountId.trim(), nowSec, d.statementBalanceMinor, d.bookBalanceMinor, differenceMinor, auth.actor.id || 'usr_cfo', status).run();
      return c.json({ ok: true, id, differenceMinor, status }, 201);
    });
}
