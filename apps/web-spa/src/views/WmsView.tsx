import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, PackageCheck, Send } from 'lucide-react';
import { DataTable, PageHeader, SegmentedTabs, StatusBadge, type DataTableColumn } from '@shac/ui';
import { findProductByScanCode, useGlobalBarcodeHid } from '../lib/usePosScanner';
import { INPUT_CLS, parseMajorToMinor, parseNonNegInt, readApiError, type Phase2ViewProps } from './phase2-format';

type WmsTab = 'receive' | 'balances' | 'picking';

export function classifyFefoLotStatus(
  expiryEpochMs: number | null | undefined,
  quarantineStatus: string | undefined,
  nowMs = Date.now(),
): { label: string; tone: 'success' | 'warning' | 'error'; selectable: boolean } {
  const q = (quarantineStatus ?? '').toUpperCase();
  if (q === 'QUARANTINE' || q === 'REJECTED' || q === 'RECALLED') {
    return { label: 'BLOQUEADO · Cuarentena', tone: 'error', selectable: false };
  }
  if (expiryEpochMs != null && expiryEpochMs <= nowMs) {
    return { label: 'BLOQUEADO · Vencido', tone: 'error', selectable: false };
  }
  if (expiryEpochMs != null) {
    const daysLeft = Math.ceil((expiryEpochMs - nowMs) / 86_400_000);
    if (daysLeft <= 30) {
      return { label: `FEFO · Vence ${daysLeft}d`, tone: 'warning', selectable: true };
    }
  }
  return { label: 'Vigente', tone: 'success', selectable: true };
}

