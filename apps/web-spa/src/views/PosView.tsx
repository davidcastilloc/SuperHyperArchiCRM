import { useQuery } from '@tanstack/react-query';
import { Camera, Clock, KeyRound, Lock, Play, RefreshCw, RotateCcw, Search, Unlock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { PageHeader, StatusBadge } from '@shac/ui';
import { useAuthSession } from '../lib/authSession';
import { useMarketProfile } from '../lib/marketProfile';
import { listOfflineQueue } from '../lib/offlineQueue';
import { PosAudio } from '../lib/posAudio';
import { findProductByScanCode, useDebouncedValue, useGlobalBarcodeHid } from '../lib/usePosScanner';
import { loadPersistedPosState, savePersistedPosState, usePosShiftAndCheckout } from '../lib/usePosShiftAndCheckout';
import { formatMinorToInput, formatMinorUnits, INPUT_CLS, parseMajorToMinor, parseRateToMicros, readApiError, usdToVesMinor, type Phase2ViewProps } from './phase2-format';
import { PosCameraScannerModal } from './PosCameraScannerModal';
import { PosCashClosingModal } from './PosCashClosingModal';
import { parkOrderToList, PosHoldOrdersModal, PosHoldPromptModal, recallOrderFromList, type HeldPosOrder } from './PosHoldOrdersModal';
import { computeCartTotalWithCouponMinor, PosReceiptPanel, type PosCartLine } from './PosReceiptPanel';
import { PosProModals } from './PosProModals';
import { PosTenderModal } from './PosTenderModal';

/** Dual-currency 62/38 tactile POS (1024x768 zero-scroll) with HID scanner, Hold Orders & Z-Report. */
export function PosView({ vocabulary, rpc }: Phase2ViewProps) {
  const profile = useMarketProfile();
  const session = useAuthSession();
  const scopeKey = `${profile.tenantId}:${session?.actor.orgId ?? 'org_1'}`;
  const initialPersisted = useMemo(() => loadPersistedPosState(scopeKey), [scopeKey]);

  const [shiftId, setShiftId] = useState(() => initialPersisted?.shiftId ?? '');
  const [registerId, setRegisterId] = useState(() => initialPersisted?.registerId ?? 'CAJA-01');
  const [cashierName, setCashierName] = useState(() => session?.actor.fullName ?? 'Cajero Principal');
  const [openingUsdInput, setOpeningUsdInput] = useState('0.00');
  const [openingVesInput, setOpeningVesInput] = useState('0.00');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [rateInput, setRateInput] = useState('54.75');
  const [rateUnlocked, setRateUnlocked] = useState(false);
  const [cart, setCart] = useState<PosCartLine[]>(() => initialPersisted?.cart ?? []);
  const [usdInput, setUsdInput] = useState('0.00');
  const [vesInput, setVesInput] = useState('0.00');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [holdLabelDraft, setHoldLabelDraft] = useState('');
  const [holdPromptOpen, setHoldPromptOpen] = useState(false);
  const [tenderOpen, setTenderOpen] = useState(false);
  const [closingOpen, setClosingOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [heldOrders, setHeldOrders] = useState<HeldPosOrder[]>([]);
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscountBps, setCouponDiscountBps] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { savePersistedPosState(scopeKey, { shiftId, registerId, cart }); }, [scopeKey, shiftId, registerId, cart]);

  const rateMicros = parseRateToMicros(rateInput);
  const cartTotalMinor = computeCartTotalWithCouponMinor(cart, couponDiscountBps);
  const cartTotalVesMinor = usdToVesMinor(cartTotalMinor, rateMicros);

  const productsQuery = useQuery({
    queryKey: ['pos', 'products', debouncedSearch],
    queryFn: async () => {
      const res = await rpc.api.catalog.products.$get({ query: { limit: '100', ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}) } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const promosQuery = useQuery({
    queryKey: ['pos', 'promotions'],
    queryFn: async () => {
      const res = await rpc.api.catalog.promotions.$get();
      return res.ok ? res.json() : { items: [] as Array<{ code: string; discountBps?: number; active?: boolean }> };
    },
    staleTime: 60_000,
  });

  const queueQuery = useQuery({ queryKey: ['pos', 'offlineQueue'], queryFn: () => listOfflineQueue(), refetchInterval: 4000 });

  const {
    openShiftMutation,
    closeShiftMutation,
    checkoutMutation,
    syncMutation,
    lastClosedReport,
    clearLastClosedReport,
  } = usePosShiftAndCheckout({
    rpc,
    registerId,
    cashierName,
    shiftId,
    setShiftId,
    setCart,
    setUsdInput,
    setVesInput,
    setStatusMsg,
    cart,
    usdInput,
    vesInput,
    rateMicros,
    openingUsdMinor: parseMajorToMinor(openingUsdInput),
    openingVesMinor: parseMajorToMinor(openingVesInput),
  });

  const syncPaymentInputs = useCallback((nextCart: PosCartLine[], nextCouponBps = couponDiscountBps) => {
    const nextTotal = computeCartTotalWithCouponMinor(nextCart, nextCouponBps);
    setUsdInput(formatMinorToInput(nextTotal));
    setVesInput('0.00');
  }, [couponDiscountBps]);

  const addToCart = useCallback((product: { id: string; sku: string; name: string; basePriceMinor: number }) => {
    PosAudio.playScanBeep();
    setCart((prev) => {
      const existing = prev.find((line) => line.productId === product.id);
      const next = existing
        ? prev.map((line) => (line.productId === product.id ? { ...line, qty: line.qty + 1 } : line))
        : [...prev, { productId: product.id, sku: product.sku, name: product.name, unitPriceMinor: product.basePriceMinor, qty: 1, discountBps: 0 }];
      syncPaymentInputs(next);
      return next;
    });
  }, [syncPaymentInputs]);

  const handleScanCode = useCallback((code: string) => {
    const match = findProductByScanCode(productsQuery.data?.items ?? [], code);
    if (match) {
      addToCart(match);
      setStatusMsg(`Escaneado: ${match.sku} · ${match.name}`);
    } else {
      PosAudio.playErrorTone();
      setStatusMsg(`Código no encontrado: ${code}`);
    }
  }, [productsQuery.data?.items, addToCart]);

  useGlobalBarcodeHid(handleScanCode, Boolean(shiftId) && !scannerOpen && !tenderOpen && !closingOpen && !holdPromptOpen);

  function commitParkOrder() {
    if (cart.length === 0) return;
    const label = holdLabelDraft.trim() || 'Cliente en Fila';
    setHeldOrders((prev) => parkOrderToList(prev, { customerName: label, items: cart, totalMinor: cartTotalMinor }));
    setCart([]);
    setUsdInput('0.00');
    setVesInput('0.00');
    setHoldLabelDraft('');
    setHoldPromptOpen(false);
    setStatusMsg(`Ticket aparcado (${label})`);
  }

  function toggleDiscount(productId: string) {
    setCart((prev) => {
      const next = prev.map((line) => (line.productId === productId ? { ...line, discountBps: line.discountBps ? 0 : 1000 } : line));
      syncPaymentInputs(next);
      return next;
    });
  }

  function updateQty(productId: string, delta: number) {
    setCart((prev) => {
      const next = prev.map((line) => (line.productId === productId ? { ...line, qty: line.qty + delta } : line)).filter((line) => line.qty > 0);
      syncPaymentInputs(next);
      return next;
    });
  }

  useEffect(() => {
    if (!shiftId || typeof window === 'undefined') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'F2') { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === 'F4' && cart.length > 0) { e.preventDefault(); updateQty(cart[cart.length - 1]!.productId, 1); }
      if (e.key === 'F8' && cart.length > 0) { e.preventDefault(); setHoldPromptOpen(true); }
      if (e.key === 'F9' && cart.length > 0) { e.preventDefault(); toggleDiscount(cart[cart.length - 1]!.productId); }
      if (e.key === 'F10' && cart.length > 0) { e.preventDefault(); setTenderOpen(true); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shiftId, cart]);

  function handleApplyCoupon(code: string) {
    const clean = code.trim().toUpperCase();
    if (!clean) { setCouponCode(''); setCouponDiscountBps(0); syncPaymentInputs(cart, 0); return; }
    const promos = (promosQuery.data?.items ?? []) as Array<{ code?: string; discountBps?: number; active?: boolean }>;
    const found = promos.find((p) => p.code?.toUpperCase() === clean && p.active !== false);
    const bps = found?.discountBps ?? (clean === 'VIP10' ? 1000 : 0);
    if (bps <= 0) { setStatusMsg(`Cupón '${clean}' no vigente`); return; }
    setCouponCode(clean);
    setCouponDiscountBps(bps);
    syncPaymentInputs(cart, bps);
    setStatusMsg(`Cupón ${clean} (-${Math.round(bps / 100)}%) aplicado`);
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

  const pendingCount = (queueQuery.data ?? []).length;
  const products = productsQuery.data?.items ?? [];

  return (
    <section className="flex flex-col gap-3 lg:h-[calc(100vh-5.5rem)] lg:overflow-hidden" data-slot="pos-view">
      <PageHeader
        title={`POS · ${vocabulary.orderSingular}`}
        description={`${vocabulary.branchSingular} · Tasa ${rateInput} Bs/USD · F2 Buscar · F4 +1 · F8 Leylan · F9 -10% · F10 Cobrar`}
        onRefresh={() => void productsQuery.refetch()}
        refreshing={productsQuery.isFetching}
        actions={
          <>
            {shiftId ? <StatusBadge label={`Turno ${registerId}`} tone="success" appearance="dot" /> : null}
            {shiftId ? (
              <button type="button" onClick={() => setHeldOpen(true)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-muted">
                <Clock className="size-3.5 text-amber-500" /><span>Espera ({heldOrders.length})</span>
              </button>
            ) : null}
            {pendingCount > 0 ? (
              <button type="button" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-muted">
                <RefreshCw className="size-3.5" /><span>Sincronizar ({pendingCount})</span>
              </button>
            ) : null}
            {shiftId ? (
              <>
                <button type="button" onClick={() => setPinOpen(true)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-muted"><KeyRound className="size-3.5 text-primary" /><span>{cashierName}</span></button>
                <button type="button" onClick={() => setReturnOpen(true)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-muted"><RotateCcw className="size-3.5 text-amber-500" /><span>Devolución</span></button>
                <button type="button" onClick={() => setClosingOpen(true)} className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium shadow-xs hover:bg-muted"><Lock className="size-3.5 text-muted-foreground" /><span>Cerrar Caja</span></button>
              </>
            ) : null}
          </>
        }
      />
      {statusMsg ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-1.5 text-xs font-medium text-status-info-text">{statusMsg}</p> : null}
      {!shiftId ? (
        <div className="mx-auto my-auto max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-xs">
          <div className="space-y-1"><h2 className="text-lg font-semibold tracking-tight">Sesión de Caja Cerrada</h2><p className="text-sm text-muted-foreground">Abre turno en {registerId} para comenzar a facturar.</p></div>
          <div className="grid grid-cols-2 gap-2.5 text-left">
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Caja</span><input className={`${INPUT_CLS} h-11 w-full`} value={registerId} onChange={(e) => setRegisterId(e.target.value)} /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Cajero</span><input className={`${INPUT_CLS} h-11 w-full`} value={cashierName} onChange={(e) => setCashierName(e.target.value)} /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Fondo Inicial USD</span><input className={`${INPUT_CLS} h-11 w-full font-mono tabular-nums`} value={openingUsdInput} onChange={(e) => setOpeningUsdInput(e.target.value)} /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Fondo Inicial VES</span><input className={`${INPUT_CLS} h-11 w-full font-mono tabular-nums`} value={openingVesInput} onChange={(e) => setOpeningVesInput(e.target.value)} /></label>
          </div>
          <button type="button" onClick={() => openShiftMutation.mutate()} disabled={openShiftMutation.isPending} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary-hover"><Play className="size-4" /><span>{openShiftMutation.isPending ? 'Abriendo Caja...' : 'Abrir Caja'}</span></button>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[62fr_38fr]">
          <div className="flex min-h-0 flex-col space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input ref={searchInputRef} type="search" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && search.trim()) { e.preventDefault(); handleScanCode(search); setSearch(''); } }} placeholder="Buscar o escanear SKU/GTIN + Enter (F2)..." className={`${INPUT_CLS} h-11 w-full pl-9`} />
              </div>
              <button type="button" onClick={() => setScannerOpen(true)} title="Escáner con cámara" className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"><Camera className="size-4 text-primary" /></button>
              <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1">
                <span className="text-[11px] font-medium text-muted-foreground">BCV</span>
                {rateUnlocked ? <input type="text" aria-label="Tasa BCV" value={rateInput} onChange={(e) => setRateInput(e.target.value)} className="h-8 w-16 bg-transparent font-mono text-xs tabular-nums focus:outline-none" /> : <span className="font-mono text-xs font-semibold tabular-nums">{rateInput}</span>}
                <button type="button" onClick={() => setRateUnlocked((v) => !v)} title="Desbloquear tasa" className="rounded p-1 text-muted-foreground hover:bg-muted">{rateUnlocked ? <Lock className="size-3" /> : <Unlock className="size-3" />}</button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-1 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2 md:grid-cols-3">
              {products.map((prod) => (
                <button key={prod.id} type="button" onClick={() => addToCart(prod)} className="flex min-h-24 flex-col justify-between rounded-xl border border-border bg-card p-3.5 text-left shadow-xs transition-colors hover:border-primary/60 hover:bg-muted/35">
                  <div className="space-y-0.5"><p className="font-mono text-[11px] text-muted-foreground">{prod.sku}</p><p className="text-sm font-medium leading-snug">{prod.name}</p></div>
                  <div className="mt-2 flex items-baseline justify-between font-mono text-xs tabular-nums">
                    <span className="font-semibold text-foreground">{formatMinorUnits(prod.basePriceMinor, 'USD')}</span>
                    <span className="text-muted-foreground">{formatMinorUnits(usdToVesMinor(prod.basePriceMinor, rateMicros), 'VES')}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <PosReceiptPanel
            cart={cart} cartTotalMinor={cartTotalMinor} cartTotalVesMinor={cartTotalVesMinor} usdInput={usdInput} vesInput={vesInput}
            onUsdChange={setUsdInput} onVesChange={setVesInput} onUpdateQty={updateQty} onToggleDiscount={toggleDiscount}
            onHoldOrder={() => setHoldPromptOpen(true)} onOpenTender={() => setTenderOpen(true)} onClearCart={() => setCart([])}
            onFillRestante={handleRestante} onSubmit={handleCheckout} submitting={checkoutMutation.isPending}
            couponCode={couponCode} couponDiscountBps={couponDiscountBps} onApplyCoupon={handleApplyCoupon}
          />
        </div>
      )}
      <PosHoldPromptModal open={holdPromptOpen} label={holdLabelDraft} onLabelChange={setHoldLabelDraft} onClose={() => setHoldPromptOpen(false)} onConfirm={commitParkOrder} />
      <PosCameraScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={handleScanCode} />
      <PosHoldOrdersModal open={heldOpen} onClose={() => setHeldOpen(false)} heldOrders={heldOrders}
        onRecall={(id) => {
          if (cart.length > 0 && !window.confirm('El ticket actual tiene productos. ¿Reemplazar con el ticket en espera?')) return;
          const { recalled, remaining } = recallOrderFromList(heldOrders, id);
          if (recalled) { setCart(recalled.items); syncPaymentInputs(recalled.items); setHeldOrders(remaining); setStatusMsg(`Ticket retomado: ${recalled.customerName}`); }
        }}
        onDelete={(id) => setHeldOrders((prev) => prev.filter((o) => o.id !== id))} />
      <PosTenderModal open={tenderOpen} onClose={() => setTenderOpen(false)} totalUsdMinor={cartTotalMinor} rateMicros={rateMicros} usdInput={usdInput} vesInput={vesInput} onUsdChange={setUsdInput} onVesChange={setVesInput} onFillRestante={handleRestante} onConfirmCheckout={() => handleCheckout()} submitting={checkoutMutation.isPending} />
      <PosCashClosingModal open={closingOpen} onClose={() => setClosingOpen(false)} registerId={registerId} cashierName={cashierName} onConfirmClose={(counted) => closeShiftMutation.mutate(counted)} submitting={closeShiftMutation.isPending} lastClosedReport={lastClosedReport} onClearReport={clearLastClosedReport} />
      <PosProModals rpc={rpc} branchId={session?.actor.orgId ?? 'org_1'} pinOpen={pinOpen} onClosePin={() => setPinOpen(false)} onSwitchCashier={(n) => { setCashierName(n); setStatusMsg(`Relevo activo: ${n}`); }} returnOpen={returnOpen} onCloseReturn={() => setReturnOpen(false)} onReturnSuccess={(m) => setStatusMsg(m)} />
    </section>
  );
}
