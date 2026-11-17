import { Lock, Printer, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ZReportSummary } from '../lib/usePosShiftAndCheckout';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor } from './phase2-format';

interface PosCashClosingModalProps {
  open: boolean;
  onClose: () => void;
  registerId: string;
  cashierName: string;
  onConfirmClose: (counted: { USD: number; VES: number }) => void;
  submitting: boolean;
  lastClosedReport?: ZReportSummary | null;
  onClearReport?: () => void;
}

/** Detailed cash-closing denomination/count & Z-report modal. */
export function PosCashClosingModal({
  open,
  onClose,
  registerId,
  cashierName,
  onConfirmClose,
  submitting,
  lastClosedReport,
  onClearReport,
}: PosCashClosingModalProps) {
  const [usdCounted, setUsdCounted] = useState('0.00');
  const [vesCounted, setVesCounted] = useState('0.00');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClearReport?.();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose, onClearReport]);

  if (!open) return null;

  const usdMinor = parseMajorToMinor(usdCounted);
  const vesMinor = parseMajorToMinor(vesCounted);

  return (
    <div role="dialog" aria-modal="true" aria-label="Arqueo y Cierre de Caja" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            <Lock className="size-4 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">
                {lastClosedReport ? `Reporte Z · ${registerId}` : `Arqueo de Cierre · ${registerId}`}
              </h3>
              <p className="text-[11px] text-muted-foreground">Cajero: {cashierName}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              onClearReport?.();
              onClose();
            }}
            aria-label="Cerrar arqueo"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        {lastClosedReport ? (
          <div className="space-y-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                  <th className="py-1">Moneda</th>
                  <th className="py-1 text-right">Esperado</th>
                  <th className="py-1 text-right">Contado</th>
                  <th className="py-1 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 font-mono tabular-nums">
                {['USD', 'VES'].map((cur) => {
                  const exp = lastClosedReport.expectedBalancesMinor[cur] ?? 0;
                  const act = lastClosedReport.actualCountedBalancesMinor?.[cur] ?? 0;
                  const diff = lastClosedReport.discrepancyBalancesMinor[cur] ?? act - exp;
                  return (
                    <tr key={cur}>
                      <td className="py-1.5 font-semibold">{cur}</td>
                      <td className="py-1.5 text-right">{formatMinorUnits(exp, cur)}</td>
                      <td className="py-1.5 text-right">{formatMinorUnits(act, cur)}</td>
                      <td className={`py-1.5 text-right font-semibold ${diff === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {diff > 0 ? `+${formatMinorUnits(diff, cur)}` : formatMinorUnits(diff, cur)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {lastClosedReport.plainTextReport ? (
              <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed">
                {lastClosedReport.plainTextReport}
              </pre>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background text-xs font-medium hover:bg-muted"
              >
                <Printer className="size-3.5" />
                <span>Imprimir Reporte Z</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClearReport?.();
                  onClose();
                }}
                className="inline-flex h-9 flex-1 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
              >
                Finalizar
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              onConfirmClose({ USD: usdMinor, VES: vesMinor });
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
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-border bg-background text-xs font-medium hover:bg-muted disabled:opacity-45"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-45"
              >
                <Lock className="size-3.5" />
                <span>{submitting ? 'Cerrando...' : 'Cerrar Turno'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
