import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, Clock, KeyRound, Lock, Play, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { PageHeader, StatusBadge } from '@shac/ui';
import { listOfflineQueue } from '../lib/offlineQueue';
import { PosAudio } from '../lib/posAudio';
import {
  applyLineDiscountMinor,
  findProductByScanCode,
  useDebouncedValue,
  useGlobalBarcodeHid,
} from '../lib/usePosScanner';
import { usePosShiftAndCheckout } from '../lib/usePosShiftAndCheckout';
import { PosCameraScannerModal } from './PosCameraScannerModal';
import { PosCashClosingModal } from './PosCashClosingModal';
import {
  parkOrderToList,
  PosHoldOrdersModal,
  recallOrderFromList,
  type HeldPosOrder,
} from './PosHoldOrdersModal';
import { PosReceiptPanel, type PosCartLine } from './PosReceiptPanel';
import { PosProModals } from './PosProModals';
import { PosTenderModal } from './PosTenderModal';
import {
  formatMinorToInput, formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps,
} from './phase2-format';

function usdToVesMinor(usdMinor: number, rateMicros: number): number {
  const safeRate = rateMicros > 0 ? rateMicros : 1_000_000;
  return Number((BigInt(Math.max(0, usdMinor)) * BigInt(safeRate) + 500_000n) / 1_000_000n);
}

function loadHeldOrders(registerId: string): HeldPosOrder[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`shac_pos_held_${registerId}`);
    return raw ? (JSON.parse(raw) as HeldPosOrder[]) : [];
  } catch {
    return [];
  }
}

