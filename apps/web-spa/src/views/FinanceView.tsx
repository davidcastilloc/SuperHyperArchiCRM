import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenCheck, Landmark, Receipt, Scale, ShieldCheck, Table2 } from 'lucide-react';
import { AiCopilotBanner, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { FinanceApAndReconPanel } from './FinanceApAndReconPanel';
import { formatMinorUnits, INPUT_CLS, parseNonNegInt, readApiError, type Phase2ViewProps } from './phase2-format';

type FinanceTab = 'trust' | 'coa' | 'gl' | 'ap' | 'recon';

/** Open Mercato DS v3 Full GAAP Accounting Suite: Trust/IOLTA, Trial Balance, GL, AP Bills & Bank Reconciliation. */
export function FinanceView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<FinanceTab>('trust');
  const [ledgerId, setLedgerId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [matterId, setMatterId] = useState('mat_1');
  const [bankId, setBankId] = useState('bank_iolta_1');
  const [amountInput, setAmountInput] = useState('10000');
  const [txKind, setTxKind] = useState<'DEPOSIT' | 'DISBURSEMENT'>('DEPOSIT');
  const [entryNumber, setEntryNumber] = useState('JE-2026-001');
  const [journalMinorInput, setJournalMinorInput] = useState('25000');
  const [lastBalanceMinor, setLastBalanceMinor] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
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
  const activePartyId = partyId || parties[0]?.id || 'pty_1';

  const trustMutation = useMutation({
    mutationFn: async () => {
      const amountMinor = Math.max(1, parseNonNegInt(amountInput));
      const res = await rpc.api.finance.trust.transact.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          ...(ledgerId.trim() ? { ledgerId: ledgerId.trim() } : {}),
          ledgerKind: 'legal_iolta_trust',
          partyId: activePartyId.trim(),
          matterOrLeaseId: matterId.trim(),
          bankAccountId: bankId.trim(),
          currency: 'USD',
          txKind,
          amountMinor,
          description: `${txKind} Trust/IOLTA`,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setLedgerId(data.ledgerId);
      setLastBalanceMinor(data.balanceMinor);
      void queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] });
      setFeedback(`Ledger ${data.ledgerId} · ${data.txKind} ${formatMinorUnits(data.amountMinor, data.currency)} · Saldo: ${formatMinorUnits(data.balanceMinor, data.currency)}`);
    },
    onError: (err) => setFeedback(err.message),
  });

  const journalMutation = useMutation({
    mutationFn: async () => {
      const minor = Math.max(1, parseNonNegInt(journalMinorInput));
      const res = await rpc.api.finance.journal.post.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          entryNumber: entryNumber.trim(),
          entryDate: Math.floor(Date.now() / 1000),
          fiscalYear: 2026,
          fiscalPeriod: 11,
          description: 'Asiento GAAP balanceado',
          lines: [
            { accountCode: '1010-TRUST-CASH', debitMinor: minor, creditMinor: 0 },
            { accountCode: '2010-TRUST-LIAB', debitMinor: 0, creditMinor: minor },
          ],
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] });
      setFeedback(`Asiento ${data.entryNumber} (${data.status}) · Débito = Crédito = ${formatMinorUnits(data.totalDebitMinor, 'USD')}`);
    },
    onError: (err) => setFeedback(err.message),
  });

  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await rpc.api.automation['ai-chat'].$post({ json: { prompt } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => setAiReply(d.reply),
  });

  const accounts = (overviewQuery.data?.accounts ?? []) as Array<{ id: string; account_code: string; name: string; classification: string; normal_balance: string; current_balance_minor: number; currency: string }>;
  const journalEntries = (overviewQuery.data?.journalEntries ?? []) as Array<{ id: string; entry_number: string; description: string; total_debit_minor: number; total_credit_minor: number; status: string }>;
  const apBills = (overviewQuery.data?.apBills ?? []) as Array<{ id: string; bill_or_expense_no: string; category: string; currency: string; total_minor: number; balance_due_minor: number; status: string }>;
  const reconciliations = (overviewQuery.data?.reconciliations ?? []) as Array<{ id: string; financial_account_id: string; statement_balance_minor: number; book_balance_minor: number; difference_minor: number; status: string }>;

  return (
    <section className="space-y-5" data-slot="finance-view">
      <PageHeader
        title="Finanzas · GAAP Completo, AP Bills & Trust/IOLTA"
        description="Custodia fiduciaria anti-sobregiro, Balance de Comprobación, Libro Mayor, Cuentas por Pagar y Conciliación Bancaria."
        onRefresh={() => void overviewQuery.refetch()}
        refreshing={overviewQuery.isFetching}
        actions={<StatusBadge label="Sobregiro bloqueado (>= 0)" tone="success" icon={<ShieldCheck className="size-3" />} />}
      />

      <AiCopilotBanner
        title="CFO Copiloto IA"
        summary="Audita diferencias de conciliación bancaria, resume cuentas por pagar y verifica cuadre GAAP."
        prompts={['Resumir facturas AP pendientes y conciliaciones', 'Auditar asientos GAAP del período']}
        onRunPrompt={(p) => aiMutation.mutate(p)}
        reply={aiReply}
        onClearReply={() => setAiReply(null)}
        loading={aiMutation.isPending}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard title="Saldo Trust Activo" value={lastBalanceMinor !== null ? formatMinorUnits(lastBalanceMinor, 'USD') : '—'} />
        <KpiCard title="Cuentas Contables" value={accounts.length} />
        <KpiCard title="Asientos Libro Mayor" value={journalEntries.length} />
        <KpiCard title="Facturas AP / Conciliaciones" value={`${apBills.length} / ${reconciliations.length}`} />
      </div>

      {feedback ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p> : null}

      <SegmentedTabs
        activeId={tab}
        onSelect={(id) => setTab(id as FinanceTab)}
        tabs={[
          { id: 'trust', label: 'Trust/IOLTA & Diario', icon: <Landmark className="size-3.5" /> },
          { id: 'coa', label: 'Balance Comprobación', count: accounts.length, icon: <Table2 className="size-3.5" /> },
          { id: 'gl', label: 'Libro Mayor', count: journalEntries.length, icon: <BookOpenCheck className="size-3.5" /> },
          { id: 'ap', label: 'Cuentas por Pagar', count: apBills.length, icon: <Receipt className="size-3.5" /> },
          { id: 'recon', label: 'Conciliación Bancaria', count: reconciliations.length, icon: <Scale className="size-3.5" /> },
        ]}
      />

      {tab === 'trust' ? (
        <div className="grid gap-5 md:grid-cols-2">
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!trustMutation.isPending) trustMutation.mutate(); }} className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold"><Landmark className="size-4 text-muted-foreground" /><span>Movimiento Fiduciario Trust / IOLTA</span></h2>
              <StatusBadge label={txKind} tone={txKind === 'DEPOSIT' ? 'success' : 'warning'} appearance="dot" />
            </div>
            <input className={`${INPUT_CLS} w-full font-mono text-xs`} value={ledgerId} onChange={(e) => setLedgerId(e.target.value)} placeholder="Ledger ID (vacío = crear nuevo)" />
            <div className="grid grid-cols-2 gap-2.5">
              <select className={INPUT_CLS} value={activePartyId} onChange={(e) => setPartyId(e.target.value)}>
                {parties.length === 0 ? <option value="pty_1">pty_1 (demo)</option> : parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
              </select>
              <input className={`${INPUT_CLS} font-mono text-xs`} value={matterId} onChange={(e) => setMatterId(e.target.value)} placeholder="Matter/Lease ID" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <select className={INPUT_CLS} value={bankId} onChange={(e) => setBankId(e.target.value)}><option value="bank_iolta_1">bank_iolta_1</option><option value="bank_escrow_2">bank_escrow_2</option></select>
              <select className={INPUT_CLS} value={txKind} onChange={(e) => setTxKind(e.target.value as 'DEPOSIT' | 'DISBURSEMENT')}><option value="DEPOSIT">Depósito (DEPOSIT)</option><option value="DISBURSEMENT">Desembolso (DISBURSEMENT)</option></select>
            </div>
            <input className={`${INPUT_CLS} w-full font-mono tabular-nums`} value={amountInput} onChange={(e) => setAmountInput(e.target.value)} placeholder="Monto en centavos" />
            <button type="submit" disabled={trustMutation.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs">
              <Landmark className="size-3.5" /><span>{trustMutation.isPending ? 'Procesando...' : 'Ejecutar Movimiento Trust'}</span>
            </button>
          </form>

          <div className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold"><BookOpenCheck className="size-4 text-muted-foreground" /><span>Asiento Diario GAAP (Partida Doble)</span></h2>
            <input className={`${INPUT_CLS} w-full font-mono text-xs`} value={entryNumber} onChange={(e) => setEntryNumber(e.target.value)} placeholder="Número de asiento" />
            <input className={`${INPUT_CLS} w-full font-mono tabular-nums`} value={journalMinorInput} onChange={(e) => setJournalMinorInput(e.target.value)} placeholder="Monto balanceado en centavos" />
            <button type="button" disabled={journalMutation.isPending} onClick={() => journalMutation.mutate()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3.5 text-xs font-medium shadow-xs hover:bg-muted">
              <BookOpenCheck className="size-3.5 text-muted-foreground" /><span>{journalMutation.isPending ? 'Contabilizando...' : 'Contabilizar Asiento GAAP'}</span>
            </button>
          </div>
        </div>
      ) : (
        <FinanceApAndReconPanel
          rpc={rpc}
          tab={tab}
          accounts={accounts}
          journalEntries={journalEntries}
          apBills={apBills}
          reconciliations={reconciliations}
          onFeedback={setFeedback}
        />
      )}
    </section>
  );
}
