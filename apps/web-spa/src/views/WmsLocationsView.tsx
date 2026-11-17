import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, MapPin, Plus, Sparkles } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 WMS Warehouses, Zones, Bins, and ASNs view. */
export function WmsLocationsView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [locationCode, setLocationCode] = useState('BIN-A1-01');
  const [name, setName] = useState('Pasillo A · Rack 1');
  const [locationKind, setLocationKind] = useState<'warehouse' | 'zone' | 'bin' | 'dock' | 'asn'>('bin');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const locQuery = useQuery({
    queryKey: ['wms', 'locations'],
    queryFn: async () => {
      const res = await rpc.api.wms.locations.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (input?: { locationCode: string; name: string; locationKind: 'warehouse' | 'zone' | 'bin' | 'dock' | 'asn' }) => {
      const res = await rpc.api.wms.locations.$post({
        json: input ?? { locationCode: locationCode.trim(), name: name.trim(), locationKind },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['wms', 'locations'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  async function seedStarterBins() {
    try {
      await createMutation.mutateAsync({ locationCode: 'BIN-RECEP-01', name: 'Recepción Principal', locationKind: 'dock' });
      await createMutation.mutateAsync({ locationCode: 'BIN-DESP-01', name: 'Muelle Despacho', locationKind: 'dock' });
    } catch {
      // errorMsg already set by onError
    }
  }

  function copyToken(val: string) {
    void navigator.clipboard?.writeText(val);
    setCopiedId(val);
    setTimeout(() => setCopiedId(null), 1500);
  }

  const items = locQuery.data?.items ?? [];
  type LocRow = (typeof items)[number];
  const columns: DataTableColumn<LocRow>[] = [
    {
      id: 'code',
      header: 'Código / ID',
      cell: (l) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-medium">{l.code}</span>
          <button
            type="button"
            onClick={() => copyToken(l.id)}
            title={`Copiar ID: ${l.id}`}
            className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted"
          >
            <Copy className="size-2.5" />
            <span>{copiedId === l.id ? 'Copiado' : l.id.slice(0, 8)}</span>
          </button>
        </div>
      ),
    },
    { id: 'name', header: 'Ubicación / Zona', cell: (l) => <span className="font-medium">{l.name}</span> },
    { id: 'kind', header: 'Tipo', cell: (l) => <StatusBadge label={l.locationKind.toUpperCase()} tone="info" /> },
    { id: 'st', header: 'Estado', cell: (l) => <StatusBadge label={l.isActive ? 'Operativa' : 'Bloqueada'} tone={l.isActive ? 'success' : 'error'} appearance="dot" /> },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!locationCode.trim() || !name.trim()) return;
    createMutation.mutate(undefined);
  }

  return (
    <section className="space-y-5" data-slot="wms-locations-view">
      <PageHeader
        title="WMS · Almacenes, Zonas, Bins & ASNs"
        description="Topología física de almacenamiento, muelles de recepción y pre-avisos ASN."
        actions={
          <div className="flex items-center gap-2">
            {items.length === 0 ? (
              <button
                type="button"
                disabled={createMutation.isPending}
                onClick={() => void seedStarterBins()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted"
              >
                <Sparkles className="size-3.5 text-primary" />
                <span>Crear Bin Recepción + Despacho</span>
              </button>
            ) : null}
            <StatusBadge label="Topología Física" tone="info" icon={<MapPin className="size-3" />} />
          </div>
        }
      />

      {errorMsg ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-4">
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Tipo de Ubicación</span>
          <select value={locationKind} onChange={(e) => setLocationKind(e.target.value as 'warehouse' | 'zone' | 'bin' | 'dock' | 'asn')} className={`${INPUT_CLS} w-full`}>
            <option value="warehouse">Almacén (Warehouse)</option>
            <option value="zone">Zona (Zone)</option>
            <option value="bin">Estante / Bin</option>
            <option value="dock">Muelle (Dock)</option>
            <option value="asn">Pre-Recepción ASN</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Código</span>
          <input value={locationCode} onChange={(e) => setLocationCode(e.target.value)} placeholder="BIN-A1-01" className={`${INPUT_CLS} w-full font-mono text-xs`} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Descripción</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Descripción" className={`${INPUT_CLS} w-full`} />
        </label>
        <button type="submit" disabled={createMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
          <Plus className="size-3.5" /><span>Registrar</span>
        </button>
      </form>

      <DataTable columns={columns} data={items} getRowId={(l) => l.id} loading={locQuery.isLoading} emptyTitle="Sin ubicaciones registradas" />
    </section>
  );
}
