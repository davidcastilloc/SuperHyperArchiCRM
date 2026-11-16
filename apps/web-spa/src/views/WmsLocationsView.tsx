import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 WMS Warehouses, Zones, Bins, and ASNs view. */
export function WmsLocationsView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [locationCode, setLocationCode] = useState('BIN-A1-01');
  const [name, setName] = useState('Pasillo A · Rack 1');
  const [locationKind, setLocationKind] = useState<'warehouse' | 'zone' | 'bin' | 'dock' | 'asn'>('bin');

  const locQuery = useQuery({
    queryKey: ['wms', 'locations'],
    queryFn: async () => {
      const res = await rpc.api.wms.locations.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.wms.locations.$post({
        json: { locationCode: locationCode.trim(), name: name.trim(), locationKind },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wms', 'locations'] }),
  });

  const items = locQuery.data?.items ?? [];
  type LocRow = (typeof items)[number];
  const columns: DataTableColumn<LocRow>[] = [
    { id: 'code', header: 'Código', cell: (l) => <span className="font-mono text-xs font-medium">{l.code}</span> },
    { id: 'name', header: 'Ubicación / Zona', cell: (l) => <span className="font-medium">{l.name}</span> },
    { id: 'kind', header: 'Tipo', cell: (l) => <StatusBadge label={l.locationKind.toUpperCase()} tone="info" /> },
    { id: 'st', header: 'Estado', cell: (l) => <StatusBadge label={l.isActive ? 'Operativa' : 'Bloqueada'} tone={l.isActive ? 'success' : 'error'} appearance="dot" /> },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!locationCode.trim() || !name.trim()) return;
    createMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="wms-locations-view">
      <PageHeader title="WMS · Almacenes, Zonas, Bins & ASNs" description="Topología física de almacenamiento, muelles de recepción y pre-avisos ASN." actions={<StatusBadge label="Topología Física" tone="info" icon={<MapPin className="size-3" />} />} />

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-4">
        <select value={locationKind} onChange={(e) => setLocationKind(e.target.value as 'warehouse' | 'zone' | 'bin' | 'dock' | 'asn')} className={INPUT_CLS}>
          <option value="warehouse">Almacén (Warehouse)</option>
          <option value="zone">Zona (Zone)</option>
          <option value="bin">Estante / Bin</option>
          <option value="dock">Muelle (Dock)</option>
          <option value="asn">Pre-Recepción ASN</option>
        </select>
        <input value={locationCode} onChange={(e) => setLocationCode(e.target.value)} placeholder="BIN-A1-01" className={`${INPUT_CLS} font-mono text-xs`} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Descripción" className={INPUT_CLS} />
        <button type="submit" disabled={createMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Registrar</span></button>
      </form>

      <DataTable columns={columns} data={items} getRowId={(l) => l.id} loading={locQuery.isLoading} emptyTitle="Sin ubicaciones registradas" />
    </section>
  );
}
