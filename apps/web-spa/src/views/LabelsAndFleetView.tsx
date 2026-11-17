import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, FileSpreadsheet, Printer, ScanBarcode, Truck } from 'lucide-react';
import { useState } from 'react';
import { AiCopilotBanner, BarcodeSvg, EmptyState, KpiCard, PageHeader, SegmentedTabs } from '@shac/ui';
import { FleetDispatchPanel } from './FleetDispatchPanel';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

type TabId = 'labels' | 'csv' | 'cycle' | 'fleet';

/** Barcode Label Studio, CSV Bulk Importer, Cycle Counts, Vehicle Registry & Canvas e-POD. */
export function LabelsAndFleetView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('labels');
  const [csvText, setCsvText] = useState('SKU-901,Acetaminofén 500mg Caja x10,4.50\nSKU-902,Vitamina C 1000mg,8.25');
  const [ccProduct, setCcProduct] = useState('');
  const [ccMeasured, setCcMeasured] = useState('25');
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await rpc.api.automation['ai-chat'].$post({ json: { prompt } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => { setErrorMsg(null); setAiReply(d.reply); },
    onError: (err: Error) => setErrorMsg(err.message),
  });

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
        <FleetDispatchPanel
          rpc={rpc}
          vehicles={vehicles}
          orders={orders}
          ops={ops}
          opsLoading={opsQuery.isLoading}
          onStatus={setStatusMsg}
          onError={setErrorMsg}
        />
      ) : null}
    </section>
  );
}
