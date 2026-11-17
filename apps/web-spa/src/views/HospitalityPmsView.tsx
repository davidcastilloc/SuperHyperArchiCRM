import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, CheckCircle2, Receipt, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { AiCopilotBanner, DataTable, EmptyState, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { formatMinorUnits, readApiError, type Phase2ViewProps } from './phase2-format';

type HospTab = 'rack' | 'housekeeping' | 'bookings' | 'folios';

function roomTone(status: string): 'success' | 'warning' | 'error' | 'info' {
  if (status === 'AVAILABLE' || status === 'CLEAN' || status === 'INSPECTED') return 'success';
  if (status === 'DIRTY' || status === 'MAINTENANCE') return 'error';
  return 'info';
}

/** Hospitality PMS: Color-coded Room Rack, Housekeeping Board, Bookings & Folios (hotel-project-turpial). */
export function HospitalityPmsView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<HospTab>('rack');
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['hospitality', 'overview'],
    queryFn: async () => {
      const res = await rpc.api.hospitality.overview.$get();
      if (!res.ok) throw await readApiError(res);
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
      void queryClient.invalidateQueries({ queryKey: ['hospitality', 'overview'] });
      setStatusMsg(`Habitación ${d.unitId} actualizada a ${d.targetUnitStatus}.`);
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

  const units = (overviewQuery.data?.units ?? []) as Array<{ id: string; unit_number: string; floor_label: string | null; current_status: string; monthly_rent_minor: number }>;
  const housekeeping = (overviewQuery.data?.housekeeping ?? []) as Array<{ id: string; unit_id: string; task_kind: string; priority: string; status: string }>;
  const bookings = (overviewQuery.data?.bookings ?? []) as Array<{ id: string; confirmation_code: string; unit_id: string | null; total_minor: number; status: string }>;
  const folios = (overviewQuery.data?.folios ?? []) as Array<{ id: string; folio_number: string; currency: string; total_minor: number; balance_minor: number; status: string }>;

  return (
    <section className="space-y-5" data-slot="hospitality-pms-view">
      <PageHeader
        title="Hotelería PMS · Rack & Housekeeping"
        description="Rack visual de habitaciones, tablero de camareras, reservas check-in/out y folios de consumo."
        onRefresh={() => void overviewQuery.refetch()}
        refreshing={overviewQuery.isFetching}
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
        <KpiCard title="Unidades / Habitaciones" value={units.length} />
        <KpiCard title="Limpiezas Registradas" value={housekeeping.length} />
        <KpiCard title="Reservas Activas" value={bookings.length} />
        <KpiCard title="Folios Abiertos" value={folios.length} />
      </div>

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
          <EmptyState title="Sin habitaciones configuradas" description="Crea unidades en el módulo de Espacios para ver el Rack visual." />
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
                  <button type="button" onClick={() => hkMutation.mutate({ unitId: u.id, targetUnitStatus: 'CLEAN' })} className="flex-1 rounded-md border border-border bg-background py-1 text-[11px] font-medium hover:bg-muted">
                    Limpia
                  </button>
                  <button type="button" onClick={() => hkMutation.mutate({ unitId: u.id, targetUnitStatus: 'DIRTY' })} className="flex-1 rounded-md border border-border bg-background py-1 text-[11px] font-medium hover:bg-muted">
                    Sucia
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === 'housekeeping' ? (
        <DataTable
          columns={[
            { id: 'unit', header: 'Unidad', cell: (r) => <span className="font-mono text-xs">{r.unit_id}</span> },
            { id: 'kind', header: 'Tarea', cell: (r) => r.task_kind },
            { id: 'pri', header: 'Prioridad', cell: (r) => <StatusBadge label={r.priority} tone={r.priority === 'HIGH' ? 'warning' : 'info'} /> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> },
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
            { id: 'unit', header: 'Unidad', cell: (r) => r.unit_id ?? 'Sin asignar' },
            { id: 'tot', header: 'Total', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.total_minor, 'USD')}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="info" /> },
          ]}
          data={bookings}
          getRowId={(r) => r.id}
          emptyTitle="Sin reservas activas"
        />
      ) : null}

      {tab === 'folios' ? (
        <DataTable
          columns={[
            { id: 'no', header: 'Folio', cell: (r) => <span className="font-mono text-xs">{r.folio_number}</span> },
            { id: 'tot', header: 'Total', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.total_minor, r.currency)}</span> },
            { id: 'bal', header: 'Saldo', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.balance_minor, r.currency)}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> },
          ]}
          data={folios}
          getRowId={(r) => r.id}
          emptyTitle="Sin folios abiertos"
        />
      ) : null}
    </section>
  );
}