/** 360px Colector WMS por pestañas: Recepción FEFO, Semáforo de Lotes y Picking Doble Partida. */
export function WmsView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<WmsTab>('receive');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destLocationId, setDestLocationId] = useState('');
  const [binCode, setBinCode] = useState('');
  const [productId, setProductId] = useState('');
  const [lotCode, setLotCode] = useState('LOT-MAIN-01');
  const [receiveQty, setReceiveQty] = useState('20');
  const [unitCostMajor, setUnitCostMajor] = useState('7.00');
  const [expiryDate, setExpiryDate] = useState('');
  const [gs1Barcode, setGs1Barcode] = useState('');
  const [demandedUnits, setDemandedUnits] = useState('10');
  const [doneUnits, setDoneUnits] = useState('6');
  const [feedback, setFeedback] = useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ['catalog', 'products', 'wms-select'],
    queryFn: async () => {
      const res = await rpc.api.catalog.products.$get({ query: { limit: '100' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const locationsQuery = useQuery({
    queryKey: ['wms', 'locations', 'wms-select'],
    queryFn: async () => {
      const res = await rpc.api.wms.locations.$get();
      if (!res.ok) return { items: [] as Array<{ id: string; code: string; name: string; locationKind: string }> };
      return res.json();
    },
  });

  const products = productsQuery.data?.items ?? [];
  const locations = locationsQuery.data?.items ?? [];
  const activeProductId = productId || products[0]?.id || '';

  const balancesQuery = useQuery({
    queryKey: ['wms', 'balances', activeProductId],
    queryFn: async () => {
      const res = await rpc.api.branch.inventory.balances.$get({
        query: activeProductId ? { productId: activeProductId } : {},
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    enabled: tab === 'balances',
  });

  const pickingsQuery = useQuery({
    queryKey: ['wms', 'pickings'],
    queryFn: async () => {
      const res = await rpc.api.wms.pickings.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  useGlobalBarcodeHid((code) => {
    const match = findProductByScanCode(products, code);
    if (match) {
      setProductId(match.id);
      setFeedback(`Escaneado SKU: ${match.sku} · ${match.name}`);
    } else {
      setGs1Barcode(code);
      setFeedback(`Código GS1/Barra capturado: ${code}`);
    }
  });

  const receiveLotMutation = useMutation({
    mutationFn: async () => {
      const expiryEpochMs = expiryDate ? new Date(`${expiryDate}T23:59:59Z`).getTime() : undefined;
      const res = await rpc.api.branch.inventory['receive-lot'].$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          productId: activeProductId,
          binCode: binCode || undefined,
          lotCode: lotCode.trim() || `LOT-${Date.now()}`,
          qty: Math.max(1, parseNonNegInt(receiveQty, 1)),
          unitCostMinor: parseMajorToMinor(unitCostMajor),
          ...(expiryEpochMs && Number.isFinite(expiryEpochMs) ? { expiryEpochMs } : {}),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setFeedback(`Lote ${lotCode} recibido (${receiveQty}u) en ${vocabulary.branchSingular}`);
      void queryClient.invalidateQueries({ queryKey: ['wms', 'balances'] });
    },
    onError: (err) => setFeedback(err.message),
  });

  const dispatchMutation = useMutation({
    mutationFn: async () => {
      const demandedMicros = Math.max(1, parseNonNegInt(demandedUnits, 1)) * 1_000_000;
      const doneMicros = parseNonNegInt(doneUnits, 0) * 1_000_000;
      const src = sourceLocationId || locations[0]?.id || 'loc_bin_main';
      const dst = destLocationId || locations[1]?.id || 'loc_customer';
      const res = await rpc.api.wms.pickings.process.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          operationKind: 'outgoing_ship',
          sourceLocationId: src,
          destLocationId: dst,
          lines: [
            {
              productId: activeProductId.trim(),
              ...(gs1Barcode.trim() ? { gs1RawBarcode: gs1Barcode.trim() } : {}),
              demandedQtyMicros: demandedMicros,
              doneQtyMicros: doneMicros,
            },
          ],
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['wms', 'pickings'] });
      setFeedback(
        data.backorderPicking
          ? `Picking ${data.pickingNumber} procesado · Backorder: ${data.backorderPicking.pickingNumber}`
          : `Picking ${data.pickingNumber} completado`,
      );
    },
    onError: (err) => setFeedback(err.message),
  });

  const pickings = pickingsQuery.data?.items ?? [];
  type PickingRow = (typeof pickings)[number];
  const pickingCols: DataTableColumn<PickingRow>[] = [
    { id: 'num', header: 'Picking', cell: (p) => <span className="font-mono text-xs font-medium">{p.pickingNumber}</span> },
    { id: 'route', header: 'Origen / Destino', cell: (p) => <span className="inline-flex items-center gap-1 font-mono text-[11px]">{p.sourceLocationId} <ArrowRight className="size-3" /> {p.destLocationId}</span> },
    { id: 'st', header: 'Estado', cell: (p) => <StatusBadge label={p.status} tone={p.status === 'done' ? 'success' : 'warning'} appearance="dot" /> },
  ];

  const lots = ((balancesQuery.data as { lots?: Array<{ id?: string; lotCode: string; availableQty: number; expiryEpochMs?: number | null; quarantineStatus?: string }> } | undefined)?.lots ?? [])
    .slice()
    .sort((a, b) => (a.expiryEpochMs ?? Number.MAX_SAFE_INTEGER) - (b.expiryEpochMs ?? Number.MAX_SAFE_INTEGER));

  type LotRow = (typeof lots)[number];
  const lotCols: DataTableColumn<LotRow>[] = [
    { id: 'lot', header: 'Lote', cell: (l) => <span className="font-mono text-xs font-medium">{l.lotCode}</span> },
    { id: 'qty', header: 'Disp.', align: 'right', cell: (l) => <span className="font-mono text-xs tabular-nums">{l.availableQty}</span> },
    {
      id: 'fefo',
      header: 'Semáforo FEFO',
      cell: (l) => {
        const st = classifyFefoLotStatus(l.expiryEpochMs ?? null, l.quarantineStatus);
        return <StatusBadge label={st.label} tone={st.tone} appearance="dot" />;
      },
    },
  ];

  return (
    <section className="space-y-4" data-slot="wms-view">
      <PageHeader
        title="WMS Colector FEFO"
        description={`Recepción, semáforo de vencimientos y picking en ${vocabulary.branchSingular}.`}
        onRefresh={() => void pickingsQuery.refetch()}
        actions={
          <SegmentedTabs
            activeId={tab}
            onSelect={(v) => setTab(v as WmsTab)}
            tabs={[
              { id: 'receive', label: '1. Recibir Lote' },
              { id: 'balances', label: '2. Semáforo FEFO' },
              { id: 'picking', label: '3. Picking' },
            ]}
          />
        }
      />

      {feedback ? (
        <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">
          {feedback}
        </p>
      ) : null}

      {tab === 'receive' ? (
        <form
          onSubmit={(e: FormEvent) => { e.preventDefault(); receiveLotMutation.mutate(); }}
          className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Producto (o escanea SKU)</span>
              <select value={activeProductId} onChange={(e) => setProductId(e.target.value)} className={`${INPUT_CLS} h-11 w-full`}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Ubicación / Bin</span>
              <select value={binCode} onChange={(e) => setBinCode(e.target.value)} className={`${INPUT_CLS} h-11 w-full`}>
                <option value="">Bin Principal</option>
                {locations.map((loc) => <option key={loc.id} value={loc.code}>{loc.code} · {loc.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Código de Lote</span><input value={lotCode} onChange={(e) => setLotCode(e.target.value)} className={`${INPUT_CLS} h-11 w-full font-mono`} /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Cantidad</span><input type="number" min={1} value={receiveQty} onChange={(e) => setReceiveQty(e.target.value)} className={`${INPUT_CLS} h-11 w-full font-mono tabular-nums`} /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Costo Unitario (USD)</span><input value={unitCostMajor} onChange={(e) => setUnitCostMajor(e.target.value)} className={`${INPUT_CLS} h-11 w-full font-mono tabular-nums`} /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Fecha de Vencimiento (FEFO)</span><input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={`${INPUT_CLS} h-11 w-full font-mono`} /></label>
          </div>
          <button type="submit" disabled={receiveLotMutation.isPending || !activeProductId} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
            <PackageCheck className="size-4" /><span>{receiveLotMutation.isPending ? 'Registrando...' : 'Recibir Lote en Almacén'}</span>
          </button>
        </form>
      ) : null}

      {tab === 'balances' ? (
        <div className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Filtrar Producto</span>
            <select value={activeProductId} onChange={(e) => setProductId(e.target.value)} className={`${INPUT_CLS} h-11 w-full`}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
            </select>
          </label>
          <DataTable columns={lotCols} data={lots} getRowId={(l) => l.id ?? l.lotCode} loading={balancesQuery.isLoading} emptyTitle="Sin lotes disponibles" />
        </div>
      ) : null}

      {tab === 'picking' ? (
        <div className="space-y-4">
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); dispatchMutation.mutate(); }} className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Origen</span>
                <select value={sourceLocationId} onChange={(e) => setSourceLocationId(e.target.value)} className={`${INPUT_CLS} h-11 w-full`}>
                  <option value="loc_bin_main">Almacén Principal (loc_bin_main)</option>
                  {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.code} · {loc.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Destino</span>
                <select value={destLocationId} onChange={(e) => setDestLocationId(e.target.value)} className={`${INPUT_CLS} h-11 w-full`}>
                  <option value="loc_customer">Despacho Cliente (loc_customer)</option>
                  {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.code} · {loc.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Solicitado</span><input type="number" min={1} value={demandedUnits} onChange={(e) => setDemandedUnits(e.target.value)} className={`${INPUT_CLS} h-11 w-full font-mono tabular-nums`} /></label>
              <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Despachado (menor = Backorder)</span><input type="number" min={0} value={doneUnits} onChange={(e) => setDoneUnits(e.target.value)} className={`${INPUT_CLS} h-11 w-full font-mono tabular-nums`} /></label>
            </div>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">GS1-128 / Barcode (opcional)</span><input value={gs1Barcode} onChange={(e) => setGs1Barcode(e.target.value)} placeholder="(01)0759123...(10)LOT..." className={`${INPUT_CLS} h-11 w-full font-mono`} /></label>
            <button type="submit" disabled={dispatchMutation.isPending || !activeProductId} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              <Send className="size-4" /><span>{dispatchMutation.isPending ? 'Procesando...' : 'Procesar Picking Doble Partida'}</span>
            </button>
          </form>
          <DataTable columns={pickingCols} data={pickings} getRowId={(p) => p.id} loading={pickingsQuery.isLoading} emptyTitle="Sin pickings registrados" />
        </div>
      ) : null}
    </section>
  );
}
