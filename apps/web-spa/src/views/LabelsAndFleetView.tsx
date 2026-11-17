import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, FileSpreadsheet, Printer, ScanBarcode, Truck } from 'lucide-react';
import { useState } from 'react';
import { AiCopilotBanner, BarcodeSvg, DataTable, EmptyState, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

type TabId = 'labels' | 'csv' | 'cycle' | 'fleet';

/** Barcode Label Studio, CSV Bulk Importer, Cycle Counts & Fleet ePOD Dispatch (CRMWarehouse + GeorginaPOS). */
export function LabelsAndFleetView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('labels');
  const [rateInput, setRateInput] = useState('54.75');
  const [csvText, setCsvText] = useState('SKU-901,Acetaminofén 500mg Caja x10,4.50\nSKU-902,Vitamina C 1000mg,8.25');
  const [vehicleCode, setVehicleCode] = useState('VAN-01');
  const [licensePlate, setLicensePlate] = useState('AB123CD');
  const [orderId, setOrderId] = useState('ORD-2026-001');
  const [recipient, setRecipient] = useState('');
  const [ccProduct, setCcProduct] = useState('');
  const [ccMeasured, setCcMeasured] = useState('25');
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ['catalog', 'products', 'labels-studio'],
    queryFn: async () => {
      const res = await rpc.api.catalog.products.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
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
      const rows = csvText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [sku = '', name = '', price = '0'] = line.split(',').map((s) => s.trim());
          return { sku, name, basePriceMinor: parseMajorToMinor(price), primaryCurrency: 'USD' };
        })
        .filter((r) => r.sku && r.name);
      const res = await rpc.api.wms['catalog-csv-import'].$post({ json: { rows } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
      setStatusMsg(`Importados ${d.importedCount} productos por CSV al catálogo.`);
    },
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
      void queryClient.invalidateQueries({ queryKey: ['wms', 'fleet-and-qc'] });
      setStatusMsg('Conteo cíclico registrado en WMS.');
    },
  });

  const fleetMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.wms['fleet-dispatch'].$post({
        json: { vehicleCode, licensePlate, orderId, epodRecipientName: recipient || undefined, status: 'en_route' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wms', 'fleet-and-qc'] });
      setStatusMsg(`Despacho asignado a unidad ${vehicleCode}.`);
    },
  });

  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await rpc.api.automation['ai-chat'].$post({ json: { prompt } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => setAiReply(d.reply),
  });

  const products = productsQuery.data?.items ?? [];
  const rateNum = Number.parseFloat(rateInput) || 54.75;
  const cycleCounts = (opsQuery.data?.cycleCounts ?? []) as Array<{ id: string; product_id: string; measured_value: number; norm_min: number; status: string }>;
  const fleetTrips = (opsQuery.data?.fleetTrips ?? []) as Array<{ id: string; vehicle_code: string; license_plate: string; order_id: string; epod_recipient_name: string | null; status: string }>;

  return (
    <section className="space-y-5" data-slot="labels-fleet-view">
      <PageHeader
        title="Etiquetas, CSV Masivo & Flota ePOD"
        description="Estudio de códigos de barra SVG (USD/Bs), importación masiva CSV, conteos cíclicos y despacho de rutas."
        onRefresh={() => { void productsQuery.refetch(); void opsQuery.refetch(); }}
        refreshing={productsQuery.isFetching || opsQuery.isFetching}
        actions={
          <button type="button" onClick={() => window.print()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
            <Printer className="size-3.5" /><span>Imprimir Etiquetas</span>
          </button>
        }
      />

      <AiCopilotBanner
        title="Copiloto Logístico IA"
        summary="Optimiza rutas de despacho, detecta mermas de conteo cíclico y sugiere reposición."
        prompts={['Analizar mermas y conteos cíclicos', 'Resumir rutas en tránsito']}
        onRunPrompt={(p) => aiMutation.mutate(p)}
        reply={aiReply}
        onClearReply={() => setAiReply(null)}
        loading={aiMutation.isPending}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard title="SKUs Etiquetables" value={products.length} />
        <KpiCard title="Conteos Cíclicos" value={cycleCounts.length} />
        <KpiCard title="Viajes de Flota" value={fleetTrips.length} />
      </div>

      {statusMsg ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{statusMsg}</p> : null}

      <SegmentedTabs
        activeId={tab}
        onSelect={(id) => setTab(id as TabId)}
        tabs={[
          { id: 'labels', label: 'Etiquetas Código de Barras', count: products.length, icon: <ScanBarcode className="size-3.5" /> },
          { id: 'csv', label: 'Importar CSV Masivo', icon: <FileSpreadsheet className="size-3.5" /> },
          { id: 'cycle', label: 'Conteo Cíclico', count: cycleCounts.length, icon: <ClipboardCheck className="size-3.5" /> },
          { id: 'fleet', label: 'Flota & ePOD', count: fleetTrips.length, icon: <Truck className="size-3.5" /> },
        ]}
      />

      {tab === 'labels' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Tasa Bs/USD para etiqueta:</span>
              <input value={rateInput} onChange={(e) => setRateInput(e.target.value)} className={`${INPUT_CLS} w-24 font-mono`} />
            </label>
          </div>
          {products.length === 0 ? (
            <EmptyState title="Sin productos" description="Importa productos por CSV o crea ítems en Catálogo." />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {products.map((p) => {
                const bs = ((p.basePriceMinor / 100) * rateNum).toFixed(2);
                return (
                  <BarcodeSvg
                    key={p.id}
                    value={p.sku}
                    label={p.name}
                    priceLabel={`${formatMinorUnits(p.basePriceMinor, 'USD')} · Bs ${bs}`}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'csv' ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
          <p className="text-xs text-muted-foreground">Formato por línea: <span className="font-mono">SKU,Nombre del producto,PrecioUSD</span></p>
          <textarea rows={6} value={csvText} onChange={(e) => setCsvText(e.target.value)} className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs" />
          <button type="button" onClick={() => csvMutation.mutate()} disabled={csvMutation.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground">
            <FileSpreadsheet className="size-3.5" /><span>{csvMutation.isPending ? 'Importando...' : 'Importar CSV al Catálogo'}</span>
          </button>
        </div>
      ) : null}

      {tab === 'cycle' ? (
        <div className="space-y-4">
          <form className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); cycleMutation.mutate(); }}>
            <input placeholder="SKU o ID producto" value={ccProduct} onChange={(e) => setCcProduct(e.target.value)} className={`${INPUT_CLS} flex-1 font-mono`} />
            <input type="number" placeholder="Conteo físico" value={ccMeasured} onChange={(e) => setCcMeasured(e.target.value)} className={`${INPUT_CLS} w-32 font-mono`} />
            <button type="submit" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground">Registrar Conteo</button>
          </form>
          <DataTable
            columns={[
              { id: 'prod', header: 'Producto / SKU', cell: (r) => <span className="font-mono text-xs">{r.product_id}</span> },
              { id: 'val', header: 'Conteo Físico', cell: (r) => <span className="font-mono tabular-nums">{r.measured_value}</span> },
              { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="info" /> },
            ]}
            data={cycleCounts}
            getRowId={(r) => r.id}
            emptyTitle="Sin conteos registrados"
          />
        </div>
      ) : null}

      {tab === 'fleet' ? (
        <div className="space-y-4">
          <form className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); fleetMutation.mutate(); }}>
            <input placeholder="Unidad (VAN-01)" value={vehicleCode} onChange={(e) => setVehicleCode(e.target.value)} className={`${INPUT_CLS} font-mono`} />
            <input placeholder="Placa" value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} className={`${INPUT_CLS} font-mono`} />
            <input placeholder="Orden" value={orderId} onChange={(e) => setOrderId(e.target.value)} className={`${INPUT_CLS} font-mono`} />
            <input placeholder="Destinatario ePOD" value={recipient} onChange={(e) => setRecipient(e.target.value)} className={INPUT_CLS} />
            <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Despachar Ruta</button>
          </form>
          <DataTable
            columns={[
              { id: 'veh', header: 'Unidad', cell: (r) => <span className="font-mono text-xs font-semibold">{r.vehicle_code} · {r.license_plate}</span> },
              { id: 'ord', header: 'Orden', cell: (r) => <span className="font-mono text-xs">{r.order_id}</span> },
              { id: 'rec', header: 'Destinatario ePOD', cell: (r) => r.epod_recipient_name ?? '—' },
              { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" appearance="dot" /> },
            ]}
            data={fleetTrips}
            getRowId={(r) => r.id}
            emptyTitle="Sin despachos activos"
          />
        </div>
      ) : null}
    </section>
  );
}
