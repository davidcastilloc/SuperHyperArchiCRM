import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable, StatusBadge } from '@shac/ui';
import { GlJournalBuilder } from './GlJournalBuilder';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

interface FinanceApAndReconPanelProps {
  rpc: Phase2ViewProps['rpc'];
  tab: 'coa' | 'gl' | 'ap' | 'recon';
  accounts: Array<{ id: string; account_code: string; name: string; classification: string; normal_balance: string; current_balance_minor: number; currency: string }>;
  journalEntries: Array<{ id: string; entry_number: string; description: string; total_debit_minor: number; total_credit_minor: number; status: string }>;
  apBills: Array<{ id: string; bill_or_expense_no: string; vendorName?: string | null; category: string; currency: string; total_minor: number; balance_due_minor: number; due_date?: number | null; status: string }>;
  reconciliations: Array<{ id: string; financial_account_id: string; statement_balance_minor: number; book_balance_minor: number; difference_minor: number; status: string }>;
  parties: Array<{ id: string; displayName: string }>;
  finAccounts: Array<{ id: string; code: string; name: string; currency: string }>;
  trialBalanceTotals?: { totalDebitMinor: number; totalCreditMinor: number; balanced: boolean };
  onFeedback: (msg: string) => void;
  onError: (msg: string) => void;
}

