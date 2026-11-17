import { ArrowRight, Clock, ShoppingCart, Trash2, X } from 'lucide-react';
import { formatMinorUnits } from './phase2-format';
import type { PosCartLine } from './PosReceiptPanel';

export interface HeldPosOrder {
  id: string;
  ticketLabel: string;
  customerName: string;
  items: PosCartLine[];
  totalMinor: number;
  createdAtIso: string;
}

/** Pure helper to park the active cart onto the held (Leylan) list. */
export function parkOrderToList(
  existing: readonly HeldPosOrder[],
  input: { customerName: string; items: PosCartLine[]; totalMinor: number },
): HeldPosOrder[] {
  const id = `hold_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const next: HeldPosOrder = {
    id,
    ticketLabel: `LEY-${String(existing.length + 1).padStart(2, '0')}`,
    customerName: input.customerName.trim() || 'Cliente en Fila',
    items: input.items.map((item) => ({ ...item })),
    totalMinor: input.totalMinor,
    createdAtIso: new Date().toISOString(),
  };
  return [next, ...existing];
}

/** Pure helper to recall a held order by ID and return remaining held orders. */
export function recallOrderFromList(
  existing: readonly HeldPosOrder[],
  holdId: string,
): { recalled: HeldPosOrder | null; remaining: HeldPosOrder[] } {
  const recalled = existing.find((o) => o.id === holdId) ?? null;
  const remaining = existing.filter((o) => o.id !== holdId);
  return { recalled, remaining };
}

interface PosHoldOrdersModalProps {
  open: boolean;
  onClose: () => void;
  heldOrders: readonly HeldPosOrder[];
  onRecall: (orderId: string) => void;
  onDelete: (orderId: string) => void;
}

/** Parked & Held Orders ("Leylan" / Apartados) modal styled with Open Mercato DS v3. */
export function PosHoldOrdersModal({
  open,
  onClose,
  heldOrders,
  onRecall,
  onDelete,
}: PosHoldOrdersModalProps) {
  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Tickets en Espera (Leylan)" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-amber-500" />
            <div>
              <h3 className="text-sm font-semibold">Tickets en Espera · Leylan</h3>
              <p className="text-[11px] text-muted-foreground">Retoma carritos aparcados o apartados en 1 clic.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar espera" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
          {heldOrders.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              <ShoppingCart className="mx-auto mb-2 size-7 opacity-40" />
              No hay tickets en espera en esta caja.
            </div>
          ) : (
            heldOrders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3 hover:bg-muted/50"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-foreground">{order.ticketLabel}</span>
                    <span className="truncate text-xs font-medium text-foreground">{order.customerName}</span>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {order.items.length} ítems · {formatMinorUnits(order.totalMinor, 'USD')}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onDelete(order.id)}
                    aria-label={`Eliminar ${order.ticketLabel}`}
                    className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onRecall(order.id);
                      onClose();
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    <span>Retomar</span>
                    <ArrowRight className="size-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
