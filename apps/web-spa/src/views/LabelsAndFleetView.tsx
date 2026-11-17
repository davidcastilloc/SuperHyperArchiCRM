import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Eraser, FileSpreadsheet, Plus, Printer, ScanBarcode, Truck } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { AiCopilotBanner, BarcodeSvg, DataTable, EmptyState, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

type TabId = 'labels' | 'csv' | 'cycle' | 'fleet';

/** Barcode Label Studio, CSV Bulk Importer, Cycle Counts, Vehicle Registry & Canvas e-POD. */
export function LabelsAndFleetView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('labels');
  const [csvText, setCsvText] = useState('SKU-901,Acetaminofén 500mg Caja x10,4.50\nSKU-902,Vitamina C 1000mg,8.25');
  const [newVehCode, setNewVehCode] = useState('');
  const [newVehPlate, setNewVehPlate] = useState('');
  const [newVehDriver, setNewVehDriver] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [signaturePath, setSignaturePath] = useState('');
  const [ccProduct, setCcProduct] = useState('');
  const [ccMeasured, setCcMeasured] = useState('25');
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  const productsQuery = useQuery({
    queryKey: ['catalog', 'products', 'labels-studio'],
    queryFn: async () => {
      const res = await rpc.api.catalog.products.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const vehiclesQuery = useQuery({
    queryKey: ['wms', 'vehicles'],
    queryFn: async () => {
      const res = await rpc.api.wms.vehicles.$get();
      if (!res.ok) return { items: [] as Array<{ id: string; vehicleCode: string; plateNumber: string; driverName: string }> };
      return res.json();
    },
  });

  const ordersQuery = useQuery({
    queryKey: ['pos', 'orders', 'fleet-select'],
    queryFn: async () => {
      const res = await rpc.api.pos.orders.$get({ query: { limit: '50' } });
      if (!res.ok) return { items: [] as Array<{ id: string; orderNumber: string }> };
      return res.json();
    },
  });

  const opsQuery = useQuery({
    queryKey: ['wms', 'fleet-and-qc'],
    queryFn: async () => {
      const res = await rpc.api.wms['fleet-and-qc'].$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const registerVehicleMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.wms.vehicles.$post({
        json: {
          vehicleCode: newVehCode.trim(),
          plateNumber: newVehPlate.trim(),
          driverName: newVehDriver.trim() || undefined,
          isColdChain: false,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (v) => {
      setErrorMsg(null);
      setNewVehCode('');
      setNewVehPlate('');
      setNewVehDriver('');
      setSelectedVehicleId(v.id);
      setStatusMsg(`Vehículo ${v.vehicleCode} registrado.`);
      void queryClient.invalidateQueries({ queryKey: ['wms', 'vehicles'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const csvMutation = useMutation({
    mutationFn: async () => {
      const rows = csvText.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
        const [sku = '', name = '', price = '0'] = line.split(',').map((s) => s.trim());
        return { sku, name, basePriceMinor: parseMajorToMinor(price), primaryCurrency: 'USD' };
      }).filter((r) => r.sku && r.name);
      const res = await rpc.api.wms['catalog-csv-import'].$post({ json: { rows } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
      setStatusMsg(`Importados ${d.importedCount} productos por CSV al catálogo.`);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const cycleMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.wms['cycle-counts'].$post({
        json: { warehouseId: 'wh_main', productId: ccProduct.trim() || 'SKU-GENERAL', measuredValue: Number(ccMeasured) || 0, normMin: 10, status: 'completed' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['wms', 'fleet-and-qc'] });
      setStatusMsg('Conteo cíclico registrado en WMS.');
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const epodMutation = useMutation({
    mutationFn: async () => {
      const veh = vehicles.find((v) => v.id === (selectedVehicleId || vehicles[0]?.id));
      const ord = orders.find((o) => o.id === (selectedOrderId || orders[0]?.id));
      const res = await rpc.api.wms.fleet.epod.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          vehicleId: veh?.id ?? 'veh_default',
          orderId: ord?.id ?? 'ord_default',
          epodRecipientName: recipient.trim() || 'Receptor Conforme',
          epodSignatureSvg: `<svg viewBox="0 0 420 110"><path d="${signaturePath || 'M 10 30 L 80 30'}" stroke="#2563EB" fill="none"/></svg>`,
          epodPhotoR2Key: `epod/${ord?.orderNumber ?? 'delivery'}-${Date.now()}.png`,
          epodLat: 10.4806,
          epodLng: -66.9036,
          loadWeightGrams: 1000,
          loadPallets: 1,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      setRecipient('');
      clearSignature();
      void queryClient.invalidateQueries({ queryKey: ['wms', 'fleet-and-qc'] });
      setStatusMsg('Entrega confirmada con firma digital e-POD.');
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await rpc.api.automation['ai-chat'].$post({ json: { prompt } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => { setErrorMsg(null); setAiReply(d.reply); },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  function clearSignature() {
    setSignaturePath('');
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = true;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    const ctx = canvasRef.current?.getContext('2d');
    ctx?.beginPath();
    ctx?.moveTo(x, y);
    setSignaturePath((p) => `${p ? `${p} ` : ''}M ${x} ${y}`);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2563EB';
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    setSignaturePath((p) => `${p} L ${x} ${y}`);
  }

  const products = productsQuery.data?.items ?? [];
  const vehicles = vehiclesQuery.data?.items ?? [];
  const orders = ordersQuery.data?.items ?? [];
  const trips = ((opsQuery.data?.fleetTrips ?? []) as Array<{ id?: string; vehicleId?: string; status?: string }>).map((t, i) => ({
    id: t.id ?? `trip_${i}`,
    kind: 'Despacho e-POD',
    code: t.vehicleId ?? '—',
    status: t.status ?? 'completed',
  }));
  const cycles = ((opsQuery.data?.cycleCounts ?? []) as Array<{ id?: string; productId?: string; status?: string }>).map((c, i) => ({
    id: c.id ?? `cc_${i}`,
    kind: 'Conteo Cíclico',
    code: c.productId ?? '—',
    status: c.status ?? 'completed',
  }));
  const ops = [...trips, ...cycles];

  return (
    <section className="space-y-4">
      <PageHeader
        title="Etiquetas Barcode, CSV, Conteos & Flota e-POD"
        description="Impresión térmica de habladores CODE128, importación masiva CSV, auditoría física y firma e-POD."
        actions={
          <SegmentedTabs
            activeId={tab}
            onSelect={(v) => setTab(v as TabId)}
            tabs={[
              { id: 'labels', label: 'Etiquetas' },
              { id: 'csv', label: 'Importar CSV' },
              { id: 'cycle', label: 'Conteo Cíclico' },
              { id: 'fleet', label: 'Flota & e-POD' },
            ]}
          />
        }
      />

      <AiCopilotBanner
        title="Copilot Logístico & Flota"
        summary="Consulta discrepancias de inventario, rutas de despacho pendientes o recomendaciones de reabastecimiento."
        prompts={['Resume rutas e-POD activas', 'Auditar conteos cíclicos']}
        loading={aiMutation.isPending}
        reply={aiReply}
        onClearReply={() => setAiReply(null)}
        onRunPrompt={(q) => aiMutation.mutate(q)}
      />

      {errorMsg ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}
      {statusMsg ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">{statusMsg}</div> : null}

      {tab === 'labels' ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground">
              <Printer className="size-3.5" /><span>Imprimir Etiquetas</span>
            </button>
          </div>
          {products.length === 0 ? <EmptyState icon={<ScanBarcode className="size-8" />} title="Catálogo vacío" description="Agrega productos para generar habladores." /> : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((p) => (
                <div key={p.id} className="space-y-2 rounded-xl border border-border bg-card p-3.5 shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-tight">{p.name}</p>
                    <span className="font-mono text-sm font-bold text-primary tabular-nums">{formatMinorUnits(p.basePriceMinor, 'USD')}</span>
                  </div>
                  <BarcodeSvg value={p.sku} height={42} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'csv' ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <label className="block space-y-1 text-xs">
            <span className="font-semibold">Pega filas CSV (`SKU,Nombre,PrecioUSD`)</span>
            <textarea rows={5} value={csvText} onChange={(e) => setCsvText(e.target.value)} className={`${INPUT_CLS} h-auto w-full py-2 font-mono text-xs`} />
          </label>
          <button type="button" disabled={csvMutation.isPending} onClick={() => csvMutation.mutate()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground">
            <FileSpreadsheet className="size-3.5" /><span>{csvMutation.isPending ? 'Importando...' : 'Importar CSV al Catálogo'}</span>
          </button>
        </div>
      ) : null}

      {tab === 'cycle' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">SKU / Producto</span>
              <input value={ccProduct} onChange={(e) => setCcProduct(e.target.value)} placeholder="SKU" className={`${INPUT_CLS} w-full font-mono`} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Cantidad Física Contada</span>
              <input type="number" value={ccMeasured} onChange={(e) => setCcMeasured(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} />
            </label>
            <button type="button" disabled={cycleMutation.isPending} onClick={() => cycleMutation.mutate()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground">
              <ClipboardCheck className="size-3.5" /><span>Registrar Conteo</span>
            </button>
          </div>
          <KpiCard title="Registros Flota / Auditoría" value={ops.length} />
        </div>
      ) : null}

      {tab === 'fleet' ? (
        <div className="space-y-4">
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (newVehCode.trim() && newVehPlate.trim()) registerVehicleMutation.mutate(); }} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Código Unidad</span>
              <input value={newVehCode} onChange={(e) => setNewVehCode(e.target.value)} placeholder="VAN-02" className={`${INPUT_CLS} w-full font-mono`} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Placa</span>
              <input value={newVehPlate} onChange={(e) => setNewVehPlate(e.target.value)} placeholder="XYZ-991" className={`${INPUT_CLS} w-full font-mono`} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Chofer</span>
              <input value={newVehDriver} onChange={(e) => setNewVehDriver(e.target.value)} placeholder="Carlos Pérez" className={`${INPUT_CLS} w-full`} />
            </label>
            <button type="submit" disabled={registerVehicleMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-semibold hover:bg-muted">
              <Plus className="size-3.5" /><span>Registrar Vehículo</span>
            </button>
          </form>

          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Vehículo</span>
                <select value={selectedVehicleId || vehicles[0]?.id || ''} onChange={(e) => setSelectedVehicleId(e.target.value)} className={`${INPUT_CLS} h-11 w-full`}>
                  {vehicles.length === 0 ? <option value="">Sin vehículos (registra uno arriba)</option> : null}
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicleCode} · {v.plateNumber}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Orden de Despacho</span>
                <select value={selectedOrderId || orders[0]?.id || ''} onChange={(e) => setSelectedOrderId(e.target.value)} className={`${INPUT_CLS} h-11 w-full`}>
                  {orders.length === 0 ? <option value="ord_demo">ORD-DEMO</option> : null}
                  {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Receptor e-POD</span>
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Nombre receptor" className={`${INPUT_CLS} h-11 w-full`} />
              </label>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">Firma Digital en Pantalla (e-POD)</span>
                <button type="button" onClick={clearSignature} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  <Eraser className="size-3" /><span>Limpiar trazo</span>
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={420}
                height={110}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => { drawingRef.current = false; }}
                onPointerLeave={() => { drawingRef.current = false; }}
                className="w-full max-w-md touch-none rounded-lg border border-dashed border-border bg-background"
              />
            </div>
            <button type="button" disabled={epodMutation.isPending} onClick={() => epodMutation.mutate()} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground">
              <Truck className="size-3.5" /><span>{epodMutation.isPending ? 'Enviando...' : 'Confirmar Entrega e-POD'}</span>
            </button>
          </div>

          <DataTable
            columns={[
              { id: 'kind', header: 'Tipo', cell: (r) => <StatusBadge label={r.kind} tone="info" /> },
              { id: 'code', header: 'Unidad / SKU', cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
              { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" appearance="dot" /> },
            ]}
            data={ops}
            getRowId={(r) => r.id}
            loading={opsQuery.isLoading}
            emptyTitle="Sin movimientos de flota o conteo aún"
          />
        </div>
      ) : null}
    </section>
  );
}
