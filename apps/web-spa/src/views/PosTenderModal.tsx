import { CheckCircle2, Wallet, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PosVirtualKeypad } from '@shac/ui';
import { computeDualChangeMinor } from '../lib/usePosScanner';
import { formatMinorToInput, formatMinorUnits, INPUT_CLS, parseMajorToMinor } from './phase2-format';

interface PosTenderModalProps {
  open: boolean;
  onClose: () => void;
  totalUsdMinor: number;
  rateMicros: number;
  usdInput: string;
  vesInput: string;
  onUsdChange: (next: string) => void;
  onVesChange: (next: string) => void;
  onFillRestante: () => void;
  onConfirmCheckout: () => void;
  submitting: boolean;
  usdMethod?: 'USD_CASH' | 'ZELLE' | 'POS_DEBIT';
  onChangeUsdMethod?: (method: 'USD_CASH' | 'ZELLE' | 'POS_DEBIT') => void;
}

const QUICK_USD_BILLS = [100, 500, 1000, 2000, 5000, 10000] as const;

/** Quick-Tender modal with denomination pills, replaceOnFirstInput keypad, and live USD/VES change. */
export function PosTenderModal({
  open,
  onClose,
  totalUsdMinor,
  rateMicros,
  usdInput,
  vesInput,
  onUsdChange,
  onVesChange,
  onFillRestante,
  onConfirmCheckout,
  submitting,
  usdMethod: controlledMethod,
  onChangeUsdMethod,
}: PosTenderModalProps) {
  const [activeField, setActiveField] = useState<'usd' | 'ves'>('usd');
  const [localMethod, setLocalMethod] = useState<'USD_CASH' | 'ZELLE' | 'POS_DEBIT'>('USD_CASH');
  const usdMethod = controlledMethod ?? localMethod;
  const setUsdMethod = onChangeUsdMethod ?? setLocalMethod;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const paidUsdMinor = parseMajorToMinor(usdInput);
  const paidVesMinor = parseMajorToMinor(vesInput);
  const summary = computeDualChangeMinor({
    totalUsdMinor,
    paidUsdMinor,
    paidVesMinor,
    rateMicros,
  });

  return (
    <div role="dialog" aria-modal="true" aria-label="Cobro Rápido Multi-Método" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">Cobro Rápido · Billetes y Vuelto</h3>
              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                Total a cobrar: {formatMinorUnits(totalUsdMinor, 'USD')}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Cerrar cobro"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onUsdChange(formatMinorToInput(totalUsdMinor))}
                className="min-h-9 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 font-mono text-xs font-semibold text-primary hover:bg-primary/15"
              >
                Exacto
              </button>
              {QUICK_USD_BILLS.map((minor) => (
                <button
                  key={minor}
                  type="button"
                  onClick={() => onUsdChange(formatMinorToInput(minor))}
                  className="min-h-9 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-xs font-medium hover:bg-muted"
                >
                  ${minor / 100}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="block space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-muted-foreground">Método USD</span>
                  <select
                    value={usdMethod}
                    onChange={(e) => setUsdMethod(e.target.value as 'USD_CASH' | 'ZELLE' | 'POS_DEBIT')}
                    className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
                  >
                    <option value="USD_CASH">Efectivo USD</option>
                    <option value="ZELLE">Zelle</option>
                    <option value="POS_DEBIT">Punto USD</option>
                  </select>
                </div>
                <input
                  type="text"
                  value={usdInput}
                  onFocus={() => setActiveField('usd')}
                  onChange={(e) => onUsdChange(e.target.value)}
                  className={`${INPUT_CLS} h-11 w-full font-mono tabular-nums ${activeField === 'usd' ? 'ring-2 ring-primary/40' : ''}`}
                />
              </label>

              <label className="block space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-muted-foreground">Pago Móvil / Efectivo (Bs)</span>
                  <button type="button" onClick={onFillRestante} className="text-[11px] font-medium text-primary hover:underline">
                    Completar Restante
                  </button>
                </div>
                <input
                  type="text"
                  value={vesInput}
                  onFocus={() => setActiveField('ves')}
                  onChange={(e) => onVesChange(e.target.value)}
                  className={`${INPUT_CLS} h-11 w-full font-mono tabular-nums ${activeField === 'ves' ? 'ring-2 ring-primary/40' : ''}`}
                />
              </label>
            </div>

            <div className="space-y-1 rounded-lg border border-border bg-muted/35 p-3 font-mono text-xs tabular-nums">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Restante:</span>
                <span className={summary.remainingUsdMinor > 0 ? 'font-semibold text-amber-600' : 'text-muted-foreground'}>
                  {formatMinorUnits(summary.remainingUsdMinor, 'USD')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vuelto USD:</span>
                <span className="font-semibold text-emerald-600">{formatMinorUnits(summary.changeUsdMinor, 'USD')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vuelto Bs:</span>
                <span className="font-semibold text-emerald-600">{formatMinorUnits(summary.changeVesMinor, 'VES')}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-3">
            <PosVirtualKeypad
              value={activeField === 'usd' ? usdInput : vesInput}
              replaceOnFirstInput={true}
              onChange={(next) => (activeField === 'usd' ? onUsdChange(next) : onVesChange(next))}
              onSubmit={() => {
                if (summary.remainingUsdMinor === 0 && !submitting) {
                  onConfirmCheckout();
                }
              }}
            />
            <button
              type="button"
              disabled={submitting || summary.remainingUsdMinor > 0}
              onClick={onConfirmCheckout}
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-md bg-checkout px-4 text-sm font-semibold text-checkout-foreground shadow-xs hover:opacity-95 disabled:opacity-45"
            >
              <CheckCircle2 className="size-4" />
              <span>{submitting ? 'Procesando...' : 'Confirmar y Cobrar'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
