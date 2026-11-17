import { useState, type FormEvent } from 'react';
import { Calculator, CheckCircle2, Minus, Plus, Printer, Trash2 } from 'lucide-react';
import { ThermalReceiptModal } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS } from './phase2-format';

export interface PosCartLine {
  productId: string;
  sku: string;
  name: string;
  unitPriceMinor: number;
  qty: number;
}

interface PosReceiptPanelProps {
  cart: PosCartLine[];
  cartTotalMinor: number;
  cartTotalVesMinor: number;
  usdInput: string;
  vesInput: string;
  onUsdChange: (value: string) => void;
  onVesChange: (value: string) => void;
  onUpdateQty: (productId: string, delta: number) => void;
  onClearCart: () => void;
  onFillRestante: () => void;
  onSubmit: (e: FormEvent) => void;
  submitting: boolean;
}

/** Right-hand dual-currency receipt & mixed tender checkout panel for PosView. */
export function PosReceiptPanel({
  cart,
  cartTotalMinor,
  cartTotalVesMinor,
  usdInput,
  vesInput,
  onUsdChange,
  onVesChange,
  onUpdateQty,
  onClearCart,
  onFillRestante,
  onSubmit,
  submitting,
}: PosReceiptPanelProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col justify-between space-y-4 rounded-xl border border-border bg-card p-5 shadow-xs lg:col-span-2"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-border pb-2.5">
          <h2 className="text-sm font-semibold tracking-tight">Ticket en Curso</h2>
          {cart.length > 0 ? (
            <button
              type="button"
              onClick={onClearCart}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="size-3.5" />
              <span>Vaciar</span>
            </button>
          ) : null}
        </div>

        {cart.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Selecciona productos del catálogo izquierdo para iniciar el cobro.
          </p>
        ) : (
          <ul className="divide-y divide-border/80">
            {cart.map((line) => (
              <li key={line.productId} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{line.name}</p>
                  <p className="font-mono text-xs text-muted-foreground tabular-nums">
                    {formatMinorUnits(line.unitPriceMinor, 'USD')} × {line.qty}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={`Restar ${line.name}`}
                    onClick={() => onUpdateQty(line.productId, -1)}
                    className="inline-flex size-7 items-center justify-center rounded-md border border-border hover:bg-muted"
                  >
                    <Minus className="size-3" />
                  </button>
                  <span className="w-6 text-center font-mono text-xs font-medium tabular-nums">{line.qty}</span>
                  <button
                    type="button"
                    aria-label={`Sumar ${line.name}`}
                    onClick={() => onUpdateQty(line.productId, 1)}
                    className="inline-flex size-7 items-center justify-center rounded-md border border-border hover:bg-muted"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3.5 border-t border-border pt-3.5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-muted-foreground">Total a Pagar</span>
          <div className="text-right font-mono tabular-nums">
            <p className="text-2xl font-semibold tracking-tight">{formatMinorUnits(cartTotalMinor, 'USD')}</p>
            <p className="text-xs text-muted-foreground">{formatMinorUnits(cartTotalVesMinor, 'VES')}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Efectivo USD ($)</span>
            <input
              type="text"
              value={usdInput}
              onChange={(e) => onUsdChange(e.target.value)}
              className={`${INPUT_CLS} w-full font-mono tabular-nums`}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Pago Móvil (Bs)</span>
            <input
              type="text"
              value={vesInput}
              onChange={(e) => onVesChange(e.target.value)}
              className={`${INPUT_CLS} w-full font-mono tabular-nums`}
            />
          </label>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onFillRestante}
            disabled={cart.length === 0}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted disabled:opacity-45"
          >
            <Calculator className="size-3.5 text-muted-foreground" />
            <span>Restante Bs</span>
          </button>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            disabled={cart.length === 0}
            title="Imprimir ticket ESC/POS 80mm"
            aria-label="Imprimir ticket térmico"
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-muted disabled:opacity-45"
          >
            <Printer className="size-4 text-muted-foreground" />
          </button>
          <button
            type="submit"
            disabled={submitting || cart.length === 0}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md bg-checkout px-4 text-sm font-medium text-checkout-foreground shadow-xs transition-opacity hover:opacity-95 disabled:opacity-45"
          >
            <CheckCircle2 className="size-4" />
            <span>{submitting ? 'Procesando...' : 'Registrar Pago'}</span>
          </button>
        </div>
      </div>
      <ThermalReceiptModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        receipt={{
          storeName: 'SuperHyperArchiCRM · Sucursal',
          orderNumber: 'BORRADOR-POS',
          cashierName: 'Caja Activa',
          currencyCode: 'USD',
          lines: cart.map((l) => ({ title: l.name, qty: l.qty, lineTotalMinor: l.unitPriceMinor * l.qty })),
          grandTotalMinor: cartTotalMinor,
          kickCashDrawer: true,
        }}
      />
    </form>
  );
}
