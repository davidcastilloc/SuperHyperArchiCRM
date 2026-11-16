import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Clock, LogIn, LogOut } from 'lucide-react';
import { DataTable, KpiCard, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import {
  formatMinorUnits,
  INPUT_CLS,
  parseNonNegInt,
  readApiError,
  type Phase2ViewProps,
} from './phase2-format';

/** Open Mercato DS v3 Live Spaces Rack (ADR/RevPAR, reserve, check-in/out) & Waitlist view. */
export function SpacesView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [unitId, setUnitId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [slotBucket, setSlotBucket] = useState('2026-12-01..2026-12-02');
  const [waitlistPartyId, setWaitlistPartyId] = useState('');
  const [waitlistPriority, setWaitlistPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'>('HIGH');
  const [bookingIdInput, setBookingIdInput] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const rackQuery = useQuery({
    queryKey: ['spaces', 'rack'],
    queryFn: async () => {
      const res = await rpc.api.spaces.rack.$get({ query: {} });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'spaces-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const units = rackQuery.data?.units ?? [];
  const parties = partiesQuery.data?.items ?? [];
  const activeUnitId = unitId || units[0]?.unitId || 'unit_101';
  const activePartyId = partyId || parties[0]?.id || 'party_1';
  const activeWaitlistPartyId = waitlistPartyId || parties[0]?.id || 'party_1';

  const reserveMutation = useMutation({
    mutationFn: async () => {
      const nowMs = Date.now();
      const res = await rpc.api.spaces.bookings.reserve.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          unitId: activeUnitId.trim(),
          partyId: activePartyId.trim(),
          slotBucket: slotBucket.trim(),
          scheduledStart: nowMs,
          scheduledEnd: nowMs + 86_400_000,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setBookingIdInput(data.bookingId);
      void queryClient.invalidateQueries({ queryKey: ['spaces', 'rack'] });
      setFeedback(`Reserva ${data.confirmationCode} (${data.status}) · ${formatMinorUnits(data.totalMinor, data.currency)}`);
    },
    onError: (err) => setFeedback(err.message),
  });

  const transitionMutation = useMutation({
    mutationFn: async (action: 'CHECK_IN' | 'CHECK_OUT') => {
      const res = await rpc.api.spaces.bookings.transition.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          bookingId: bookingIdInput.trim(),
          action,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['spaces', 'rack'] });
      setFeedback(
        data.housekeepingTaskId
          ? `Estado ${data.status} · Limpieza: ${data.housekeepingTaskId}`
          : `Estado ${data.status}`,
      );
    },
    onError: (err) => setFeedback(err.message),
  });

  const waitlistMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.spaces.waitlist.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          action: 'ADD',
          partyId: activeWaitlistPartyId.trim(),
          priority: waitlistPriority,
          preferredDates: [slotBucket.trim()],
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => setFeedback(`Lista de espera ${data.waitlistId} (${data.status})`),
    onError: (err) => setFeedback(err.message),
  });

  function handleReserve(e: FormEvent) {
    e.preventDefault();
    if (!activeUnitId.trim() || !activePartyId.trim() || reserveMutation.isPending) return;
    reserveMutation.mutate();
  }

  function handleWaitlist(e: FormEvent) {
    e.preventDefault();
    if (!activeWaitlistPartyId.trim() || waitlistMutation.isPending) return;
    waitlistMutation.mutate();
  }

  const metrics = rackQuery.data?.metrics;
  const occupancyPct = metrics ? `${Math.trunc(parseNonNegInt(String(metrics.occupancyBps)) / 100)}%` : '0%';
  type UnitRow = (typeof units)[number];
  const columns: DataTableColumn<UnitRow>[] = [
    { id: 'num', header: vocabulary.spaceSingular, sortValue: (u) => u.unitNumber, cell: (u) => <span className="font-mono text-xs font-medium">{u.unitNumber}</span> },
    { id: 'type', header: 'Tipo', cell: (u) => <span className="text-xs">{u.unitTypeName}</span> },
    {
      id: 'status',
      header: 'Estado',
      cell: (u) => (
        <StatusBadge
          label={u.currentStatus}
          tone={u.currentStatus === 'AVAILABLE' ? 'success' : u.currentStatus === 'DIRTY' ? 'warning' : 'info'}
          appearance="dot"
        />
      ),
    },
    { id: 'rate', header: 'Tarifa Base', align: 'right', sortValue: (u) => u.baseRateMinor, cell: (u) => <span className="font-mono font-medium tabular-nums">{formatMinorUnits(u.baseRateMinor, 'USD')}</span> },
  ];

  return (
    <section className="space-y-5" data-slot="spaces-view">
      <PageHeader
        title={`${vocabulary.spaceSingular}s · Rack & Lista de Espera`}
        description="Control de disponibilidad en Durable Object, check-in/out y asignación de housekeeping."
        onRefresh={() => void rackQuery.refetch()}
        refreshing={rackQuery.isFetching}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard title="ADR Promedio" value={formatMinorUnits(metrics?.adrMinor ?? 0, 'USD')} loading={rackQuery.isLoading} />
        <KpiCard title="RevPAR" value={formatMinorUnits(metrics?.revParMinor ?? 0, 'USD')} loading={rackQuery.isLoading} />
        <KpiCard title="Ocupación Actual" value={occupancyPct} loading={rackQuery.isLoading} />
      </div>

      <div className="rounded-xl border border-border bg-card shadow-xs divide-y divide-border">
        <form onSubmit={handleReserve} className="grid grid-cols-1 gap-2.5 p-4 md:grid-cols-4">
          <select value={activeUnitId} onChange={(e) => setUnitId(e.target.value)} className={INPUT_CLS}>
            {units.length === 0 ? <option value="unit_101">unit_101 (demo)</option> : units.map((u) => <option key={u.unitId} value={u.unitId}>{u.unitNumber} · {u.unitTypeName}</option>)}
          </select>
          <select value={activePartyId} onChange={(e) => setPartyId(e.target.value)} className={INPUT_CLS}>
            {parties.length === 0 ? <option value="party_1">party_1 (demo)</option> : parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
          <input type="text" value={slotBucket} onChange={(e) => setSlotBucket(e.target.value)} placeholder="Slot / Fecha" className={`${INPUT_CLS} font-mono text-xs`} />
          <button type="submit" disabled={reserveMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs">
            <CalendarPlus className="size-3.5" />
            <span>Reservar {vocabulary.spaceSingular}</span>
          </button>
        </form>

        <div className="grid grid-cols-1 gap-2.5 p-4 md:grid-cols-3">
          <input type="text" value={bookingIdInput} onChange={(e) => setBookingIdInput(e.target.value)} placeholder="Booking ID para Check-In / Out" className={`${INPUT_CLS} font-mono text-xs`} />
          <button type="button" disabled={!bookingIdInput.trim() || transitionMutation.isPending} onClick={() => transitionMutation.mutate('CHECK_IN')} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted disabled:opacity-50">
            <LogIn className="size-3.5 text-muted-foreground" />
            <span>Check-In</span>
          </button>
          <button type="button" disabled={!bookingIdInput.trim() || transitionMutation.isPending} onClick={() => transitionMutation.mutate('CHECK_OUT')} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted disabled:opacity-50">
            <LogOut className="size-3.5 text-muted-foreground" />
            <span>Check-Out (+Limpieza)</span>
          </button>
        </div>

        <form onSubmit={handleWaitlist} className="grid grid-cols-1 gap-2.5 p-4 md:grid-cols-3">
          <select value={activeWaitlistPartyId} onChange={(e) => setWaitlistPartyId(e.target.value)} className={INPUT_CLS}>
            {parties.length === 0 ? <option value="party_1">party_1 (demo)</option> : parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
          <select value={waitlistPriority} onChange={(e) => setWaitlistPriority(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT')} className={INPUT_CLS}>
            <option value="LOW">Prioridad Baja</option>
            <option value="MEDIUM">Prioridad Media</option>
            <option value="HIGH">Prioridad Alta</option>
            <option value="URGENT">Urgente</option>
          </select>
          <button type="submit" disabled={waitlistMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted">
            <Clock className="size-3.5 text-muted-foreground" />
            <span>Agregar a Lista de Espera</span>
          </button>
        </form>
      </div>

      {feedback ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p> : null}

      <DataTable
        columns={columns}
        data={units}
        getRowId={(u) => u.unitId}
        loading={rackQuery.isLoading}
        selectedRowId={activeUnitId}
        onRowClick={(u) => setUnitId(u.unitId)}
        emptyTitle="Sin unidades cargadas en el rack"
        emptyDescription="Configura espacios en la sucursal o realiza una reserva directa."
      />
    </section>
  );
}
