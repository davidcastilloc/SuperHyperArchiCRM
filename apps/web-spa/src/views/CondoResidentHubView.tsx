import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Car, Package, QrCode, Vote } from 'lucide-react';
import { useState } from 'react';
import { AiCopilotBanner, DataTable, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

type CondoTab = 'leases' | 'visitors' | 'packages' | 'amenities' | 'polls';

/** Condo Resident Hub & Lease Lifecycle (apartment-property-management assimilation). */
export function CondoResidentHubView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CondoTab>('visitors');
  const [itemKind, setItemKind] = useState<'visitor_pass' | 'package_delivery' | 'parking_pet' | 'amenity_booking' | 'community_poll'>('visitor_pass');
  const [title, setTitle] = useState('');
  const [unitId, setUnitId] = useState('APT-4B');
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['condo', 'overview'],
    queryFn: async () => {
      const res = await rpc.api.condo.overview.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const details =
        itemKind === 'community_poll'
          ? { options: ['A favor', 'En contra'], votes: [0, 0] }
          : { createdFrom: 'CondoResidentHub' };
      const res = await rpc.api.condo['hub-items'].$post({
        json: { itemKind, title: title.trim(), unitId: unitId.trim() || undefined, details },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['condo', 'overview'] });
      setTitle('');
      setStatusMsg('Registro publicado en el Hub del Condominio.');
    },
  });

  const voteMutation = useMutation({
    mutationFn: async (vars: { id: string; optionIndex: number }) => {
      const res = await fetch(`/api/condo/hub-items/${encodeURIComponent(vars.id)}/vote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ optionIndex: vars.optionIndex }),
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['condo', 'overview'] });
      setStatusMsg('Voto comunitario contabilizado.');
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

  const leases = (overviewQuery.data?.leases ?? []) as Array<{ id: string; lease_number: string; unit_id: string; monthly_rent_minor: number; status: string }>;
  const hubItems = (overviewQuery.data?.hubItems ?? []) as Array<{ id: string; item_kind: string; unit_id: string | null; title: string; body_or_details_json: string; status: string }>;

  const visitors = hubItems.filter((i) => i.item_kind === 'visitor_pass' || i.item_kind === 'parking_pet');
  const packages = hubItems.filter((i) => i.item_kind === 'package_delivery');
  const amenities = hubItems.filter((i) => i.item_kind === 'amenity_booking');
  const polls = hubItems.filter((i) => i.item_kind === 'community_poll');

  return (
    <section className="space-y-5" data-slot="condo-resident-hub-view">
      <PageHeader
        title="Condominio, Leases & Hub Residencial"
        description="Visitantes con pase QR, paquetería en conserjería, estacionamiento/mascotas, amenidades y votaciones."
        onRefresh={() => void overviewQuery.refetch()}
        refreshing={overviewQuery.isFetching}
      />

      <AiCopilotBanner
        title="Copiloto de Administración Residencial IA"
        summary="Redacta comunicados vecinales, resume morosidad de contratos y analiza votaciones."
        prompts={['Resumir contratos y renovaciones', 'Redactar aviso de mantenimiento para residentes']}
        onRunPrompt={(p) => aiMutation.mutate(p)}
        reply={aiReply}
        onClearReply={() => setAiReply(null)}
        loading={aiMutation.isPending}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard title="Contratos Lease" value={leases.length} />
        <KpiCard title="Visitantes & Parking" value={visitors.length} />
        <KpiCard title="Paquetes Conserjería" value={packages.length} />
        <KpiCard title="Votaciones Activas" value={polls.length} />
      </div>

      {statusMsg ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{statusMsg}</p> : null}

      <form className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }}>
        <select value={itemKind} onChange={(e) => setItemKind(e.target.value as typeof itemKind)} className={INPUT_CLS}>
          <option value="visitor_pass">Pase Visitante QR</option>
          <option value="package_delivery">Paquete en Conserjería</option>
          <option value="parking_pet">Estacionamiento / Mascota</option>
          <option value="amenity_booking">Reserva de Amenidad</option>
          <option value="community_poll">Votación de Comunidad</option>
        </select>
        <input placeholder="Unidad (APT-4B)" value={unitId} onChange={(e) => setUnitId(e.target.value)} className={`${INPUT_CLS} font-mono`} />
        <input placeholder="Descripción / Título" value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT_CLS} required />
        <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Publicar en Hub</button>
      </form>

      <SegmentedTabs
        activeId={tab}
        onSelect={(id) => setTab(id as CondoTab)}
        tabs={[
          { id: 'visitors', label: 'Visitantes & Mascotas', count: visitors.length, icon: <QrCode className="size-3.5" /> },
          { id: 'packages', label: 'Paquetería', count: packages.length, icon: <Package className="size-3.5" /> },
          { id: 'amenities', label: 'Amenidades', count: amenities.length, icon: <Car className="size-3.5" /> },
          { id: 'polls', label: 'Votaciones', count: polls.length, icon: <Vote className="size-3.5" /> },
          { id: 'leases', label: 'Contratos Lease', count: leases.length, icon: <Building2 className="size-3.5" /> },
        ]}
      />

      {tab === 'polls' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {polls.map((p) => {
            const parsed = JSON.parse(p.body_or_details_json || '{}') as { options?: string[]; votes?: number[] };
            const options = parsed.options ?? ['A favor', 'En contra'];
            const votes = parsed.votes ?? options.map(() => 0);
            const totalVotes = Math.max(1, votes.reduce((a, b) => a + b, 0));
            return (
              <div key={p.id} className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{p.title}</h3>
                  <StatusBadge label={p.status} tone="info" />
                </div>
                <div className="space-y-2">
                  {options.map((opt, idx) => {
                    const count = votes[idx] ?? 0;
                    const pct = Math.round((count / totalVotes) * 100);
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => voteMutation.mutate({ id: p.id, optionIndex: idx })}
                        className="w-full rounded-lg border border-border bg-muted/30 p-2 text-left text-xs hover:bg-muted/60"
                      >
                        <div className="flex justify-between font-medium">
                          <span>{opt}</span>
                          <span className="font-mono tabular-nums">{count} votos ({pct}%)</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : tab === 'leases' ? (
        <DataTable
          columns={[
            { id: 'no', header: 'Contrato', cell: (r) => <span className="font-mono text-xs">{r.lease_number}</span> },
            { id: 'unit', header: 'Unidad', cell: (r) => r.unit_id },
            { id: 'rent', header: 'Canon Mensual', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.monthly_rent_minor, 'USD')}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> },
          ]}
          data={leases}
          getRowId={(r) => r.id}
          emptyTitle="Sin contratos de arrendamiento"
        />
      ) : (
        <DataTable
          columns={[
            { id: 'unit', header: 'Unidad', cell: (r) => <span className="font-mono text-xs">{r.unit_id ?? 'General'}</span> },
            { id: 'tit', header: 'Detalle', cell: (r) => r.title },
            { id: 'kind', header: 'Tipo', cell: (r) => <StatusBadge label={r.item_kind} tone="info" /> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> },
          ]}
          data={tab === 'visitors' ? visitors : tab === 'packages' ? packages : amenities}
          getRowId={(r) => r.id}
          emptyTitle="Sin registros en esta sección"
        />
      )}
    </section>
  );
}
