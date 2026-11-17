import { Lock, X } from 'lucide-react';
import { useState } from 'react';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor } from './phase2-format';

interface PosCashClosingModalProps {
  open: boolean;
  onClose: () => void;
  registerId: string;
  cashierName: string;
  onConfirmClose: (counted: { USD: number; VES: number }) => void;
  submitting: boolean;
}

/** Detailed cash-closing denomination/count modal inspired by open-pos cash-closing.vue. */
export function PosCashClosingModal({
  open,
  onClose,
  registerId,
  cashierName,
  onConfirmClose,
  submitting,
}: PosCashClosingModalProps) {
  const [usdCounted, setUsdCounted] = useState('0.00');
  const [vesCounted, setVesCounted] = useState('0.00');

  if (!open) return null;

  const usdMinor = parseMajorToMinor(usdCounted);
  const vesMinor = parseMajorToMinor(vesCounted);

  return (
    <div role="dialog" aria-modal="true" aria-label="Arqueo y Cierre de Caja" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            <Lock className="size-4 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">Arqueo de Cierre · {registerId}</h3>
              <p className="text-[11px] text-muted-foreground">Cajero: {cashierName}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar arqueo" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirmClose({ USD: usdMinor, VES: vesMinor });
            onClose();
          }}
        >
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Efectivo contado en USD</span>
            <input
              type="text"
              value={usdCounted}
              onChange={(e) => setUsdCounted(e.target.value)}
              className={`${INPUT_CLS} w-full font-mono tabular-nums`}
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Efectivo / Caja contado en Bs (VES)</span>
            <input
              type="text"
              value={vesCounted}
              onChange={(e) => setVesCounted(e.target.value)}
              className={`${INPUT_CLS} w-full font-mono tabular-nums`}
            />
          </label>
          <div className="rounded-lg border border-border bg-muted/40 p-2.5 font-mono text-[11px] text-muted-foreground tabular-nums">
            Declaración final: {formatMinorUnits(usdMinor, 'USD')} + {formatMinorUnits(vesMinor, 'VES')}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-border bg-background text-xs font-medium hover:bg-muted">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-45">
              <Lock className="size-3.5" />
              <span>{submitting ? 'Cerrando...' : 'Cerrar Turno'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
