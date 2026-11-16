import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  enqueueOfflineMutation,
  flushOfflineQueue,
  listOfflineQueue,
} from '../lib/offlineQueue';
import {
  formatMinorUnits,
  INPUT_CLS,
  parseNonNegInt,
  readApiError,
  ShacApiError,
  type Phase2ViewProps,
} from './phase2-format';

function computeRestanteTargetMinor(
  orderTotalMinor: number,
  paidOrderMinor: number,
  rateMicros: number,
): number {
  const remainingOrder = orderTotalMinor > paidOrderMinor ? orderTotalMinor - paidOrderMinor : 0;
  const safeRate = rateMicros > 0 ? rateMicros : 1_000_000;
  return Number((BigInt(remainingOrder) * BigInt(safeRate) + 500_000n) / 1_000_000n);
}

/** Multi-currency POS terminal with catalog selector, shift close, and offline queue. */
export function PosView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [registerId, setRegisterId] = useState('REG-1');
  const [shiftId, setShiftId] = useState('');
  const [cashierName, setCashierName] = useState('Cajero');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('1');
  const [orderTotalMinor, setOrderTotalMinor] = useState('0');
  const [rateMicros, setRateMicros] = useState('54750000');
  const [usdAccountId, setUsdAccountId] = useState('acc_usd_cash');
  const [usdAmountMinor, setUsdAmountMinor] = useState('0');
  const [vesAccountId, setVesAccountId] = useState('acc_ves_pm');
  const [vesAmountMinor, setVesAmountMinor] = useState('0');
  const [closeUsdMinor, setCloseUsdMinor] = useState('0');
  const [closeVesMinor, setCloseVesMinor] = useState('0');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ['catalog', 'products', 'pos-select'],
    queryFn: async () => {
      const res = await rpc.api.catalog.products.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const queueQuery = useQuery({
    queryKey: ['pos', 'offlineQueue'],
    queryFn: () => listOfflineQueue(),
  });

  const products = productsQuery.data?.items ?? [];
  const activeProductId = productId || products[0]?.id || '';
  const activeProduct = products.find((p) => p.id === activeProductId);

  function syncProductTotals(nextId: string, nextQtyRaw: string) {
    const found = products.find((p) => p.id === nextId);
    if (!found) return;
    const units = Math.max(1, parseNonNegInt(nextQtyRaw, 1));
    const total = found.basePriceMinor * units;
    setOrderTotalMinor(String(total));
    setUsdAmountMinor(String(total));
    setVesAmountMinor('0');
  }

  const openShiftMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.pos.shifts.open.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          registerId: registerId.trim(),
          cashierName: cashierName.trim() || 'Cajero',
          initialBalancesMinor: { USD: 0, VES: 0 },
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setShiftId(data.shiftId);
      setStatusMsg(`Turno abierto en ${vocabulary.spaceSingular} ${data.registerId}: ${data.shiftId}`);
    },
    onError: (err) => {
      if (err instanceof ShacApiError && err.code === 'SHIFT_ALREADY_OPEN') {
        const openId = err.details?.openShiftId;
        if (typeof openId === 'string' && openId.length > 0) {
          setShiftId(openId);
          setStatusMsg(`Turno activo recuperado en ${registerId}: ${openId}`);
          return;
        }
      }
      setStatusMsg(err.message);
    },
  });

  const closeShiftMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.pos.shifts.close.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          shiftId: shiftId.trim(),
          actualCountedBalancesMinor: {
            USD: parseNonNegInt(closeUsdMinor, 0),
            VES: parseNonNegInt(closeVesMinor, 0),
          },
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setStatusMsg(`Turno ${data.shiftId} cerrado (${data.status})`);
      setShiftId('');
    },
    onError: (err) => setStatusMsg(err.message),
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const clientMutationId = crypto.randomUUID();
      const usdPay = parseNonNegInt(usdAmountMinor, 0);
      const vesPay = parseNonNegInt(vesAmountMinor, 0);
      const payments = [
        ...(usdPay > 0
          ? [{ financialAccountId: usdAccountId.trim(), currency: 'USD', methodCode: 'USD_CASH', amountMinor: usdPay }]
          : []),
        ...(vesPay > 0
          ? [{ financialAccountId: vesAccountId.trim(), currency: 'VES', methodCode: 'PAGO_MOVIL', amountMinor: vesPay }]
          : []),
      ];
      const payload = {
        clientMutationId,
        ...(shiftId.trim() ? { shiftId: shiftId.trim() } : { registerId: registerId.trim() }),
        orderCurrency: 'USD',
        items: [{ productId: activeProductId.trim(), qty: Math.max(1, parseNonNegInt(qty, 1)) }],
        payments,
      };

      try {
        const res = await rpc.api.pos.sales.checkout.$post({ json: payload });
        if (res.status >= 500) {
          await enqueueOfflineMutation({ clientMutationId, endpoint: '/api/pos/sales/checkout', kind: 'pos.sales.checkout', payload });
          return { queued: true as const };
        }
        if (!res.ok) throw await readApiError(res);
        return { queued: false as const, sale: await res.json() };
      } catch (err) {
        if (err instanceof TypeError) {
          await enqueueOfflineMutation({ clientMutationId, endpoint: '/api/pos/sales/checkout', kind: 'pos.sales.checkout', payload });
          return { queued: true as const };
        }
        throw err;
      }
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['pos', 'offlineQueue'] });
      setStatusMsg(res.queued ? `${vocabulary.orderSingular} encolado offline (IndexedDB)` : `${vocabulary.orderSingular} #${res.sale.orderNumber} cobrado`);
    },
    onError: (err) => setStatusMsg(err.message),
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      flushOfflineQueue((item) =>
        rpc.api.pos.sales.checkout.$post({
          json: item.payload as Parameters<typeof rpc.api.pos.sales.checkout.$post>[0]['json'],
        }),
      ),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['pos', 'offlineQueue'] });
      setStatusMsg(`Cola sincronizada: ${res.settled} liquidados, ${res.retained} pendientes`);
    },
  });

  function handleRestante() {
    const total = parseNonNegInt(orderTotalMinor, activeProduct ? activeProduct.basePriceMinor : 0);
    const nextVes = computeRestanteTargetMinor(
      total,
      parseNonNegInt(usdAmountMinor, 0),
      parseNonNegInt(rateMicros, 54_750_000),
    );
    setVesAmountMinor(String(nextVes));
  }

  function handleCheckout(e: FormEvent) {
    e.preventDefault();
    if (!activeProductId.trim() || checkoutMutation.isPending) return;
    checkoutMutation.mutate();
  }

  const pendingCount = queueQuery.data?.length ?? 0;
  const displayTotalMinor =
    parseNonNegInt(orderTotalMinor, 0) ||
    (activeProduct ? activeProduct.basePriceMinor * Math.max(1, parseNonNegInt(qty, 1)) : 0);

  return (
    <section className="space-y-4 p-4" data-slot="pos-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">POS · {vocabulary.orderSingular}</h1>
          <p className="text-sm text-muted-foreground">
            Cobro mixto en {vocabulary.branchSingular} ({vocabulary.spaceSingular}) con cola offline IndexedDB.
          </p>
        </div>
        <button
          type="button"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || pendingCount === 0}
          className="h-9 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          Sincronizar cola ({pendingCount})
        </button>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <input type="text" value={registerId} onChange={(e) => setRegisterId(e.target.value)} placeholder={vocabulary.spaceSingular} className={INPUT_CLS} />
          <input type="text" value={cashierName} onChange={(e) => setCashierName(e.target.value)} placeholder="Cajero" className={INPUT_CLS} />
          <input type="text" value={shiftId} onChange={(e) => setShiftId(e.target.value)} placeholder="Shift ID (auto al abrir)" className={`${INPUT_CLS} font-mono text-xs`} />
          <button type="button" onClick={() => openShiftMutation.mutate()} disabled={openShiftMutation.isPending} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
            {openShiftMutation.isPending ? 'Abriendo...' : `Abrir ${vocabulary.spaceSingular}`}
          </button>
        </div>
        {shiftId.trim() ? (
          <div className="grid grid-cols-1 gap-2 border-t border-border pt-2 md:grid-cols-3">
            <input type="number" min={0} step={1} value={closeUsdMinor} onChange={(e) => setCloseUsdMinor(e.target.value)} placeholder="Conteo cierre USD (minor)" className={`${INPUT_CLS} font-mono tabular-nums`} />
            <input type="number" min={0} step={1} value={closeVesMinor} onChange={(e) => setCloseVesMinor(e.target.value)} placeholder="Conteo cierre VES (minor)" className={`${INPUT_CLS} font-mono tabular-nums`} />
            <button type="button" onClick={() => closeShiftMutation.mutate()} disabled={closeShiftMutation.isPending} className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">
              {closeShiftMutation.isPending ? 'Cerrando...' : 'Cerrar Turno'}
            </button>
          </div>
        ) : null}
      </div>

      <form onSubmit={handleCheckout} className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <select
            value={activeProductId}
            onChange={(e) => {
              setProductId(e.target.value);
              syncProductTotals(e.target.value, qty);
            }}
            className={INPUT_CLS}
          >
            {products.length === 0 ? (
              <option value="">Sin productos en catálogo</option>
            ) : (
              products.map((prod) => (
                <option key={prod.id} value={prod.id}>
                  {prod.sku} · {prod.name} ({formatMinorUnits(prod.basePriceMinor, prod.primaryCurrency)})
                </option>
              ))
            )}
          </select>
          <input
            type="number"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => {
              setQty(e.target.value);
              syncProductTotals(activeProductId, e.target.value);
            }}
            placeholder="Cantidad"
            className={`${INPUT_CLS} font-mono tabular-nums`}
          />
          <input type="number" min={0} step={1} value={orderTotalMinor} onChange={(e) => setOrderTotalMinor(e.target.value)} placeholder="Total USD minor" className={`${INPUT_CLS} font-mono tabular-nums`} />
          <input type="number" min={1} step={1} value={rateMicros} onChange={(e) => setRateMicros(e.target.value)} placeholder="Tasa micros" className={`${INPUT_CLS} font-mono tabular-nums`} />
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <input type="text" value={usdAccountId} onChange={(e) => setUsdAccountId(e.target.value)} placeholder="Cuenta USD" className={`${INPUT_CLS} font-mono text-xs`} />
          <input type="number" min={0} step={1} value={usdAmountMinor} onChange={(e) => setUsdAmountMinor(e.target.value)} placeholder="Pago USD minor" className={`${INPUT_CLS} font-mono tabular-nums`} />
          <input type="text" value={vesAccountId} onChange={(e) => setVesAccountId(e.target.value)} placeholder="Cuenta VES" className={`${INPUT_CLS} font-mono text-xs`} />
          <input type="number" min={0} step={1} value={vesAmountMinor} onChange={(e) => setVesAmountMinor(e.target.value)} placeholder="Pago VES minor" className={`${INPUT_CLS} font-mono tabular-nums`} />
          <div className="flex gap-2">
            <button type="button" onClick={handleRestante} className="h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted">
              Restante
            </button>
            <button type="submit" disabled={checkoutMutation.isPending || !activeProductId} className="h-9 flex-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {checkoutMutation.isPending ? 'Cobrando...' : 'Cobrar'}
            </button>
          </div>
        </div>
        <p className="text-xs font-mono text-muted-foreground">
          Total: {formatMinorUnits(displayTotalMinor, 'USD')} · USD: {formatMinorUnits(parseNonNegInt(usdAmountMinor, 0), 'USD')} · VES: {formatMinorUnits(parseNonNegInt(vesAmountMinor, 0), 'VES')}
        </p>
      </form>

      {statusMsg ? (
        <p className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-mono">{statusMsg}</p>
      ) : null}
    </section>
  );
}
