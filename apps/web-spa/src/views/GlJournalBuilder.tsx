import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Scale, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { StatusBadge } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

export interface JournalDraftLine {
  accountCode: string;
  debitInput: string;
  creditInput: string;
}

export function validateBalancedJournalLines(lines: readonly JournalDraftLine[]): {
  valid: boolean;
  totalDebitMinor: number;
  totalCreditMinor: number;
  diffMinor: number;
} {
  let totalDebitMinor = 0;
  let totalCreditMinor = 0;
  for (const line of lines) {
    totalDebitMinor += parseMajorToMinor(line.debitInput);
    totalCreditMinor += parseMajorToMinor(line.creditInput);
  }
  const diffMinor = Math.abs(totalDebitMinor - totalCreditMinor);
  const valid =
    lines.length >= 2 &&
    lines.every((l) => l.accountCode.trim().length > 0) &&
    totalDebitMinor > 0 &&
    diffMinor === 0;
  return { valid, totalDebitMinor, totalCreditMinor, diffMinor };
}

interface GlJournalBuilderProps {
  rpc: Phase2ViewProps['rpc'];
  accounts: Array<{ account_code: string; name: string }>;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

function bumpEntryNumber(current: string): string {
  const m = /^(.*?)(\d+)$/.exec(current.trim());
  if (!m) return `${current}-2`;
  return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2]!.length, '0')}`;
}

/** Multi-line GL Journal Entry Builder with live ∑ Débito = ∑ Crédito guard. */
export function GlJournalBuilder({ rpc, accounts, onSuccess, onError }: GlJournalBuilderProps) {
  const queryClient = useQueryClient();
  const [entryNumber, setEntryNumber] = useState('JE-2026-001');
  const [description, setDescription] = useState('Asiento contable manual');
  const [lines, setLines] = useState<JournalDraftLine[]>([
    { accountCode: accounts[0]?.account_code ?? '1010-CASH', debitInput: '250.00', creditInput: '0.00' },
    { accountCode: accounts[1]?.account_code ?? '4010-REV', debitInput: '0.00', creditInput: '250.00' },
  ]);

  const summary = validateBalancedJournalLines(lines);

  const postMutation = useMutation({
    mutationFn: async () => {
      if (!summary.valid) throw new Error('El asiento debe tener al menos 2 líneas y ∑ Débito = ∑ Crédito.');
      const res = await rpc.api.finance.journal.post.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          entryNumber: entryNumber.trim(),
          entryDate: Math.floor(Date.now() / 1000),
          fiscalYear: new Date().getFullYear(),
          fiscalPeriod: new Date().getMonth() + 1,
          description: description.trim() || 'Asiento contable',
          lines: lines.map((l) => ({
            accountCode: l.accountCode.trim().toUpperCase(),
            debitMinor: parseMajorToMinor(l.debitInput),
            creditMinor: parseMajorToMinor(l.creditInput),
          })),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['finance', 'overview'] });
      setEntryNumber((prev) => bumpEntryNumber(prev));
      onSuccess(`Asiento ${data.entryNumber} contabilizado (${formatMinorUnits(data.totalDebitMinor, 'USD')}).`);
    },
    onError: (err: Error) => onError(err.message),
  });

  function updateLine(idx: number, patch: Partial<JournalDraftLine>) {
    setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    postMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
        <div className="flex items-center gap-2">
          <Scale className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Constructor de Asiento Contable (Partida Doble)</h3>
        </div>
        <StatusBadge
          label={
            summary.valid
              ? `Cuadrado: ${formatMinorUnits(summary.totalDebitMinor, 'USD')}`
              : `Descuadre: ${formatMinorUnits(summary.diffMinor, 'USD')}`
          }
          tone={summary.valid ? 'success' : 'warning'}
          appearance="dot"
        />
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">N° Asiento</span>
          <input value={entryNumber} onChange={(e) => setEntryNumber(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} required />
        </label>
        <label className="space-y-1 text-xs sm:col-span-2">
          <span className="font-medium text-muted-foreground">Descripción / Glosa</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={`${INPUT_CLS} w-full`} required />
        </label>
      </div>

      <div className="space-y-2">
        {lines.map((line, idx) => (
          <div key={idx} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-12">
            <label className="space-y-1 text-xs sm:col-span-5">
              <span className="text-[11px] text-muted-foreground">Cuenta COA</span>
              {accounts.length > 0 ? (
                <select value={line.accountCode} onChange={(e) => updateLine(idx, { accountCode: e.target.value })} className={`${INPUT_CLS} w-full font-mono text-xs`}>
                  {accounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} · {a.name}</option>)}
                </select>
              ) : (
                <input value={line.accountCode} onChange={(e) => updateLine(idx, { accountCode: e.target.value })} placeholder="1010-CASH" className={`${INPUT_CLS} w-full font-mono text-xs`} />
              )}
            </label>
            <label className="space-y-1 text-xs sm:col-span-3">
              <span className="text-[11px] text-muted-foreground">Débito (USD)</span>
              <input value={line.debitInput} onChange={(e) => updateLine(idx, { debitInput: e.target.value })} className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
            </label>
            <label className="space-y-1 text-xs sm:col-span-3">
              <span className="text-[11px] text-muted-foreground">Crédito (USD)</span>
              <input value={line.creditInput} onChange={(e) => updateLine(idx, { creditInput: e.target.value })} className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
            </label>
            <button
              type="button"
              disabled={lines.length <= 2}
              onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
              aria-label="Eliminar línea"
              className="inline-flex h-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-35 sm:col-span-1"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, { accountCode: accounts[0]?.account_code ?? '', debitInput: '0.00', creditInput: '0.00' }])}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted"
        >
          <Plus className="size-3.5" /><span>Agregar Línea</span>
        </button>
        <div className="flex items-center gap-4 font-mono text-xs tabular-nums">
          <span>∑ Débito: <strong>{formatMinorUnits(summary.totalDebitMinor, 'USD')}</strong></span>
          <span>∑ Crédito: <strong>{formatMinorUnits(summary.totalCreditMinor, 'USD')}</strong></span>
          <button type="submit" disabled={!summary.valid || postMutation.isPending} className="inline-flex h-9 items-center rounded-md bg-primary px-4 font-sans text-xs font-semibold text-primary-foreground disabled:opacity-45">
            {postMutation.isPending ? 'Contabilizando...' : 'Contabilizar Asiento'}
          </button>
        </div>
      </div>
    </form>
  );
}
