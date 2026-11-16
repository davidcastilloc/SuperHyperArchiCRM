import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Play, RefreshCw, Search } from 'lucide-react';
import { PageHeader, StatusBadge } from '@shac/ui';
import { enqueueOfflineMutation, flushOfflineQueue, listOfflineQueue } from '../lib/offlineQueue';
import { PosReceiptPanel, type PosCartLine } from './PosReceiptPanel';
import {
  formatMinorToInput, formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, ShacApiError, type Phase2ViewProps,
} from './phase2-format';

function usdToVesMinor(usdMinor: number, rateMicros: number): number {
  const safeRate = rateMicros > 0 ? rateMicros : 1_000_000;
  return Number((BigInt(Math.max(0, usdMinor)) * BigInt(safeRate) + 500_000n) / 1_000_000n);
}

/** Open Mercato DS v3 2-column Cash Register: Product Grid (left) + Multi-line Receipt (right). */
export function PosView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [registerId, setRegisterId] = useState('REG-1');
  const [shiftId, setShiftId] = useState('');
  const [cashierName, setCashierName] = useState('Cajero');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<PosCartLine[]>([]);
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
    <section className="space-y-5" data-slot="pos-view">
      <PageHeader
        title={`POS · ${vocabulary.orderSingular}`}
        description={`${vocabulary.branchSingular} · Tasa referencial ${rateInput} Bs/USD`}
        onRefresh={() => void productsQuery.refetch()}
        refreshing={productsQuery.isFetching}
        actions={
          <>
            {shiftId ? <StatusBadge label={`Turno ${registerId}`} tone="success" appearance="dot" /> : null}
            {pendingCount > 0 ? (
              <button type="button" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-muted">
                <RefreshCw className="size-3.5" />
                <span>Sincronizar ({pendingCount})</span>
              </button>
            ) : null}
            {shiftId ? (
              <button type="button" onClick={() => closeShiftMutation.mutate()} disabled={closeShiftMutation.isPending} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-muted">
                <Lock className="size-3.5 text-muted-foreground" />
                <span>{closeShiftMutation.isPending ? 'Cerrando...' : 'Cerrar Caja'}</span>
              </button>
            ) : null}
          </>
        }
      />

      {statusMsg ? (
        <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{statusMsg}</p>
      ) : null}

      {!shiftId ? (
        <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-xs">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Sesión de Caja Cerrada</h2>
            <p className="text-sm text-muted-foreground">Abre turno en {registerId} para comenzar a facturar.</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 text-left">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Caja</span>
              <input className={`${INPUT_CLS} w-full`} value={registerId} onChange={(e) => setRegisterId(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Cajero</span>
              <input className={`${INPUT_CLS} w-full`} value={cashierName} onChange={(e) => setCashierName(e.target.value)} />
            </label>
          </div>
          <button type="button" onClick={() => openShiftMutation.mutate()} disabled={openShiftMutation.isPending} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary-hover">
            <Play className="size-3.5" />
            <span>{openShiftMutation.isPending ? 'Abriendo Caja...' : 'Abrir Caja'}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto por nombre o SKU..." className={`${INPUT_CLS} w-full pl-9`} />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Tasa Bs</span>
                <input type="text" value={rateInput} onChange={(e) => setRateInput(e.target.value)} className={`${INPUT_CLS} w-20 font-mono tabular-nums`} />
              </label>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
              {filteredProducts.map((prod) => (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => addToCart(prod)}
                  className="flex flex-col justify-between rounded-xl border border-border bg-card p-3.5 text-left shadow-xs transition-colors hover:border-foreground/40 hover:bg-muted/35"
                >
                  <div className="space-y-0.5">
                    <p className="font-mono text-[11px] text-muted-foreground">{prod.sku}</p>
                    <p className="text-sm font-medium leading-snug">{prod.name}</p>
                  </div>
                  <div className="mt-3 flex items-baseline justify-between font-mono text-xs tabular-nums">
                    <span className="font-semibold text-foreground">{formatMinorUnits(prod.basePriceMinor, 'USD')}</span>
                    <span className="text-muted-foreground">{formatMinorUnits(usdToVesMinor(prod.basePriceMinor, rateMicros), 'VES')}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <PosReceiptPanel
            cart={cart} cartTotalMinor={cartTotalMinor} cartTotalVesMinor={cartTotalVesMinor}
            usdInput={usdInput} vesInput={vesInput} onUsdChange={setUsdInput} onVesChange={setVesInput}
            onUpdateQty={updateQty} onClearCart={() => setCart([])} onFillRestante={handleRestante}
            onSubmit={handleCheckout} submitting={checkoutMutation.isPending}
          />
        </div>
      )}
    </section>
  );
}
