import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, PackageCheck, Send, Truck } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, parseNonNegInt, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 WMS pickings (-BACKORDER), FEFO lot receipt, GS1-128 dispatch, and e-POD view. */
export function WmsView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [sourceLocationId, setSourceLocationId] = useState('loc_bin_main');
  const [destLocationId, setDestLocationId] = useState('loc_customer');
  const [productId, setProductId] = useState('');
  const [lotCode, setLotCode] = useState('LOT-MAIN-01');
  const [receiveQty, setReceiveQty] = useState('20');
  const [gs1Barcode, setGs1Barcode] = useState('');
  const [demandedUnits, setDemandedUnits] = useState('10');
  const [doneUnits, setDoneUnits] = useState('6');
  const [vehicleId, setVehicleId] = useState('veh_cold');
  const [recipientName, setRecipientName] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ['catalog', 'products', 'wms-select'],
    queryFn: async () => {
      const res = await rpc.api.catalog.products.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const pickingsQuery = useQuery({
    queryKey: ['wms', 'pickings'],
    queryFn: async () => {
      const res = await rpc.api.wms.pickings.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const products = productsQuery.data?.items ?? [];
  const activeProductId = productId || products[0]?.id || '';

  const receiveLotMutation = useMutation({
    mutationFn: async () => {
      const prod = products.find((p) => p.id === activeProductId);
      const res = await rpc.api.branch.inventory['receive-lot'].$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          productId: activeProductId,
          lotCode: lotCode.trim() || `LOT-${Date.now()}`,
          qty: Math.max(1, parseNonNegInt(receiveQty, 1)),
          unitCostMinor: prod?.costPriceMinor ?? 0,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => setFeedback(`Lote ${lotCode} recibido (${receiveQty}u) en ${vocabulary.branchSingular}`),
    onError: (err) => setFeedback(err.message),
  });

  const dispatchMutation = useMutation({
    mutationFn: async () => {
      const demandedMicros = Math.max(1, parseNonNegInt(demandedUnits, 1)) * 1_000_000;
      const doneMicros = parseNonNegInt(doneUnits, 0) * 1_000_000;
      const res = await rpc.api.wms.pickings.process.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          operationKind: 'outgoing_ship',
          sourceLocationId: sourceLocationId.trim(),
          destLocationId: destLocationId.trim(),
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

  const epodMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.wms.fleet.epod.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          vehicleId: vehicleId.trim(),
          loadWeightGrams: 1000,
          loadPallets: 1,
          requiresColdChain: true,
          epodRecipientName: recipientName.trim(),
          epodSignatureSvg: '<svg><path d="M0 0 L10 10"/></svg>',
          epodPhotoR2Key: `epod/${crypto.randomUUID()}.jpg`,
          epodLat: 10,
          epodLng: -67,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setRecipientName('');
      setFeedback(`e-POD entregado por ${data.epodRecipientName} (${data.vehicleCode ?? data.vehicleId})`);
    },
    onError: (err) => setFeedback(err.message),
  });

  function handleDispatch(e: FormEvent) {
    e.preventDefault();
    if (!activeProductId.trim() || dispatchMutation.isPending) return;
    dispatchMutation.mutate();
  }

  function handleEpod(e: FormEvent) {
    e.preventDefault();
    if (!recipientName.trim() || epodMutation.isPending) return;
    epodMutation.mutate();
  }

  const items = pickingsQuery.data?.items ?? [];
  type PickingRow = (typeof items)[number];
  const columns: DataTableColumn<PickingRow>[] = [
    {
      id: 'num',
      header: 'Picking',
      sortValue: (p) => p.pickingNumber,
      cell: (p) => <span className="font-mono text-xs font-medium">{p.pickingNumber}</span>,
    },
    {
      id: 'kind',
      header: 'Operación',
      cell: (p) => <span className="font-mono text-xs text-muted-foreground">{p.operationKind}</span>,
    },
    {
      id: 'route',
      header: 'Ruta Física',
      cell: (p) => (
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span>{p.sourceLocationName ?? p.sourceLocationId}</span>
          <ArrowRight className="size-3 text-muted-foreground" />
          <span>{p.destLocationName ?? p.destLocationId}</span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Estado',
      cell: (p) => (
        <StatusBadge
          label={p.status}
          tone={p.status === 'done' ? 'success' : p.status === 'cancelled' ? 'error' : 'warning'}
          appearance="dot"
        />
      ),
    },
  ];

  return (
    <section className="space-y-5" data-slot="wms-view">
      <PageHeader
        title={`WMS · ${vocabulary.branchSingular}`}
        description="Recepción de lotes FEFO, movimientos doble partida, GS1-128 y prueba electrónica de entrega (e-POD)."
        onRefresh={() => void pickingsQuery.refetch()}
        refreshing={pickingsQuery.isFetching}
      />

      <div className="rounded-xl border border-border bg-card shadow-xs divide-y divide-border">
        <div className="grid grid-cols-1 gap-2.5 p-4 md:grid-cols-4">
          <select value={activeProductId} onChange={(e) => setProductId(e.target.value)} className={INPUT_CLS}>
            {products.length === 0 ? (
              <option value="">Sin productos en catálogo</option>
            ) : (
              products.map((p) => (
                <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>
              ))
            )}
          </select>
          <input type="text" value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Código de lote" className={`${INPUT_CLS} font-mono text-xs`} />
          <input type="number" min={1} step={1} value={receiveQty} onChange={(e) => setReceiveQty(e.target.value)} placeholder="Cantidad" className={`${INPUT_CLS} font-mono tabular-nums`} />
          <button type="button" disabled={!activeProductId || receiveLotMutation.isPending} onClick={() => receiveLotMutation.mutate()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted disabled:opacity-50">
            <PackageCheck className="size-3.5 text-muted-foreground" />
            <span>{receiveLotMutation.isPending ? 'Recibiendo...' : 'Recibir Lote FEFO'}</span>
          </button>
        </div>

        <form onSubmit={handleDispatch} className="grid grid-cols-1 gap-2.5 p-4 md:grid-cols-5">
          <input type="text" value={sourceLocationId} onChange={(e) => setSourceLocationId(e.target.value)} placeholder="Origen" className={`${INPUT_CLS} font-mono text-xs`} />
          <input type="text" value={destLocationId} onChange={(e) => setDestLocationId(e.target.value)} placeholder="Destino" className={`${INPUT_CLS} font-mono text-xs`} />
          <input type="text" value={gs1Barcode} onChange={(e) => setGs1Barcode(e.target.value)} placeholder="GS1-128 (opcional)" className={`${INPUT_CLS} font-mono text-xs`} />
          <div className="flex gap-2">
            <input type="number" min={1} step={1} value={demandedUnits} onChange={(e) => setDemandedUnits(e.target.value)} placeholder="Dem." className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
            <input type="number" min={0} step={1} value={doneUnits} onChange={(e) => setDoneUnits(e.target.value)} placeholder="Done" className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
          </div>
          <button type="submit" disabled={dispatchMutation.isPending || !activeProductId} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs disabled:opacity-50">
            <Send className="size-3.5" />
            <span>Despachar {vocabulary.orderSingular}</span>
          </button>
        </form>

        <form onSubmit={handleEpod} className="grid grid-cols-1 gap-2.5 p-4 md:grid-cols-3">
          <input type="text" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} placeholder="Vehicle ID" className={`${INPUT_CLS} font-mono text-xs`} />
          <input type="text" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Receptor e-POD" className={INPUT_CLS} />
          <button type="submit" disabled={epodMutation.isPending || !recipientName.trim()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted disabled:opacity-50">
            <Truck className="size-3.5 text-muted-foreground" />
            <span>Registrar e-POD</span>
          </button>
        </form>
      </div>

      {feedback ? (
        <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p>
      ) : null}

      <DataTable
        columns={columns}
        data={items}
        getRowId={(p) => p.id}
        loading={pickingsQuery.isLoading}
        emptyTitle="Sin movimientos WMS"
        emptyDescription="Recibe un lote FEFO o despacha una orden para generar el primer picking."
      />
    </section>
  );
}
