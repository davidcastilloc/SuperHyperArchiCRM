import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Scale, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

interface LegalAiContractModalProps {
  open: boolean;
  onClose: () => void;
  rpc: Phase2ViewProps['rpc'];
}

/** AI Contract Risk Analyzer & Opposing-Party Conflict Checker modal. */
export function LegalAiContractModal({ open, onClose, rpc }: LegalAiContractModalProps) {
  const [opposingPartyName, setOpposingPartyName] = useState('');
  const [contractText, setContractText] = useState('');

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.legal['ai-contract-review'].$post({
        json: { opposingPartyName, contractText },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  if (!open) return null;
  const r = reviewMutation.data;

  return (
    <div role="dialog" aria-modal="true" aria-label="Análisis Legal y Conflictos IA" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            <Scale className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Revisor de Contratos IA & Conflicto de Intereses</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar revisor" className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); reviewMutation.mutate(); }}>
          <input
            placeholder="Contraparte a verificar en conflictos (opcional)"
            value={opposingPartyName}
            onChange={(e) => setOpposingPartyName(e.target.value)}
            className={`${INPUT_CLS} w-full`}
          />
          <textarea
            rows={5}
            required
            placeholder="Pega aquí las cláusulas del contrato o escrito..."
            value={contractText}
            onChange={(e) => setContractText(e.target.value)}
            className="w-full rounded-md border border-input bg-background p-3 text-xs"
          />
          <button type="submit" disabled={reviewMutation.isPending} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            <Sparkles className="size-3.5" />
            <span>{reviewMutation.isPending ? 'Analizando cláusulas...' : 'Ejecutar Auditoría IA'}</span>
          </button>
        </form>

        {r ? (
          <div className="mt-4 space-y-2.5 rounded-lg border border-border bg-muted/35 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Riesgo Contractual</span>
              <StatusBadge label={`${r.riskScore}/100`} tone={r.riskScore >= 50 ? 'warning' : 'success'} />
            </div>
            <p className="text-muted-foreground">{r.summary}</p>
            <ul className="space-y-1">
              {r.flaggedClauses.map((clause, idx) => (
                <li key={idx} className="flex items-center gap-1.5 text-foreground">
                  <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                  <span>{clause}</span>
                </li>
              ))}
            </ul>
            {r.conflictsFound.length > 0 ? (
              <p className="font-semibold text-destructive">
                ¡Alerta de conflicto! {r.conflictsFound.length} coincidencia(s) en directorio.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