/** Sub-panel for Trial Balance (COA), Multi-line GL, AP Vendor Bills & Bank Reconciliation. */
export function FinanceApAndReconPanel({
  rpc, tab, accounts, journalEntries, apBills, reconciliations, parties, finAccounts, trialBalanceTotals, onFeedback, onError,
}: FinanceApAndReconPanelProps) {
  const queryClient = useQueryClient();
  const [accCode, setAccCode] = useState('1100-AR');
  const [accName, setAccName] = useState('Cuentas por Cobrar');
  const [accClass, setAccClass] = useState<'asset' | 'liability' | 'equity' | 'revenue' | 'expense'>('asset');
  const [billNo, setBillNo] = useState('BILL-2026-01');
  const [vendorPartyId, setVendorPartyId] = useState('');
  const [dueDateStr, setDueDateStr] = useState('');
  const [billCat, setBillCat] = useState('INVENTORY_SUPPLY');
  const [billTotal, setBillTotal] = useState('100.00');
  const [billPaid, setBillPaid] = useState('0.00');
  const [reconAcct, setReconAcct] = useState(finAccounts[0]?.id ?? 'acc_usd_cash');
  const [stmtBal, setStmtBal] = useState('0.00');
  const [bookBal, setBookBal] = useState('0.00');

  const coaMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.finance.coa.$post({
        json: { accountCode: accCode, name: accName, classification: accClass, normalBalance: accClass === 'asset' || accClass === 'expense' ? 'debit' : 'credit' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] });
      onFeedback(`Cuenta ${accCode} registrada en Plan de Cuentas (saldo inicial $0.00; usa Asientos GL para movimientos).`);
    },
    onError: (err: Error) => onError(err.message),
  });

  const billMutation = useMutation({
    mutationFn: async () => {
      const dueAt = dueDateStr ? Math.floor(new Date(`${dueDateStr}T23:59:59Z`).getTime() / 1000) : undefined;
      const res = await rpc.api.finance['ap-bills'].$post({
        json: {
          billOrExpenseNo: billNo,
          vendorPartyId: vendorPartyId || parties[0]?.id || undefined,
          ...(dueAt && Number.isFinite(dueAt) ? { dueAt } : {}),
          category: billCat,
          totalMinor: parseMajorToMinor(billTotal),
          paidMinor: parseMajorToMinor(billPaid),
          currency: 'USD',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] });
      onFeedback(`Factura AP ${billNo} registrada (${d.status}).`);
    },
    onError: (err: Error) => onError(err.message),
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
    onError: (err: Error) => onError(err.message),
  });

  if (tab === 'coa') {
    return (
      <div className="space-y-4">
        <form className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); coaMutation.mutate(); }}>
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Código Cuenta</span><input value={accCode} onChange={(e) => setAccCode(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} required /></label>
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Nombre Contable</span><input value={accName} onChange={(e) => setAccName(e.target.value)} className={`${INPUT_CLS} w-full`} required /></label>
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Clasificación</span>
            <select value={accClass} onChange={(e) => setAccClass(e.target.value as typeof accClass)} className={`${INPUT_CLS} w-full`}>
              <option value="asset">Activo</option><option value="liability">Pasivo</option><option value="equity">Patrimonio</option><option value="revenue">Ingreso</option><option value="expense">Gasto</option>
            </select>
          </label>
          <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Crear Cuenta</button>
        </form>
        <DataTable
          columns={[
            { id: 'code', header: 'Código', cell: (r) => <span className="font-mono text-xs font-semibold">{r.account_code}</span> },
            { id: 'name', header: 'Cuenta Contable', cell: (r) => r.name },
            { id: 'cls', header: 'Tipo', cell: (r) => <StatusBadge label={`${r.classification} · ${r.normal_balance}`} tone="info" /> },
            { id: 'bal', header: 'Saldo', align: 'right', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.current_balance_minor, r.currency)}</span> },
          ]}
          data={accounts}
          getRowId={(r) => r.id}
          emptyTitle="Sin cuentas en el Plan Contable"
        />
        {trialBalanceTotals ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-4 py-2.5 font-mono text-xs tabular-nums">
            <span>Sumas Iguales · Balance de Comprobación</span>
            <div className="flex items-center gap-4">
              <span>Débito: <strong>{formatMinorUnits(trialBalanceTotals.totalDebitMinor, 'USD')}</strong></span>
              <span>Crédito: <strong>{formatMinorUnits(trialBalanceTotals.totalCreditMinor, 'USD')}</strong></span>
              <StatusBadge label={trialBalanceTotals.balanced ? 'CUADRADO' : 'DESCUADRE'} tone={trialBalanceTotals.balanced ? 'success' : 'error'} />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (tab === 'gl') {
    return (
      <div className="space-y-4">
        <GlJournalBuilder rpc={rpc} accounts={accounts} onSuccess={onFeedback} onError={onError} />
        <DataTable
          columns={[
            { id: 'no', header: 'Asiento', cell: (r) => <span className="font-mono text-xs">{r.entry_number}</span> },
            { id: 'desc', header: 'Descripción', cell: (r) => r.description },
            { id: 'deb', header: 'Débito', align: 'right', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.total_debit_minor, 'USD')}</span> },
            { id: 'cred', header: 'Crédito', align: 'right', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.total_credit_minor, 'USD')}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> },
          ]}
          data={journalEntries}
          getRowId={(r) => r.id}
          emptyTitle="Sin asientos publicados"
        />
      </div>
    );
  }

  if (tab === 'ap') {
    return (
      <div className="space-y-4">
        <form className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 sm:grid-cols-6" onSubmit={(e) => { e.preventDefault(); billMutation.mutate(); }}>
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">N° Factura</span><input value={billNo} onChange={(e) => setBillNo(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} required /></label>
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Proveedor</span>
            <select value={vendorPartyId || parties[0]?.id || ''} onChange={(e) => setVendorPartyId(e.target.value)} className={`${INPUT_CLS} w-full`}>
              <option value="">General</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Categoría</span><input value={billCat} onChange={(e) => setBillCat(e.target.value)} className={`${INPUT_CLS} w-full`} /></label>
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Total (USD)</span><input value={billTotal} onChange={(e) => setBillTotal(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} required /></label>
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Pagado / Venc.</span>
            <div className="flex gap-1"><input value={billPaid} onChange={(e) => setBillPaid(e.target.value)} className={`${INPUT_CLS} w-20 font-mono tabular-nums`} /><input type="date" value={dueDateStr} onChange={(e) => setDueDateStr(e.target.value)} className={`${INPUT_CLS} flex-1 font-mono text-[11px]`} /></div>
          </label>
          <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Registrar AP</button>
        </form>
        <DataTable
          columns={[
            { id: 'no', header: 'Factura AP', cell: (r) => <span className="font-mono text-xs">{r.bill_or_expense_no}</span> },
            { id: 'ven', header: 'Proveedor', cell: (r) => <span className="text-xs font-medium">{r.vendorName ?? 'General'}</span> },
            { id: 'cat', header: 'Categoría', cell: (r) => r.category },
            { id: 'due', header: 'Saldo Pendiente', align: 'right', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.balance_due_minor, r.currency)}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone={r.status === 'PAID' ? 'success' : 'warning'} /> },
          ]}
          data={apBills}
          getRowId={(r) => r.id}
          emptyTitle="Sin cuentas por pagar"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); reconMutation.mutate(); }}>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Cuenta Bancaria / Caja</span>
          <select value={reconAcct} onChange={(e) => setReconAcct(e.target.value)} className={`${INPUT_CLS} w-full font-mono`}>
            {finAccounts.length === 0 ? <option value="acc_usd_cash">acc_usd_cash · Caja USD</option> : null}
            {finAccounts.map((fa) => <option key={fa.id} value={fa.id}>{fa.code} · {fa.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Saldo Extracto (USD)</span><input value={stmtBal} onChange={(e) => setStmtBal(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} required /></label>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Saldo Libros GL (USD)</span><input value={bookBal} onChange={(e) => setBookBal(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} required /></label>
        <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Conciliar Banco</button>
      </form>
      <DataTable
        columns={[
          { id: 'acc', header: 'Cuenta', cell: (r) => <span className="font-mono text-xs">{r.financial_account_id}</span> },
          { id: 'st', header: 'Extracto', align: 'right', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.statement_balance_minor, 'USD')}</span> },
          { id: 'bk', header: 'Libros GL', align: 'right', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.book_balance_minor, 'USD')}</span> },
          { id: 'df', header: 'Diferencia', align: 'right', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.difference_minor, 'USD')}</span> },
          { id: 'res', header: 'Resultado', cell: (r) => <StatusBadge label={r.status} tone={r.status === 'RECONCILED' ? 'success' : 'error'} /> },
        ]}
        data={reconciliations}
        getRowId={(r) => r.id}
        emptyTitle="Sin conciliaciones bancarias"
      />
    </div>
  );
}
