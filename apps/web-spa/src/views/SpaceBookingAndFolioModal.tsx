import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BedDouble, CheckCircle2, Receipt, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

interface SpaceBookingAndFolioModalProps {
  rpc: Phase2ViewProps['rpc'];
  mode: 'unit' | 'booking' | 'folio' | null;
  onClose: () => void;
  units: Array<{ id: string; unit_number: string }>;
  parties: Array<{ id: string; displayName: string }>;
  activeFolio: { id: string; folio_number: string; balance_minor: number; currency: string; booking_id?: string | null } | null;
  onSuccess: (msg: string) => void;
}

/** Modals for Creating Rooms/Units, Quick Check-In Reservations, and Folio Charge/Settle. */
export function SpaceBookingAndFolioModal({
  rpc, mode, onClose, units, parties, activeFolio, onSuccess,
}: SpaceBookingAndFolioModalProps) {
  const queryClient = useQueryClient();
  const [unitNumber, setUnitNumber] = useState('101');
  const [floorLabel, setFloorLabel] = useState('Piso 1');
  const [typeName, setTypeName] = useState('Suite Ejecutiva');
  const [rateMajor, setRateMajor] = useState('120.00');
  const [partyId, setPartyId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [checkInNow, setCheckInNow] = useState(true);
  const [chargeDesc, setChargeDesc] = useState('Minibar / Room Service');
  const [chargeMajor, setChargeMajor] = useState('15.00');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, onClose]);

  const unitMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.hospitality.units.$post(
        {},
        {
          init: {
            body: JSON.stringify({
              unitNumber: unitNumber.trim(),
              floorLabel: floorLabel.trim(),
              typeName: typeName.trim(),
              baseRateMinor: parseMajorToMinor(rateMajor),
              capacity: 2,
            }),
            headers: { 'content-type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw await readApiError(res);
      return (await res.json()) as { unitNumber: string };
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['hospitality', 'overview'] });
      void queryClient.invalidateQueries({ queryKey: ['spaces', 'rack'] });
      onSuccess(`Habitación ${d.unitNumber} creada en el Rack.`);
      onClose();
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const bookingMutation = useMutation({
    mutationFn: async () => {
      const targetParty = partyId || parties[0]?.id || '';
      const targetUnit = unitId || units[0]?.id || '';
      if (!targetParty || !targetUnit) throw new Error('Selecciona huésped y habitación.');
      const nowSec = Math.floor(Date.now() / 1000);
      const res = await rpc.api.spaces.bookings.reserve.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          partyId: targetParty,
          unitId: targetUnit,
          slotBucket: new Date(nowSec * 1000).toISOString().slice(0, 10),
          scheduledStart: nowSec + 60,
          scheduledEnd: nowSec + 86_400,
        },
      });
      if (!res.ok) throw await readApiError(res);
      const booked = await res.json();
      if (checkInNow) {
        const trRes = await rpc.api.spaces.bookings.transition.$post({
          json: { clientMutationId: crypto.randomUUID(), bookingId: booked.bookingId, action: 'CHECK_IN' },
        });
        if (!trRes.ok) throw await readApiError(trRes);
      }
      return booked;
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['hospitality', 'overview'] });
      void queryClient.invalidateQueries({ queryKey: ['spaces', 'rack'] });
      onSuccess(`Reserva ${d.confirmationCode ?? d.bookingId} ${checkInNow ? 'con Check-In activo' : 'confirmada'}.`);
      onClose();
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const folioMutation = useMutation({
    mutationFn: async (action: 'charge' | 'settle') => {
      if (!activeFolio) throw new Error('Folio no seleccionado');
      const res = await rpc.api.hospitality.folios[':id']['charge-or-settle'].$post(
        { param: { id: activeFolio.id } },
        {
          init: {
            body: JSON.stringify(
              action === 'charge'
                ? { action: 'charge', description: chargeDesc.trim(), amountMinor: Math.max(100, parseMajorToMinor(chargeMajor)) }
                : { action: 'settle' },
            ),
            headers: { 'content-type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw await readApiError(res);
      if (action === 'settle' && activeFolio.booking_id) {
        await rpc.api.spaces.bookings.transition.$post({
          json: { clientMutationId: crypto.randomUUID(), bookingId: activeFolio.booking_id, action: 'CHECK_OUT' },
        });
      }
      return (await res.json()) as { status: string };
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['hospitality', 'overview'] });
      void queryClient.invalidateQueries({ queryKey: ['spaces', 'rack'] });
      onSuccess(d.status === 'CLOSED' ? 'Folio liquidado y Check-Out completado.' : 'Cargo añadido al folio.');
      if (d.status === 'CLOSED') onClose();
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  if (!mode) return null;

  return (
    <div role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            {mode === 'unit' ? <BedDouble className="size-4 text-primary" /> : mode === 'booking' ? <CheckCircle2 className="size-4 text-primary" /> : <Receipt className="size-4 text-primary" />}
            <h3 className="text-sm font-semibold">
              {mode === 'unit' ? 'Nueva Habitación / Espacio' : mode === 'booking' ? 'Reserva & Quick Check-In' : `Folio ${activeFolio?.folio_number ?? ''}`}
            </h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
        </div>

        {errorMsg ? <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}

        {mode === 'unit' ? (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); unitMutation.mutate(); }} className="space-y-3">
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">N° Habitación</span><input value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} required /></label>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Piso / Sección</span><input value={floorLabel} onChange={(e) => setFloorLabel(e.target.value)} className={`${INPUT_CLS} w-full`} /></label>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Categoría</span><input value={typeName} onChange={(e) => setTypeName(e.target.value)} className={`${INPUT_CLS} w-full`} required /></label>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Tarifa Base / Noche (USD)</span><input value={rateMajor} onChange={(e) => setRateMajor(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} required /></label>
            <button type="submit" disabled={unitMutation.isPending} className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">Crear Habitación</button>
          </form>
        ) : mode === 'booking' ? (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); bookingMutation.mutate(); }} className="space-y-3">
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Huésped</span>
              <select value={partyId || parties[0]?.id || ''} onChange={(e) => setPartyId(e.target.value)} className={`${INPUT_CLS} w-full`}>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Habitación</span>
              <select value={unitId || units[0]?.id || ''} onChange={(e) => setUnitId(e.target.value)} className={`${INPUT_CLS} w-full`}>
                {units.map((u) => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={checkInNow} onChange={(e) => setCheckInNow(e.target.checked)} /><span>Hacer Quick Check-In inmediato</span></label>
            <button type="submit" disabled={bookingMutation.isPending} className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">Confirmar Reserva</button>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
              Saldo Pendiente: <strong>{formatMinorUnits(activeFolio?.balance_minor ?? 0, activeFolio?.currency ?? 'USD')}</strong>
            </p>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Concepto Cargo</span><input value={chargeDesc} onChange={(e) => setChargeDesc(e.target.value)} className={`${INPUT_CLS} w-full`} /></label>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Monto (USD)</span><input value={chargeMajor} onChange={(e) => setChargeMajor(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} /></label>
            <div className="flex gap-2">
              <button type="button" disabled={folioMutation.isPending} onClick={() => folioMutation.mutate('charge')} className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-border text-xs font-medium hover:bg-muted">Agregar Cargo</button>
              <button type="button" disabled={folioMutation.isPending} onClick={() => folioMutation.mutate('settle')} className="inline-flex h-9 flex-1 items-center justify-center rounded-md bg-checkout text-xs font-semibold text-checkout-foreground">Liquidar & Check-Out</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
