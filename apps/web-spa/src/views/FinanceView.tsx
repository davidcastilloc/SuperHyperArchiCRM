import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenCheck, Landmark, Receipt, Scale, ShieldCheck, Table2 } from 'lucide-react';
import { AiCopilotBanner, DataTable, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { useMarketProfile } from '../lib/marketProfile';
import { FinanceApAndReconPanel } from './FinanceApAndReconPanel';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

type FinanceTab = 'trust' | 'coa' | 'gl' | 'ap' | 'recon';

/** Full GAAP Accounting Suite: Trust/Escrow table, Trial Balance, Multi-line GL, AP Vendors & Bank Recon. */
export function FinanceView({ rpc, vocabulary }: Phase2ViewProps) {
  const profile = useMarketProfile();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<FinanceTab>('trust');
  const [ledgerId, setLedgerId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [matterId, setMatterId] = useState('mat_1');
  const [bankId, setBankId] = useState('acc_usd_cash');
  const [amountMajor, setAmountMajor] = useState('100.00');
  const [txKind, setTxKind] = useState<'DEPOSIT' | 'DISBURSEMENT'>('DEPOSIT');
  const [lastBalanceMinor, setLastBalanceMinor] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [aiReply, setAiReply] = useState<string | null>(null);

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'finance-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const overviewQuery = useQuery({
    queryKey: ['finance', 'overview'],
    queryFn: async () => {
      const res = await rpc.api.finance.overview.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const parties = partiesQuery.data?.items ?? [];
  const activePartyId = partyId || parties[0]?.id || '';
  const isLegal = profile.editionPreset === 'legal-psa';
  const trustLabel = isLegal ? 'Trust IOLTA' : 'Custodia & Escrow';

  const trustMutation = useMutation({
    mutationFn: async () => {
      if (!activePartyId) throw new Error(`Registra primero un ${vocabulary.partySingular.toLowerCase()} en Directorio.`);
      const amountMinor = Math.max(1, parseMajorToMinor(amountMajor));
      const res = await rpc.api.finance.trust.transact.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          ...(ledgerId.trim() ? { ledgerId: ledgerId.trim() } : {}),
          ledgerKind: isLegal ? 'legal_iolta_trust' : 'property_escrow',
          partyId: activePartyId.trim(),
          matterOrLeaseId: matterId.trim() || 'general',
          bankAccountId: bankId.trim() || 'acc_usd_cash',
          currency: 'USD',
          txKind,
          amountMinor,
          description: `${txKind} ${trustLabel}`,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setErrorMsg(null);
      setLedgerId(data.ledgerId);
      setLastBalanceMinor(data.balanceMinor);
      void queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] });
      setFeedback(`Ledger ${data.ledgerId} · ${data.txKind} ${formatMinorUnits(data.amountMinor, data.currency)} · Saldo: ${formatMinorUnits(data.balanceMinor, data.currency)}`);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await rpc.api.automation['ai-chat'].$post({ json: { prompt } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => { setErrorMsg(null); setAiReply(d.reply); },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const accounts = (overviewQuery.data?.accounts ?? []) as Array<{ id: string; account_code: string; name: string; classification: string; normal_balance: string; current_balance_minor: number; currency: string }>;
  const journalEntries = (overviewQuery.data?.journalEntries ?? []) as Array<{ id: string; entry_number: string; description: string; total_debit_minor: number; total_credit_minor: number; status: string }>;
  const apBills = (overviewQuery.data?.apBills ?? []) as Array<{ id: string; bill_or_expense_no: string; vendorName?: string | null; category: string; currency: string; total_minor: number; balance_due_minor: number; due_date?: number | null; status: string }>;
  const reconciliations = (overviewQuery.data?.reconciliations ?? []) as Array<{ id: string; financial_account_id: string; statement_balance_minor: number; book_balance_minor: number; difference_minor: number; status: string }>;
  const trustLedgers = (overviewQuery.data?.trustLedgers ?? []) as Array<{ id: string; party_id: string; matter_or_lease_id: string; currency: string; balance_minor: number; status: string }>;
  const finAccounts = ((overviewQuery.data as { finAccounts?: Array<{ id: string; code: string; name: string; currency: string }> } | undefined)?.finAccounts ?? []);
  const trialBalanceTotals = (overviewQuery.data as { trialBalanceTotals?: { totalDebitMinor: number; totalCreditMinor: number; balanced: boolean } } | undefined)?.trialBalanceTotals;

  function handleTrust(e: FormEvent) {
    e.preventDefault();
    trustMutation.mutate();
  }

  return (
    <section className="space-y-4" data-slot="finance-view">
      <PageHeader
        title="Finanzas GAAP, Mayor Contable & Custodia"
        description="Balance de comprobación, Libro Mayor partida doble, Cuentas por Pagar, Conciliación y Fideicomiso."
        onRefresh={() => void overviewQuery.refetch()}
        refreshing={overviewQuery.isFetching}
        actions={<StatusBadge label="Contabilidad GAAP" tone="success" icon={<ShieldCheck className="size-3" />} />}
      />

      <AiCopilotBanner
        title="Copiloto Financiero CFO"
        summary="Analiza cuentas por pagar abiertas, discrepancias bancarias o asientos recientes."
        prompts={['Resumir facturas AP pendientes', 'Verificar cuadre de Balance de Comprobación']}
        onRunPrompt={(p) => aiMutation.mutate(p)}
        reply={aiReply}
        onClearReply={() => setAiReply(null)}
        loading={aiMutation.isPending}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard title="Cuentas COA" value={accounts.length} />
        <KpiCard title="Asientos GL" value={journalEntries.length} />
        <KpiCard title="Facturas AP" value={apBills.length} />
        <KpiCard title={`Saldo ${trustLabel}`} value={lastBalanceMinor !== null ? formatMinorUnits(lastBalanceMinor, 'USD') : `${trustLedgers.length} cuentas`} />
      </div>

      {errorMsg ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{errorMsg}</div> : null}
      {feedback ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p> : null}

      <SegmentedTabs
        activeId={tab}
        onSelect={(id) => setTab(id as FinanceTab)}
        tabs={[
          { id: 'trust', label: trustLabel, count: trustLedgers.length, icon: <Landmark className="size-3.5" /> },
          { id: 'coa', label: 'Balance Comprobación', count: accounts.length, icon: <Table2 className="size-3.5" /> },
          { id: 'gl', label: 'Libro Mayor GL', count: journalEntries.length, icon: <BookOpenCheck className="size-3.5" /> },
          { id: 'ap', label: 'Cuentas por Pagar', count: apBills.length, icon: <Receipt className="size-3.5" /> },
          { id: 'recon', label: 'Conciliación Bancaria', count: reconciliations.length, icon: <Scale className="size-3.5" /> },
        ]}
      />

      {tab === 'trust' ? (
        <div className="space-y-4">
          <form onSubmit={handleTrust} className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-5">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">{vocabulary.partySingular}</span>
              <select value={activePartyId} onChange={(e) => setPartyId(e.target.value)} className={`${INPUT_CLS} w-full`}>
                {parties.length === 0 ? <option value="">Sin registros</option> : null}
                {parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Referencia Caso / Contrato</span>
              <input value={matterId} onChange={(e) => setMatterId(e.target.value)} className={`${INPUT_CLS} w-full font-mono text-xs`} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Cuenta Bancaria</span>
              <select value={bankId} onChange={(e) => setBankId(e.target.value)} className={`${INPUT_CLS} w-full font-mono text-xs`}>
                <option value="acc_usd_cash">acc_usd_cash · Caja/Banco USD</option>
                {finAccounts.map((fa) => <option key={fa.id} value={fa.id}>{fa.code} · {fa.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Movimiento y Monto (USD)</span>
              <div className="flex gap-1.5">
                <select value={txKind} onChange={(e) => setTxKind(e.target.value as 'DEPOSIT' | 'DISBURSEMENT')} className={INPUT_CLS}>
                  <option value="DEPOSIT">Depósito</option><option value="DISBURSEMENT">Desembolso</option>
                </select>
                <input value={amountMajor} onChange={(e) => setAmountMajor(e.target.value)} placeholder="100.00" className={`${INPUT_CLS} w-24 font-mono tabular-nums`} />
              </div>
            </label>
            <button type="submit" disabled={trustMutation.isPending} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
              {trustMutation.isPending ? 'Procesando...' : `Registrar en ${trustLabel}`}
            </button>
          </form>

          <DataTable
            columns={[
              { id: 'ref', header: 'Caso / Contrato', cell: (r) => <span className="font-mono text-xs">{r.matter_or_lease_id}</span> },
              { id: 'bal', header: 'Saldo Protegido', align: 'right', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.balance_minor, r.currency)}</span> },
              { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" appearance="dot" /> },
            ]}
            data={trustLedgers}
            getRowId={(r) => r.id}
            emptyTitle={`Sin cuentas en ${trustLabel}`}
            rowActions={(r) => [
              { id: 'dep', label: 'Depositar aquí', onSelect: () => { setLedgerId(r.id); setTxKind('DEPOSIT'); setPartyId(r.party_id); setMatterId(r.matter_or_lease_id); } },
              { id: 'disb', label: 'Desembolsar aquí', onSelect: () => { setLedgerId(r.id); setTxKind('DISBURSEMENT'); setPartyId(r.party_id); setMatterId(r.matter_or_lease_id); } },
            ]}
          />
        </div>
      ) : (
        <FinanceApAndReconPanel
          rpc={rpc}
          tab={tab}
          accounts={accounts}
          journalEntries={journalEntries}
          apBills={apBills}
          reconciliations={reconciliations}
          parties={parties}
          finAccounts={finAccounts}
          trialBalanceTotals={trialBalanceTotals}
          onFeedback={(m) => { setErrorMsg(null); setFeedback(m); }}
          onError={(m) => setErrorMsg(m)}
        />
      )}
    </section>
  );
}