/** Omni-Turbo POS: Debounced 300ms search, HID+Camera barcode scanner, Leylan held orders, touch keypad & dual change. */
export function PosView({ vocabulary, rpc }: Phase2ViewProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [registerId, setRegisterId] = useState('REG-1');
  const [shiftId, setShiftId] = useState('');
  const [cashierName, setCashierName] = useState('Cajero');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [heldOrders, setHeldOrders] = useState<HeldPosOrder[]>(() => loadHeldOrders('REG-1'));
  const [rateInput, setRateInput] = useState('54.75');
  const [usdInput, setUsdInput] = useState('0.00');
  const [vesInput, setVesInput] = useState('0.00');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [tenderOpen, setTenderOpen] = useState(false);
  const [closingOpen, setClosingOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);

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

  useEffect(() => {
    try { window.localStorage?.setItem(`shac_pos_held_${registerId}`, JSON.stringify(heldOrders)); } catch { /* ignore */ }
  }, [heldOrders, registerId]);

  const { openShiftMutation, closeShiftMutation, checkoutMutation, syncMutation } = usePosShiftAndCheckout({
    rpc, registerId, cashierName, shiftId, setShiftId, setCart, setUsdInput, setVesInput, setStatusMsg, cart, usdInput, vesInput,
  });

  const rateMicros = Math.max(1, parseMajorToMinor(rateInput) * 10_000);
  const cartTotalMinor = cart.reduce(
    (acc, item) => acc + applyLineDiscountMinor(item.unitPriceMinor * item.qty, item.discountBps ?? 0),
    0,
  );
  const cartTotalVesMinor = usdToVesMinor(cartTotalMinor, rateMicros);

  const syncPaymentInputs = useCallback((nextCart: PosCartLine[]) => {
    const nextTotal = nextCart.reduce(
      (acc, item) => acc + applyLineDiscountMinor(item.unitPriceMinor * item.qty, item.discountBps ?? 0),
      0,
    );
    setUsdInput(formatMinorToInput(nextTotal));
    setVesInput('0.00');
  }, []);

  const addToCart = useCallback(
    (prod: { id: string; sku: string; name: string; basePriceMinor: number }) => {
      PosAudio.playScanBeep();
      setCart((prev) => {
        const idx = prev.findIndex((line) => line.productId === prod.id);
        const next =
          idx >= 0
            ? prev.map((line, i) => (i === idx ? { ...line, qty: line.qty + 1 } : line))
            : [...prev, { productId: prod.id, sku: prod.sku, name: prod.name, unitPriceMinor: prod.basePriceMinor, qty: 1 }];
        syncPaymentInputs(next);
        return next;
      });
    },
    [syncPaymentInputs],
  );

  const handleScanCode = useCallback(
    (code: string) => {
      const match = findProductByScanCode(productsQuery.data?.items ?? [], code);
      if (match) {
        addToCart(match);
        setStatusMsg(`Escaneado: ${match.sku} · ${match.name}`);
      } else {
        PosAudio.playErrorTone();
        setStatusMsg(`Código no encontrado: ${code}`);
      }
    },
    [productsQuery.data?.items, addToCart],
  );

  useGlobalBarcodeHid(handleScanCode, Boolean(shiftId) && !scannerOpen && !tenderOpen && !closingOpen);

  const handleParkOrder = useCallback(() => {
    if (cart.length === 0) return;
    const label = window.prompt('Nombre o referencia del cliente (Leylan / Espera):', 'Cliente en Fila') ?? 'Cliente en Fila';
    setHeldOrders((prev) => parkOrderToList(prev, { customerName: label, items: cart, totalMinor: cartTotalMinor }));
    setCart([]);
    setUsdInput('0.00');
    setVesInput('0.00');
    setStatusMsg(`Ticket aparcado (${label})`);
  }, [cart, cartTotalMinor]);

  useEffect(() => {
    if (!shiftId || typeof window === 'undefined') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'F1') { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === 'F8') { e.preventDefault(); handleParkOrder(); }
      if (e.key === 'F9' && cart.length > 0) { e.preventDefault(); setTenderOpen(true); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shiftId, cart.length, handleParkOrder]);

  function updateQty(productId: string, delta: number) {
    setCart((prev) => {
      const next = prev
        .map((line) => (line.productId === productId ? { ...line, qty: line.qty + delta } : line))
        .filter((line) => line.qty > 0);
      syncPaymentInputs(next);
      return next;
    });
  }

  function toggleDiscount(productId: string) {
    setCart((prev) => {
      const next = prev.map((line) =>
        line.productId === productId ? { ...line, discountBps: line.discountBps ? 0 : 1000 } : line,
      );
      syncPaymentInputs(next);
      return next;
    });
  }

  function handleRestante() {
    const usdPaid = parseMajorToMinor(usdInput);
    const remainingUsd = cartTotalMinor > usdPaid ? cartTotalMinor - usdPaid : 0;
    setVesInput(formatMinorToInput(usdToVesMinor(remainingUsd, rateMicros)));
  }

  function handleCheckout(e?: FormEvent) {
    e?.preventDefault();
    if (cart.length === 0 || checkoutMutation.isPending) return;
    checkoutMutation.mutate();
  }

  const pendingCount = queueQuery.data?.length ?? 0;
  const term = debouncedSearch.trim().toLowerCase();
  const filteredProducts = (productsQuery.data?.items ?? []).filter(
    (p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term),
  );

  return (
    <section className="space-y-5" data-slot="pos-view">
      <PageHeader
        title={`POS · ${vocabulary.orderSingular}`}
        description={`${vocabulary.branchSingular} · Tasa ${rateInput} Bs/USD · F1 Escanear · F8 Leylan · F9 Cobrar`}
        onRefresh={() => void productsQuery.refetch()}
        refreshing={productsQuery.isFetching}
        actions={
          <>
            {shiftId ? <StatusBadge label={`Turno ${registerId}`} tone="success" appearance="dot" /> : null}
            {shiftId ? (
              <button type="button" onClick={() => setHeldOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-muted">
                <Clock className="size-3.5 text-amber-500" /><span>Espera ({heldOrders.length})</span>
              </button>
            ) : null}
            {pendingCount > 0 ? (
              <button type="button" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-muted">
                <RefreshCw className="size-3.5" /><span>Sincronizar ({pendingCount})</span>
              </button>
            ) : null}
            {shiftId ? (
              <>
                <button type="button" onClick={() => setPinOpen(true)} title="Relevo de Cajero (PIN)" className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium shadow-xs hover:bg-muted">
                  <KeyRound className="size-3.5 text-primary" /><span>{cashierName}</span>
                </button>
                <button type="button" onClick={() => setReturnOpen(true)} title="Devolución Rápida" className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium shadow-xs hover:bg-muted">
                  <RotateCcw className="size-3.5 text-amber-500" /><span>Devolución</span>
                </button>
                <button type="button" onClick={() => setClosingOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-muted">
                  <Lock className="size-3.5 text-muted-foreground" /><span>Cerrar Caja</span>
                </button>
              </>
            ) : null}
          </>
        }
      />
      {statusMsg ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{statusMsg}</p> : null}
      {!shiftId ? (
        <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-xs">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Sesión de Caja Cerrada</h2>
            <p className="text-sm text-muted-foreground">Abre turno en {registerId} para comenzar a facturar.</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 text-left">
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Caja</span><input className={`${INPUT_CLS} w-full`} value={registerId} onChange={(e) => setRegisterId(e.target.value)} /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Cajero</span><input className={`${INPUT_CLS} w-full`} value={cashierName} onChange={(e) => setCashierName(e.target.value)} /></label>
          </div>
          <button type="button" onClick={() => openShiftMutation.mutate()} disabled={openShiftMutation.isPending} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary-hover">
            <Play className="size-3.5" /><span>{openShiftMutation.isPending ? 'Abriendo Caja...' : 'Abrir Caja'}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input ref={searchInputRef} type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && search.trim()) { e.preventDefault(); handleScanCode(search); setSearch(''); } }}
                  placeholder="Buscar o escanear SKU + Enter (F1)..." className={`${INPUT_CLS} w-full pl-9`} />
              </div>
              <button type="button" onClick={() => setScannerOpen(true)} title="Escáner con cámara" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted">
                <Camera className="size-4 text-primary" />
              </button>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Bs</span><input type="text" value={rateInput} onChange={(e) => setRateInput(e.target.value)} className={`${INPUT_CLS} w-20 font-mono tabular-nums`} />
              </label>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
              {filteredProducts.map((prod) => (
                <button key={prod.id} type="button" onClick={() => addToCart(prod)} className="flex flex-col justify-between rounded-xl border border-border bg-card p-3.5 text-left shadow-xs transition-colors hover:border-foreground/40 hover:bg-muted/35">
                  <div className="space-y-0.5"><p className="font-mono text-[11px] text-muted-foreground">{prod.sku}</p><p className="text-sm font-medium leading-snug">{prod.name}</p></div>
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
            onUpdateQty={updateQty} onToggleDiscount={toggleDiscount} onHoldOrder={handleParkOrder}
            onOpenTender={() => setTenderOpen(true)} onClearCart={() => setCart([])} onFillRestante={handleRestante}
            onSubmit={handleCheckout} submitting={checkoutMutation.isPending}
          />
        </div>
      )}
      <PosCameraScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={handleScanCode} />
      <PosHoldOrdersModal open={heldOpen} onClose={() => setHeldOpen(false)} heldOrders={heldOrders}
        onRecall={(id) => { const { recalled, remaining } = recallOrderFromList(heldOrders, id); if (recalled) { setCart(recalled.items); syncPaymentInputs(recalled.items); setHeldOrders(remaining); setStatusMsg(`Ticket retomado: ${recalled.customerName}`); } }}
        onDelete={(id) => setHeldOrders((prev) => prev.filter((o) => o.id !== id))} />
      <PosTenderModal open={tenderOpen} onClose={() => setTenderOpen(false)} totalUsdMinor={cartTotalMinor} rateMicros={rateMicros}
        usdInput={usdInput} vesInput={vesInput} onUsdChange={setUsdInput} onVesChange={setVesInput}
        onFillRestante={handleRestante} onConfirmCheckout={() => handleCheckout()} submitting={checkoutMutation.isPending} />
      <PosCashClosingModal open={closingOpen} onClose={() => setClosingOpen(false)} registerId={registerId} cashierName={cashierName}
        onConfirmClose={(counted) => closeShiftMutation.mutate(counted)} submitting={closeShiftMutation.isPending} />
      <PosProModals rpc={rpc} pinOpen={pinOpen} onClosePin={() => setPinOpen(false)} onSwitchCashier={(n) => { setCashierName(n); setStatusMsg(`Relevo activo: ${n}`); }}
        returnOpen={returnOpen} onCloseReturn={() => setReturnOpen(false)} onReturnSuccess={(m) => setStatusMsg(m)} />
    </section>
  );
}
