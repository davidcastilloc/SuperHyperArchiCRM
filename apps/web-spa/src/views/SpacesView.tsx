import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatMinorUnits,
  INPUT_CLS,
  parseNonNegInt,
  readApiError,
  type Phase2ViewProps,
} from './phase2-format';

/** Live Spaces Rack (ADR/RevPAR, reserve, check-in/out) & Waitlist view. */
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
    onSuccess: (data) => {
      setFeedback(`Lista de espera ${data.waitlistId} (${data.status})`);
    },
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

  return (
    <section className="space-y-4 p-4" data-slot="spaces-view">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{vocabulary.spaceSingular}s · Live Rack & Waitlist</h1>
          <p className="text-sm text-muted-foreground">
            Control de disponibilidad, bloqueo atómico y lista de espera.
          </p>
        </div>
        {metrics ? (
          <div className="flex gap-3 text-xs font-mono">
            <span>ADR {formatMinorUnits(metrics.adrMinor, 'USD')}</span>
            <span>RevPAR {formatMinorUnits(metrics.revParMinor, 'USD')}</span>
            <span>Occ {occupancyPct}</span>
          </div>
        ) : null}
      </div>

      <form onSubmit={handleReserve} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-4">
        <select value={activeUnitId} onChange={(e) => setUnitId(e.target.value)} className={INPUT_CLS}>
          {units.length === 0 ? (
            <option value="unit_101">unit_101 (demo)</option>
          ) : (
            units.map((u) => (
              <option key={u.unitId} value={u.unitId}>{u.unitNumber} · {u.unitTypeName}</option>
            ))
          )}
        </select>
        <select value={activePartyId} onChange={(e) => setPartyId(e.target.value)} className={INPUT_CLS}>
          {parties.length === 0 ? (
            <option value="party_1">party_1 (demo)</option>
          ) : (
            parties.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))
          )}
        </select>
        <input type="text" value={slotBucket} onChange={(e) => setSlotBucket(e.target.value)} placeholder="Slot / Fecha" className={`${INPUT_CLS} font-mono text-xs`} />
        <button type="submit" disabled={reserveMutation.isPending} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
          Reservar {vocabulary.spaceSingular}
        </button>
      </form>

      <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-3">
        <input type="text" value={bookingIdInput} onChange={(e) => setBookingIdInput(e.target.value)} placeholder="Booking ID para Check-In / Out" className={`${INPUT_CLS} font-mono text-xs`} />
        <button type="button" disabled={!bookingIdInput.trim() || transitionMutation.isPending} onClick={() => transitionMutation.mutate('CHECK_IN')} className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">
          Quick Check-In
        </button>
        <button type="button" disabled={!bookingIdInput.trim() || transitionMutation.isPending} onClick={() => transitionMutation.mutate('CHECK_OUT')} className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">
          Check-Out (+Limpieza)
        </button>
      </div>

      <form onSubmit={handleWaitlist} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-3">
        <select value={activeWaitlistPartyId} onChange={(e) => setWaitlistPartyId(e.target.value)} className={INPUT_CLS}>
          {parties.length === 0 ? (
            <option value="party_1">party_1 (demo)</option>
          ) : (
            parties.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))
          )}
        </select>
        <select value={waitlistPriority} onChange={(e) => setWaitlistPriority(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT')} className={INPUT_CLS}>
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
          <option value="URGENT">URGENT</option>
        </select>
        <button type="submit" disabled={waitlistMutation.isPending} className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted">
          Agregar a Waitlist
        </button>
      </form>

      {feedback ? (
        <p className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-mono">{feedback}</p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Tarifa Base</th>
              <th className="px-3 py-2">Acción</th>
            </tr>
          </thead>
          <tbody>
            {units.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Sin unidades cargadas en el rack.
                </td>
              </tr>
            ) : (
              units.map((u) => (
                <tr key={u.unitId} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs">{u.unitNumber}</td>
                  <td className="px-3 py-2 text-xs">{u.unitTypeName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{u.currentStatus}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatMinorUnits(u.baseRateMinor, 'USD')}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setUnitId(u.unitId)} className="rounded border border-border px-2 py-1 text-xs hover:bg-muted">
                      Seleccionar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
