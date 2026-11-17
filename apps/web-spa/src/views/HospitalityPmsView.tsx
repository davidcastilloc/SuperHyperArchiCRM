import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, CheckCircle2, Plus, Receipt, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AiCopilotBanner, DataTable, EmptyState, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { formatMinorUnits, readApiError, type Phase2ViewProps } from './phase2-format';
import { SpaceBookingAndFolioModal } from './SpaceBookingAndFolioModal';

type HospTab = 'rack' | 'housekeeping' | 'bookings' | 'folios';

function roomTone(status: string): 'success' | 'warning' | 'error' | 'info' {
  if (status === 'AVAILABLE' || status === 'CLEAN' || status === 'INSPECTED') return 'success';
  if (status === 'DIRTY' || status === 'MAINTENANCE') return 'error';
  return 'info';
}

/** Hospitality PMS: Room Rack, Occupancy/ADR/RevPAR, Housekeeping, Bookings & Folios. */
export function HospitalityPmsView({ rpc, vocabulary }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<HospTab>('rack');
  const [modalMode, setModalMode] = useState<'unit' | 'booking' | 'folio' | null>(null);
  const [activeFolio, setActiveFolio] = useState<{ id: string; folio_number: string; balance_minor: number; currency: string; booking_id?: string | null } | null>(null);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['hospitality', 'overview'],
    queryFn: async () => {
      const res = await rpc.api.hospitality.overview.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const rackQuery = useQuery({
    queryKey: ['spaces', 'rack'],
    queryFn: async () => {
      const res = await rpc.api.spaces.rack.$get({ query: {} });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'hosp-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) return { items: [] as Array<{ id: string; displayName: string }> };
      return res.json();
    },
  });

  const hkMutation = useMutation({
    mutationFn: async (vars: { unitId: string; targetUnitStatus: 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'MAINTENANCE' }) => {
      const res = await rpc.api.hospitality.housekeeping.$post({
        json: { unitId: vars.unitId, taskKind: 'TURNOVER', targetUnitStatus: vars.targetUnitStatus, priority: 'HIGH' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['hospitality', 'overview'] });
      setStatusMsg(`Habitación ${d.unitId} actualizada a ${d.targetUnitStatus}.`);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const transitionMutation = useMutation({
    mutationFn: async (vars: { bookingId: string; action: 'CHECK_IN' | 'CHECK_OUT' }) => {
      const res = await rpc.api.spaces.bookings.transition.$post({
        json: { clientMutationId: crypto.randomUUID(), bookingId: vars.bookingId, action: vars.action },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (_d, vars) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['hospitality', 'overview'] });
      void queryClient.invalidateQueries({ queryKey: ['spaces', 'rack'] });
      setStatusMsg(`Reserva actualizada (${vars.action}).`);
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

  const units = (overviewQuery.data?.units ?? []) as Array<{ id: string; unit_number: string; floor_label: string | null; current_status: string; monthly_rent_minor: number }>;
  const housekeeping = (overviewQuery.data?.housekeeping ?? []) as Array<{ id: string; unit_id: string; unitNumber?: string | null; task_kind: string; priority: string; status: string }>;
  const bookings = (overviewQuery.data?.bookings ?? []) as Array<{ id: string; confirmation_code: string; guestName?: string | null; unitNumber?: string | null; unit_id: string | null; total_minor: number; status: string }>;
  const folios = (overviewQuery.data?.folios ?? []) as Array<{ id: string; folio_number: string; booking_id?: string | null; guestName?: string | null; unitNumber?: string | null; currency: string; total_minor: number; balance_minor: number; status: string }>;
  const parties = partiesQuery.data?.items ?? [];
  const kpis = (rackQuery.data as { kpis?: { occupancyPct?: number; adrMinor?: number; revparMinor?: number } } | null)?.kpis;

  return (
    <section className="space-y-5" data-slot="hospitality-pms-view">
      <PageHeader
        title={`Hotelería PMS · Rack & ${vocabulary.spaceSingular}`}
        description="Rack visual, ocupación/ADR/RevPAR, housekeeping, reservas check-in/out y folios."
        onRefresh={() => { void overviewQuery.refetch(); void rackQuery.refetch(); }}
        refreshing={overviewQuery.isFetching}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setModalMode('unit')} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted">
              <Plus className="size-3.5" /><span>Nueva Habitación</span>
            </button>
            <button type="button" onClick={() => setModalMode('booking')} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
              <CheckCircle2 className="size-3.5" /><span>Quick Check-In</span>
            </button>
          </div>
        }
      />

      <AiCopilotBanner
        title="Copiloto Hotelero IA"
        summary="Sugiere prioridad de limpieza por check-ins entrantes y optimiza tarifas por ocupación."
        prompts={['Priorizar habitaciones pendientes de limpieza', 'Resumir folios con saldo abierto']}
        onRunPrompt={(p) => aiMutation.mutate(p)}
        reply={aiReply}
        onClearReply={() => setAiReply(null)}
        loading={aiMutation.isPending}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard title="Habitaciones" value={units.length} />
        <KpiCard title="Ocupación" value={`${kpis?.occupancyPct ?? 0}%`} />
        <KpiCard title="ADR Promedio" value={formatMinorUnits(kpis?.adrMinor ?? 0, 'USD')} />
        <KpiCard title="RevPAR" value={formatMinorUnits(kpis?.revparMinor ?? 0, 'USD')} />
      </div>

      {errorMsg ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}
      {statusMsg ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{statusMsg}</p> : null}

      <SegmentedTabs
        activeId={tab}
        onSelect={(id) => setTab(id as HospTab)}
        tabs={[
          { id: 'rack', label: 'Rack Visual', count: units.length, icon: <BedDouble className="size-3.5" /> },
          { id: 'housekeeping', label: 'Housekeeping', count: housekeeping.length, icon: <Sparkles className="size-3.5" /> },
          { id: 'bookings', label: 'Reservas', count: bookings.length, icon: <CheckCircle2 className="size-3.5" /> },
          { id: 'folios', label: 'Folios', count: folios.length, icon: <Receipt className="size-3.5" /> },
        ]}
      />

      {tab === 'rack' ? (
        units.length === 0 ? (
          <EmptyState
            title="Sin habitaciones configuradas"
            description="Crea la primera habitación para activar el Rack visual y Check-In."
            actionLabel="Nueva Habitación"
            onAction={() => setModalMode('unit')}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            {units.map((u) => (
              <div key={u.id} className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-xs">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono text-sm font-semibold">{u.unit_number}</p>
                    <p className="text-[11px] text-muted-foreground">{u.floor_label ?? 'Planta Principal'}</p>
                  </div>
                  <StatusBadge label={u.current_status} tone={roomTone(u.current_status)} appearance="dot" />
                </div>
                <div className="mt-4 flex gap-1.5">
                  <button type="button" onClick={() => hkMutation.mutate({ unitId: u.id, targetUnitStatus: 'CLEAN' })} className="flex-1 rounded-md border border-border bg-background py-1 text-[11px] font-medium hover:bg-muted">Limpia</button>
                  <button type="button" onClick={() => hkMutation.mutate({ unitId: u.id, targetUnitStatus: 'DIRTY' })} className="flex-1 rounded-md border border-border bg-background py-1 text-[11px] font-medium hover:bg-muted">Sucia</button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === 'housekeeping' ? (
        <DataTable
          columns={[
            { id: 'unit', header: 'Habitación', cell: (r) => <span className="font-mono text-xs font-medium">{r.unitNumber ?? r.unit_id}</span> },
            { id: 'kind', header: 'Tarea', cell: (r) => r.task_kind },
            { id: 'pri', header: 'Prioridad', cell: (r) => <StatusBadge label={r.priority} tone={r.priority === 'HIGH' ? 'warning' : 'info'} /> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone={r.status === 'PENDING' ? 'warning' : 'success'} appearance="dot" /> },
          ]}
          data={housekeeping}
          getRowId={(r) => r.id}
          emptyTitle="Sin tareas de housekeeping"
        />
      ) : null}

      {tab === 'bookings' ? (
        <DataTable
          columns={[
            { id: 'code', header: 'Confirmación', cell: (r) => <span className="font-mono text-xs">{r.confirmation_code}</span> },
            { id: 'guest', header: vocabulary.partySingular, cell: (r) => <span className="text-xs font-medium">{r.guestName ?? 'Huésped'}</span> },
            { id: 'unit', header: 'Habitación', cell: (r) => r.unitNumber ?? r.unit_id ?? 'Sin asignar' },
            { id: 'tot', header: 'Total', align: 'right', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.total_minor, 'USD')}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone={r.status === 'checked_in' ? 'success' : 'info'} /> },
          ]}
          data={bookings}
          getRowId={(r) => r.id}
          emptyTitle="Sin reservas activas"
          rowActions={(r) => [
            { id: 'ci', label: 'Check-In', onSelect: () => transitionMutation.mutate({ bookingId: r.id, action: 'CHECK_IN' }) },
            { id: 'co', label: 'Check-Out', onSelect: () => transitionMutation.mutate({ bookingId: r.id, action: 'CHECK_OUT' }) },
          ]}
        />
      ) : null}

      {tab === 'folios' ? (
        <DataTable
          columns={[
            { id: 'no', header: 'Folio', cell: (r) => <span className="font-mono text-xs">{r.folio_number}</span> },
            { id: 'guest', header: vocabulary.partySingular, cell: (r) => <span className="text-xs font-medium">{r.guestName ?? 'Huésped'}</span> },
            { id: 'tot', header: 'Total', align: 'right', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.total_minor, r.currency)}</span> },
            { id: 'bal', header: 'Saldo', align: 'right', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.balance_minor, r.currency)}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone={r.status === 'CLOSED' ? 'success' : 'warning'} /> },
          ]}
          data={folios}
          getRowId={(r) => r.id}
          emptyTitle="Sin folios abiertos"
          rowActions={(r) => [
            { id: 'open', label: 'Cargar / Liquidar Folio', onSelect: () => { setActiveFolio(r); setModalMode('folio'); } },
          ]}
        />
      ) : null}

      <SpaceBookingAndFolioModal
        rpc={rpc}
        mode={modalMode}
        onClose={() => setModalMode(null)}
        units={units}
        parties={parties}
        activeFolio={activeFolio}
        onSuccess={(m) => setStatusMsg(m)}
      />
    </section>
  );
}
