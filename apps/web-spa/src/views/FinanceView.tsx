import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BookOpenCheck, Landmark, ShieldCheck } from 'lucide-react';
import { KpiCard, PageHeader, StatusBadge } from '@shac/ui';
import {
  formatMinorUnits,
  INPUT_CLS,
  parseNonNegInt,
  readApiError,
  type Phase2ViewProps,
} from './phase2-format';

/** Open Mercato DS v3 Trust/IOLTA Escrow (strict overdraft guard) & GAAP Balanced Journal view. */
export function FinanceView({ rpc }: Phase2ViewProps) {
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

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'finance-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
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
      setFeedback(
        `Ledger ${data.ledgerId} · ${data.txKind} ${formatMinorUnits(data.amountMinor, data.currency)} · Saldo: ${formatMinorUnits(data.balanceMinor, data.currency)}`,
      );
    },
    onError: (err) => setFeedback(err.message),
  });

  const journalMutation = useMutation({
    mutationFn: async () => {
      const minor = Math.max(1, parseNonNegInt(journalMinorInput));
      const nowSec = Math.floor(Date.now() / 1000);
      const res = await rpc.api.finance.journal.post.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          entryNumber: entryNumber.trim(),
          entryDate: nowSec,
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
      setFeedback(`Asiento ${data.entryNumber} (${data.status}) · Débito = Crédito = ${formatMinorUnits(data.totalDebitMinor, 'USD')}`);
    },
    onError: (err) => setFeedback(err.message),
  });

  function handleTrustSubmit(e: FormEvent) {
    e.preventDefault();
    if (trustMutation.isPending) return;
    trustMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="finance-view">
      <PageHeader
        title="Finanzas · Custodia Trust/IOLTA & Libro Diario GAAP"
        description="Aislamiento fiduciario con guarda anti-sobregiro y contabilidad de partida doble en enteros exactos."
        actions={<StatusBadge label="Sobregiro bloqueado (>= 0)" tone="success" icon={<ShieldCheck className="size-3" />} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard title="Saldo Ledger Activo" value={lastBalanceMinor !== null ? formatMinorUnits(lastBalanceMinor, 'USD') : '—'} />
        <KpiCard title="Movimiento Trust" value={formatMinorUnits(parseNonNegInt(amountInput, 0), 'USD')} />
        <KpiCard title="Partida Doble GAAP" value={formatMinorUnits(parseNonNegInt(journalMinorInput, 0), 'USD')} />
      </div>

      {feedback ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <form onSubmit={handleTrustSubmit} className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <Landmark className="size-4 text-muted-foreground" />
              <span>Movimiento Fiduciario Trust / IOLTA</span>
            </h2>
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
            <select className={INPUT_CLS} value={bankId} onChange={(e) => setBankId(e.target.value)}>
              <option value="bank_iolta_1">bank_iolta_1</option>
              <option value="bank_escrow_2">bank_escrow_2</option>
            </select>
            <select className={INPUT_CLS} value={txKind} onChange={(e) => setTxKind(e.target.value as 'DEPOSIT' | 'DISBURSEMENT')}>
              <option value="DEPOSIT">Depósito (DEPOSIT)</option>
              <option value="DISBURSEMENT">Desembolso (DISBURSEMENT)</option>
            </select>
          </div>
          <input className={`${INPUT_CLS} w-full font-mono tabular-nums`} value={amountInput} onChange={(e) => setAmountInput(e.target.value)} placeholder="Monto en centavos" />
          <button type="submit" disabled={trustMutation.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs">
            <Landmark className="size-3.5" />
            <span>{trustMutation.isPending ? 'Procesando...' : 'Ejecutar Movimiento Trust'}</span>
          </button>
        </form>

        <div className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <BookOpenCheck className="size-4 text-muted-foreground" />
            <span>Asiento Diario GAAP (Partida Doble)</span>
          </h2>
          <input className={`${INPUT_CLS} w-full font-mono text-xs`} value={entryNumber} onChange={(e) => setEntryNumber(e.target.value)} placeholder="Número de asiento" />
          <input className={`${INPUT_CLS} w-full font-mono tabular-nums`} value={journalMinorInput} onChange={(e) => setJournalMinorInput(e.target.value)} placeholder="Monto balanceado en centavos" />
          <button type="button" disabled={journalMutation.isPending} onClick={() => journalMutation.mutate()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3.5 text-xs font-medium shadow-xs hover:bg-muted">
            <BookOpenCheck className="size-3.5 text-muted-foreground" />
            <span>{journalMutation.isPending ? 'Contabilizando...' : 'Contabilizar Asiento GAAP'}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
