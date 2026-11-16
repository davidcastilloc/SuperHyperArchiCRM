import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  formatMinorUnits,
  INPUT_CLS,
  parseNonNegInt,
  readApiError,
  type Phase2ViewProps,
} from './phase2-format';

/** Trust/IOLTA Escrow (strict overdraft guard) & GAAP Balanced Journal view. */
export function FinanceView({ rpc }: Phase2ViewProps) {
  const [ledgerId, setLedgerId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [matterId, setMatterId] = useState('mat_1');
  const [bankId, setBankId] = useState('bank_iolta_1');
  const [amountInput, setAmountInput] = useState('10000');
  const [txKind, setTxKind] = useState<'DEPOSIT' | 'DISBURSEMENT'>('DEPOSIT');
  const [entryNumber, setEntryNumber] = useState('JE-2026-001');
  const [journalMinorInput, setJournalMinorInput] = useState('25000');
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
    <section className="space-y-4 p-4" data-slot="finance-view">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Finanzas · Trust/IOLTA & Libro Diario GAAP</h1>
        <p className="text-sm text-muted-foreground">
          Cuentas fiduciarias con bloqueo estricto de sobregiro (422) y asientos contables balanceados en BigInt.
        </p>
      </div>

      {feedback && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs font-mono">
          {feedback}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={handleTrustSubmit} className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">Trust / IOLTA Escrow</h2>
          <input className={INPUT_CLS} value={ledgerId} onChange={(e) => setLedgerId(e.target.value)} placeholder="Ledger ID (vacío = crear nuevo)" />
          <div className="grid grid-cols-2 gap-2">
            <select className={INPUT_CLS} value={activePartyId} onChange={(e) => setPartyId(e.target.value)}>
              {parties.length === 0 ? (
                <option value="pty_1">pty_1 (demo)</option>
              ) : (
                parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)
              )}
            </select>
            <input className={INPUT_CLS} value={matterId} onChange={(e) => setMatterId(e.target.value)} placeholder="Matter/Lease ID" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select className={INPUT_CLS} value={txKind} onChange={(e) => setTxKind(e.target.value as 'DEPOSIT' | 'DISBURSEMENT')}>
              <option value="DEPOSIT">DEPOSIT</option>
              <option value="DISBURSEMENT">DISBURSEMENT</option>
            </select>
            <input className={INPUT_CLS} value={amountInput} onChange={(e) => setAmountInput(e.target.value)} placeholder="Monto (centavos)" />
          </div>
          <button type="submit" disabled={trustMutation.isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            {trustMutation.isPending ? 'Procesando...' : 'Ejecutar Movimiento Trust'}
          </button>
        </form>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">Asiento Diario GAAP (Partida Doble)</h2>
          <input className={INPUT_CLS} value={entryNumber} onChange={(e) => setEntryNumber(e.target.value)} placeholder="Número de asiento" />
          <input className={INPUT_CLS} value={journalMinorInput} onChange={(e) => setJournalMinorInput(e.target.value)} placeholder="Monto balanceado (centavos)" />
          <button type="button" disabled={journalMutation.isPending} onClick={() => journalMutation.mutate()} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium">
            {journalMutation.isPending ? 'Contabilizando...' : 'Contabilizar Asiento GAAP'}
          </button>
        </div>
      </div>
    </section>
  );
}
