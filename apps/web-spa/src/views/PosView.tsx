import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  enqueueOfflineMutation,
  flushOfflineQueue,
  listOfflineQueue,
} from '../lib/offlineQueue';
import {
  formatMinorToInput,
  formatMinorUnits,
  INPUT_CLS,
  parseMajorToMinor,
  parseNonNegInt,
  readApiError,
  ShacApiError,
  type Phase2ViewProps,
} from './phase2-format';

interface CartLine {
  productId: string;
  sku: string;
  name: string;
  unitPriceMinor: number;
  qty: number;
}

function usdToVesMinor(usdMinor: number, rateMicros: number): number {
  const safeRate = rateMicros > 0 ? rateMicros : 1_000_000;
  return Number((BigInt(Math.max(0, usdMinor)) * BigInt(safeRate) + 500_000n) / 1_000_000n);
}

/** GeorginaPOS-style 2-column Cash Register: Product Grid (left) + Multi-line Receipt (right). */
export function PosView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [registerId, setRegisterId] = useState('REG-1');
  const [shiftId, setShiftId] = useState('');
  const [cashierName, setCashierName] = useState('Cajero');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [rateInput, setRateInput] = useState('54.75');
  const [usdInput, setUsdInput] = useState('0.00');
  const [vesInput, setVesInput] = useState('0.00');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ['catalog', 'products', 'pos-grid'],
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

  const rateMicros = Math.max(1, parseMajorToMinor(rateInput) * 10_000);
  const cartTotalMinor = cart.reduce((acc, item) => acc + item.unitPriceMinor * item.qty, 0);
  const cartTotalVesMinor = usdToVesMinor(cartTotalMinor, rateMicros);

  function addToCart(prod: { id: string; sku: string; name: string; basePriceMinor: number }) {
    setCart((prev) => {
      const idx = prev.findIndex((line) => line.productId === prod.id);
      const next =
        idx >= 0
          ? prev.map((line, i) => (i === idx ? { ...line, qty: line.qty + 1 } : line))
          : [...prev, { productId: prod.id, sku: prod.sku, name: prod.name, unitPriceMinor: prod.basePriceMinor, qty: 1 }];
      const nextTotal = next.reduce((acc, item) => acc + item.unitPriceMinor * item.qty, 0);
      setUsdInput(formatMinorToInput(nextTotal));
      setVesInput('0.00');
      return next;
    });
  }

  function updateQty(productId: string, delta: number) {
    setCart((prev) => {
      const next = prev
        .map((line) => (line.productId === productId ? { ...line, qty: line.qty + delta } : line))
        .filter((line) => line.qty > 0);
      const nextTotal = next.reduce((acc, item) => acc + item.unitPriceMinor * item.qty, 0);
      setUsdInput(formatMinorToInput(nextTotal));
      setVesInput('0.00');
      return next;
    });
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
      setStatusMsg(`Caja ${data.registerId} abierta`);
    },
    onError: (err) => {
      if (err instanceof ShacApiError && err.code === 'SHIFT_ALREADY_OPEN') {
        const openId = err.details?.openShiftId;
        if (typeof openId === 'string' && openId.length > 0) {
          setShiftId(openId);
          setStatusMsg(`Sesión activa recuperada en ${registerId}`);
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
          actualCountedBalancesMinor: { USD: 0, VES: 0 },
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setShiftId('');
      setCart([]);
      setStatusMsg(`Caja ${registerId} cerrada`);
    },
    onError: (err) => setStatusMsg(err.message),
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const clientMutationId = crypto.randomUUID();
      const usdPay = parseMajorToMinor(usdInput);
      const vesPay = parseMajorToMinor(vesInput);
      const payments = [
        ...(usdPay > 0
          ? [{ financialAccountId: 'acc_usd_cash', currency: 'USD', methodCode: 'USD_CASH', amountMinor: usdPay }]
          : []),
        ...(vesPay > 0
          ? [{ financialAccountId: 'acc_ves_pm', currency: 'VES', methodCode: 'PAGO_MOVIL', amountMinor: vesPay }]
          : []),
      ];
      const payload = {
        clientMutationId,
        shiftId: shiftId.trim(),
        orderCurrency: 'USD',
        items: cart.map((line) => ({ productId: line.productId, qty: line.qty })),
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
      setCart([]);
      setUsdInput('0.00');
      setVesInput('0.00');
      setStatusMsg(res.queued ? 'Ticket encolado offline (IndexedDB)' : `Venta #${res.sale.orderNumber} cobrada`);
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
    const usdPaid = parseMajorToMinor(usdInput);
    const remainingUsd = cartTotalMinor > usdPaid ? cartTotalMinor - usdPaid : 0;
    setVesInput(formatMinorToInput(usdToVesMinor(remainingUsd, rateMicros)));
  }

  function handleCheckout(e: FormEvent) {
    e.preventDefault();
    if (cart.length === 0 || checkoutMutation.isPending) return;
    checkoutMutation.mutate();
  }

  const pendingCount = queueQuery.data?.length ?? 0;
  const term = search.trim().toLowerCase();
  const filteredProducts = (productsQuery.data?.items ?? []).filter(
    (p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term),
  );

  return (
    <section className="space-y-4 p-4" data-slot="pos-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">POS · Caja Registradora</h1>
          <p className="text-sm text-muted-foreground">
            {vocabulary.branchSingular} · Tasa ref. {rateInput} Bs/USD
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 ? (
            <button type="button" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="h-9 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted">
              Sincronizar cola ({pendingCount})
            </button>
          ) : null}
          {shiftId ? (
            <button type="button" onClick={() => closeShiftMutation.mutate()} disabled={closeShiftMutation.isPending} className="h-9 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted">
              {closeShiftMutation.isPending ? 'Cerrando...' : 'Cerrar Caja'}
            </button>
          ) : null}
        </div>
      </div>

      {statusMsg ? (
        <div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-mono">{statusMsg}</div>
      ) : null}

      {!shiftId ? (
        <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-center">
          <h2 className="text-lg font-semibold">Sesión de Caja Cerrada</h2>
          <p className="text-sm text-muted-foreground">
            Abre una sesión en {registerId} para comenzar a facturar.
          </p>
          <div className="grid grid-cols-2 gap-2 text-left">
            <label className="space-y-1 text-xs">
              <span>Caja</span>
              <input className={`${INPUT_CLS} w-full`} value={registerId} onChange={(e) => setRegisterId(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs">
              <span>Cajero</span>
              <input className={`${INPUT_CLS} w-full`} value={cashierName} onChange={(e) => setCashierName(e.target.value)} />
            </label>
          </div>
          <button type="button" onClick={() => openShiftMutation.mutate()} disabled={openShiftMutation.isPending} className="h-11 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground">
            {openShiftMutation.isPending ? 'Abriendo Caja...' : 'Abrir Caja'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-3">
            <div className="flex gap-2">
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto por nombre o SKU..." className={`${INPUT_CLS} flex-1`} />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Tasa Bs</span>
                <input type="text" value={rateInput} onChange={(e) => setRateInput(e.target.value)} className={`${INPUT_CLS} w-20 font-mono tabular-nums`} />
              </label>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
              {filteredProducts.map((prod) => (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => addToCart(prod)}
                  className="flex flex-col justify-between rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary hover:bg-muted/40"
                >
                  <div>
                    <p className="font-mono text-[11px] text-muted-foreground">{prod.sku}</p>
                    <p className="text-sm font-semibold leading-snug">{prod.name}</p>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between font-mono text-xs tabular-nums">
                    <span className="font-bold text-primary">{formatMinorUnits(prod.basePriceMinor, 'USD')}</span>
                    <span className="text-muted-foreground">{formatMinorUnits(usdToVesMinor(prod.basePriceMinor, rateMicros), 'VES')}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleCheckout} className="flex flex-col justify-between space-y-4 rounded-xl border border-border bg-card p-4 lg:col-span-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <h2 className="text-base font-semibold">Recibo Actual</h2>
                {cart.length > 0 ? (
                  <button type="button" onClick={() => setCart([])} className="text-xs text-muted-foreground hover:text-foreground">
                    Limpiar
                  </button>
                ) : null}
              </div>

              {cart.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Toca un producto a la izquierda para agregarlo al ticket.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {cart.map((line) => (
                    <li key={line.productId} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{line.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {formatMinorUnits(line.unitPriceMinor, 'USD')} × {line.qty}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => updateQty(line.productId, -1)} className="h-7 w-7 rounded border border-border text-xs hover:bg-muted">-</button>
                        <span className="w-6 text-center font-mono text-xs tabular-nums">{line.qty}</span>
                        <button type="button" onClick={() => updateQty(line.productId, 1)} className="h-7 w-7 rounded border border-border text-xs hover:bg-muted">+</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3 border-t border-border pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Total a Pagar</span>
                <div className="text-right font-mono tabular-nums">
                  <p className="text-xl font-bold">{formatMinorUnits(cartTotalMinor, 'USD')}</p>
                  <p className="text-xs text-muted-foreground">{formatMinorUnits(cartTotalVesMinor, 'VES')}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs">
                  <span>Efectivo USD ($)</span>
                  <input type="text" value={usdInput} onChange={(e) => setUsdInput(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
                </label>
                <label className="space-y-1 text-xs">
                  <span>Pago Móvil (Bs)</span>
                  <input type="text" value={vesInput} onChange={(e) => setVesInput(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
                </label>
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={handleRestante} disabled={cart.length === 0} className="h-10 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50">
                  Restante Bs
                </button>
                <button type="submit" disabled={checkoutMutation.isPending || cart.length === 0} className="h-10 flex-1 rounded-md bg-checkout px-4 text-sm font-semibold text-checkout-foreground disabled:opacity-50">
                  {checkoutMutation.isPending ? 'Procesando...' : 'Registrar Pago'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
