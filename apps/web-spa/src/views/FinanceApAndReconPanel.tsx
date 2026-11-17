import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable, StatusBadge } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

interface FinanceApAndReconPanelProps {
  rpc: Phase2ViewProps['rpc'];
  tab: 'coa' | 'gl' | 'ap' | 'recon';
  accounts: Array<{ id: string; account_code: string; name: string; classification: string; normal_balance: string; current_balance_minor: number; currency: string }>;
  journalEntries: Array<{ id: string; entry_number: string; description: string; total_debit_minor: number; total_credit_minor: number; status: string }>;
  apBills: Array<{ id: string; bill_or_expense_no: string; category: string; currency: string; total_minor: number; balance_due_minor: number; status: string }>;
  reconciliations: Array<{ id: string; financial_account_id: string; statement_balance_minor: number; book_balance_minor: number; difference_minor: number; status: string }>;
  onFeedback: (msg: string) => void;
}

/** Sub-panel for Trial Balance (COA), General Ledger, AP Vendor Bills & Bank Reconciliation. */
export function FinanceApAndReconPanel({
  rpc, tab, accounts, journalEntries, apBills, reconciliations, onFeedback,
}: FinanceApAndReconPanelProps) {
  const queryClient = useQueryClient();
  const [accCode, setAccCode] = useState('1100-AR');
  const [accName, setAccName] = useState('Cuentas por Cobrar');
  const [accClass, setAccClass] = useState<'asset' | 'liability' | 'equity' | 'revenue' | 'expense'>('asset');
  const [accBalance, setAccBalance] = useState('0.00');
  const [billNo, setBillNo] = useState('BILL-2026-01');
  const [billCat, setBillCat] = useState('INVENTORY_SUPPLY');
  const [billTotal, setBillTotal] = useState('100.00');
  const [billPaid, setBillPaid] = useState('0.00');
  const [reconAcct, setReconAcct] = useState('acc_usd_main');
  const [stmtBal, setStmtBal] = useState('0.00');
  const [bookBal, setBookBal] = useState('0.00');

  const coaMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.finance.coa.$post({
        json: { accountCode: accCode, name: accName, classification: accClass, normalBalance: accClass === 'asset' || accClass === 'expense' ? 'debit' : 'credit', currentBalanceMinor: parseMajorToMinor(accBalance) },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] });
      onFeedback(`Cuenta ${accCode} actualizada en Plan de Cuentas.`);
    },
  });

  const billMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.finance['ap-bills'].$post({
        json: { billOrExpenseNo: billNo, category: billCat, totalMinor: parseMajorToMinor(billTotal), paidMinor: parseMajorToMinor(billPaid), currency: 'USD' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] });
      onFeedback(`Factura AP ${billNo} registrada (${d.status}).`);
    },
  });

  const reconMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.finance.reconciliations.$post({
        json: { financialAccountId: reconAcct, statementBalanceMinor: parseMajorToMinor(stmtBal), bookBalanceMinor: parseMajorToMinor(bookBal) },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] });
      onFeedback(`Conciliación ${reconAcct}: ${d.status} (Dif: ${formatMinorUnits(d.differenceMinor, 'USD')})`);
    },
  });

  if (tab === 'coa') {
    return (
      <div className="space-y-4">
        <form className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); coaMutation.mutate(); }}>
          <input placeholder="Código (1100-AR)" value={accCode} onChange={(e) => setAccCode(e.target.value)} className={`${INPUT_CLS} font-mono`} required />
          <input placeholder="Nombre cuenta" value={accName} onChange={(e) => setAccName(e.target.value)} className={INPUT_CLS} required />
          <select value={accClass} onChange={(e) => setAccClass(e.target.value as typeof accClass)} className={INPUT_CLS}>
            <option value="asset">Activo</option><option value="liability">Pasivo</option><option value="equity">Patrimonio</option><option value="revenue">Ingreso</option><option value="expense">Gasto</option>
          </select>
          <input placeholder="Saldo USD" value={accBalance} onChange={(e) => setAccBalance(e.target.value)} className={`${INPUT_CLS} font-mono`} />
          <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Guardar Cuenta</button>
        </form>
        <DataTable
          columns={[
            { id: 'code', header: 'Código', cell: (r) => <span className="font-mono text-xs font-semibold">{r.account_code}</span> },
            { id: 'name', header: 'Cuenta Contable', cell: (r) => r.name },
            { id: 'cls', header: 'Tipo', cell: (r) => <StatusBadge label={`${r.classification} · ${r.normal_balance}`} tone="info" /> },
            { id: 'bal', header: 'Saldo', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.current_balance_minor, r.currency)}</span> },
          ]}
          data={accounts}
          getRowId={(r) => r.id}
          emptyTitle="Sin cuentas en el Plan Contable"
        />
      </div>
    );
  }

  if (tab === 'gl') {
    return (
      <DataTable
        columns={[
          { id: 'no', header: 'Asiento', cell: (r) => <span className="font-mono text-xs">{r.entry_number}</span> },
          { id: 'desc', header: 'Descripción', cell: (r) => r.description },
          { id: 'deb', header: 'Débito', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.total_debit_minor, 'USD')}</span> },
          { id: 'cred', header: 'Crédito', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.total_credit_minor, 'USD')}</span> },
          { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> },
        ]}
        data={journalEntries}
        getRowId={(r) => r.id}
        emptyTitle="Sin asientos en Libro Mayor"
      />
    );
  }

  if (tab === 'ap') {
    return (
      <div className="space-y-4">
        <form className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); billMutation.mutate(); }}>
          <input placeholder="N° Factura" value={billNo} onChange={(e) => setBillNo(e.target.value)} className={`${INPUT_CLS} font-mono`} required />
          <input placeholder="Categoría" value={billCat} onChange={(e) => setBillCat(e.target.value)} className={INPUT_CLS} />
          <input placeholder="Total USD" value={billTotal} onChange={(e) => setBillTotal(e.target.value)} className={`${INPUT_CLS} font-mono`} required />
          <input placeholder="Abonado USD" value={billPaid} onChange={(e) => setBillPaid(e.target.value)} className={`${INPUT_CLS} font-mono`} />
          <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Registrar Bill AP</button>
        </form>
        <DataTable
          columns={[
            { id: 'no', header: 'Factura AP', cell: (r) => <span className="font-mono text-xs">{r.bill_or_expense_no}</span> },
            { id: 'cat', header: 'Categoría', cell: (r) => r.category },
            { id: 'tot', header: 'Total', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.total_minor, r.currency)}</span> },
            { id: 'due', header: 'Saldo Pendiente', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.balance_due_minor, r.currency)}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone={r.status === 'PAID' ? 'success' : 'warning'} /> },
          ]}
          data={apBills}
          getRowId={(r) => r.id}
          emptyTitle="Sin facturas por pagar (AP)"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); reconMutation.mutate(); }}>
        <input placeholder="Cuenta Bancaria" value={reconAcct} onChange={(e) => setReconAcct(e.target.value)} className={`${INPUT_CLS} font-mono`} required />
        <input placeholder="Saldo Banco USD" value={stmtBal} onChange={(e) => setStmtBal(e.target.value)} className={`${INPUT_CLS} font-mono`} required />
        <input placeholder="Saldo Libros USD" value={bookBal} onChange={(e) => setBookBal(e.target.value)} className={`${INPUT_CLS} font-mono`} required />
        <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Conciliar Banco</button>
      </form>
      <DataTable
        columns={[
          { id: 'acc', header: 'Cuenta', cell: (r) => <span className="font-mono text-xs">{r.financial_account_id}</span> },
          { id: 'stmt', header: 'Saldo Banco', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.statement_balance_minor, 'USD')}</span> },
          { id: 'book', header: 'Saldo Libros', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.book_balance_minor, 'USD')}</span> },
          { id: 'diff', header: 'Diferencia', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.difference_minor, 'USD')}</span> },
          { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone={r.status === 'RECONCILED' ? 'success' : 'warning'} /> },
        ]}
        data={reconciliations}
        getRowId={(r) => r.id}
        emptyTitle="Sin conciliaciones bancarias"
      />
    </div>
  );
}
