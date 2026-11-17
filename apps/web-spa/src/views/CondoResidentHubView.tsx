import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Car, Megaphone, Package, Plus, QrCode, Vote } from 'lucide-react';
import { useState } from 'react';
import { AiCopilotBanner, DataTable, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';
import { SplitRentLeaseModal } from './SplitRentLeaseModal';

type CondoTab = 'leases' | 'visitors' | 'packages' | 'amenities' | 'polls' | 'announcements';

/** Condo Resident Hub, Authenticated Polls, Announcements & Split-Rent Leases. */
export function CondoResidentHubView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CondoTab>('visitors');
  const [itemKind, setItemKind] = useState<'visitor_pass' | 'package_delivery' | 'parking_pet' | 'amenity_booking' | 'community_poll' | 'announcement'>('visitor_pass');
  const [title, setTitle] = useState('');
  const [unitId, setUnitId] = useState('');
  const [modalMode, setModalMode] = useState<'unit' | 'lease' | null>(null);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['condo', 'overview'],
    queryFn: async () => {
      const res = await rpc.api.condo.overview.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const unitsQuery = useQuery({
    queryKey: ['hospitality', 'overview', 'condo-units'],
    queryFn: async () => {
      const res = await rpc.api.hospitality.overview.$get();
      if (!res.ok) return { units: [] as Array<{ id: string; unit_number: string }> };
      return res.json();
    },
  });

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'condo-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) return { items: [] as Array<{ id: string; displayName: string }> };
      return res.json();
    },
  });

  const units = (unitsQuery.data?.units ?? []) as Array<{ id: string; unit_number: string }>;
  const parties = partiesQuery.data?.items ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const targetUnit = unitId || units[0]?.unit_number || 'General';
      const details =
        itemKind === 'community_poll'
          ? { options: ['A favor', 'En contra'], votes: [0, 0] }
          : { createdFrom: 'CondoResidentHub' };
      const res = await rpc.api.condo['hub-items'].$post({
        json: { itemKind, title: title.trim(), unitId: targetUnit, details },
      });
      if (!res.ok) throw await readApiError(res);
      let pinNote = '';
      if (itemKind === 'visitor_pass') {
        const pinSecret = String(Math.floor(100000 + Math.random() * 900000));
        const passRes = await rpc.api.physical.passes.issue.$post({
          json: {
            clientMutationId: crypto.randomUUID(),
            holderName: title.trim(),
            pinOrQrSecret: pinSecret,
            passKind: 'VISITOR_TEMP',
            validFrom: Math.floor(Date.now() / 1000),
            validUntil: Math.floor(Date.now() / 1000) + 86_400,
          },
        });
        if (passRes.ok) {
          pinNote = ` · PIN Garita: ${pinSecret}`;
        }
      }
      return { pinNote };
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['condo', 'overview'] });
      setTitle('');
      setStatusMsg(`Registro publicado en el Hub del Condominio${d.pinNote}.`);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const voteMutation = useMutation({
    mutationFn: async (vars: { id: string; optionIndex: number }) => {
      const res = await rpc.api.condo['hub-items'][':id'].vote.$post(
        { param: { id: vars.id } },
        { init: { body: JSON.stringify({ optionIndex: vars.optionIndex }), headers: { 'content-type': 'application/json' } } },
      );
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['condo', 'overview'] });
      setStatusMsg('Voto comunitario contabilizado.');
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const renewLeaseMutation = useMutation({
    mutationFn: async (vars: { leaseId: string; monthlyRentMinor: number }) => {
      const nowSec = Math.floor(Date.now() / 1000);
      const res = await rpc.api.leases.contracts['renew-or-vacate'].$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          leaseId: vars.leaseId,
          action: 'renewal_offer',
          newStartDate: nowSec,
          newEndDate: nowSec + 86_400 * 365,
          newMonthlyRentMinor: vars.monthlyRentMinor,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['condo', 'overview'] });
      setStatusMsg('Contrato renovado exitosamente.');
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

  const leases = (overviewQuery.data?.leases ?? []) as Array<{ id: string; lease_number: string; unit_id: string; monthly_rent_minor: number; status: string }>;
  const hubItems = (overviewQuery.data?.hubItems ?? []) as Array<{ id: string; item_kind: string; unit_id: string | null; title: string; body_or_details_json: string; status: string }>;

  const visitors = hubItems.filter((i) => i.item_kind === 'visitor_pass' || i.item_kind === 'parking_pet');
  const packages = hubItems.filter((i) => i.item_kind === 'package_delivery');
  const amenities = hubItems.filter((i) => i.item_kind === 'amenity_booking');
  const polls = hubItems.filter((i) => i.item_kind === 'community_poll');
  const announcements = hubItems.filter((i) => i.item_kind === 'announcement');

  return (
    <section className="space-y-5" data-slot="condo-resident-hub-view">
      <PageHeader
        title="Condominio, Leases & Hub Residencial"
        description="Visitantes con pase QR/PIN, paquetería, amenidades, comunicados, votaciones y Split Rent."
        onRefresh={() => void overviewQuery.refetch()}
        refreshing={overviewQuery.isFetching}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setModalMode('unit')} className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted">
              <Plus className="size-3.5" /><span>Nueva Unidad</span>
            </button>
            <button type="button" onClick={() => setModalMode('lease')} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
              <Building2 className="size-3.5" /><span>Activar Lease + Split Rent</span>
            </button>
          </div>
        }
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

      {errorMsg ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}
      {statusMsg ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{statusMsg}</p> : null}

      <form className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }}>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Tipo de Registro</span>
          <select value={itemKind} onChange={(e) => setItemKind(e.target.value as typeof itemKind)} className={`${INPUT_CLS} w-full`}>
            <option value="visitor_pass">Pase Visitante QR/PIN</option>
            <option value="package_delivery">Paquete en Conserjería</option>
            <option value="parking_pet">Estacionamiento / Mascota</option>
            <option value="amenity_booking">Reserva de Amenidad</option>
            <option value="community_poll">Votación de Comunidad</option>
            <option value="announcement">Comunicado Vecinal</option>
          </select>
        </label>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Unidad</span>
          <select value={unitId || units[0]?.unit_number || ''} onChange={(e) => setUnitId(e.target.value)} className={`${INPUT_CLS} w-full font-mono`}>
            <option value="General">General / Áreas Comunes</option>
            {units.map((u) => <option key={u.id} value={u.unit_number}>{u.unit_number}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Descripción / Título</span>
          <input placeholder="Nombre visitante o asunto" value={title} onChange={(e) => setTitle(e.target.value)} className={`${INPUT_CLS} w-full`} required />
        </label>
        <button type="submit" disabled={createMutation.isPending} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Publicar en Hub</button>
      </form>

      <SegmentedTabs
        activeId={tab}
        onSelect={(id) => setTab(id as CondoTab)}
        tabs={[
          { id: 'visitors', label: 'Visitantes & Mascotas', count: visitors.length, icon: <QrCode className="size-3.5" /> },
          { id: 'packages', label: 'Paquetería', count: packages.length, icon: <Package className="size-3.5" /> },
          { id: 'amenities', label: 'Amenidades', count: amenities.length, icon: <Car className="size-3.5" /> },
          { id: 'announcements', label: 'Comunicados', count: announcements.length, icon: <Megaphone className="size-3.5" /> },
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
                <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{p.title}</h3><StatusBadge label={p.status} tone="info" /></div>
                <div className="space-y-2">
                  {options.map((opt, idx) => {
                    const count = votes[idx] ?? 0;
                    const pct = Math.round((count / totalVotes) * 100);
                    return (
                      <button key={opt} type="button" onClick={() => voteMutation.mutate({ id: p.id, optionIndex: idx })} className="w-full rounded-lg border border-border bg-muted/30 p-2 text-left text-xs hover:bg-muted/60">
                        <div className="flex justify-between font-medium"><span>{opt}</span><span className="font-mono tabular-nums">{count} votos ({pct}%)</span></div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
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
            { id: 'rent', header: 'Canon Mensual', align: 'right', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.monthly_rent_minor, 'USD')}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> },
          ]}
          data={leases}
          getRowId={(r) => r.id}
          emptyTitle="Sin contratos de arrendamiento"
          rowActions={(r) => [{ id: 'renew', label: 'Renovar Contrato', onSelect: () => renewLeaseMutation.mutate({ leaseId: r.id, monthlyRentMinor: r.monthly_rent_minor }) }]}
        />
      ) : (
        <DataTable
          columns={[
            { id: 'unit', header: 'Unidad', cell: (r) => <span className="font-mono text-xs">{r.unit_id ?? 'General'}</span> },
            { id: 'tit', header: 'Detalle', cell: (r) => r.title },
            { id: 'kind', header: 'Tipo', cell: (r) => <StatusBadge label={r.item_kind} tone="info" /> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> },
          ]}
          data={tab === 'visitors' ? visitors : tab === 'packages' ? packages : tab === 'announcements' ? announcements : amenities}
          getRowId={(r) => r.id}
          emptyTitle="Sin registros en esta sección"
        />
      )}

      <SplitRentLeaseModal rpc={rpc} mode={modalMode} onClose={() => setModalMode(null)} units={units} parties={parties} onSuccess={(m) => setStatusMsg(m)} />
    </section>
  );
}
