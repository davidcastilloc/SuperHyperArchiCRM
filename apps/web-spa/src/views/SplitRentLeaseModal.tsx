import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { StatusBadge } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, parsePercentToBps, readApiError, type Phase2ViewProps } from './phase2-format';

export interface SplitShareInput {
  partyId: string;
  percentInput: string;
}

export function computeUiSplitPreview(
  monthlyRentMinor: number,
  shares: readonly SplitShareInput[],
): {
  valid: boolean;
  totalBps: number;
  allocations: Array<{ partyId: string; shareBps: number; amountMinor: number }>;
} {
  let totalBps = 0;
  const allocations = shares.map((s) => {
    const shareBps = parsePercentToBps(s.percentInput);
    totalBps += shareBps;
    return {
      partyId: s.partyId,
      shareBps,
      amountMinor: Math.round((monthlyRentMinor * shareBps) / 10_000),
    };
  });
  const valid = shares.length >= 1 && totalBps === 10_000 && shares.every((s) => s.partyId.trim().length > 0);
  return { valid, totalBps, allocations };
}

interface SplitRentLeaseModalProps {
  rpc: Phase2ViewProps['rpc'];
  mode: 'unit' | 'lease' | null;
  onClose: () => void;
  units: Array<{ id: string; unit_number: string }>;
  parties: Array<{ id: string; displayName: string }>;
  onSuccess: (msg: string) => void;
}

/** Modal for Creating Condo Units and Activating Split-Rent Leases (sum = 100.00%). */
export function SplitRentLeaseModal({ rpc, mode, onClose, units, parties, onSuccess }: SplitRentLeaseModalProps) {
  const queryClient = useQueryClient();
  const [unitNumber, setUnitNumber] = useState('APT-101');
  const [floorLabel, setFloorLabel] = useState('Torre A');
  const [rentMajor, setRentMajor] = useState('850.00');
  const [leaseNumber, setLeaseNumber] = useState(`LS-${String(Math.floor(Date.now() / 1000)).slice(-5)}`);
  const [unitId, setUnitId] = useState('');
  const [shares, setShares] = useState<SplitShareInput[]>([
    { partyId: parties[0]?.id ?? '', percentInput: '100' },
  ]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const rentMinor = parseMajorToMinor(rentMajor);
  const splitPreview = computeUiSplitPreview(rentMinor, shares.map((s, i) => ({
    ...s,
    partyId: s.partyId || (i === 0 ? parties[0]?.id ?? '' : ''),
  })));

  const unitMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.hospitality.units.$post(
        {},
        {
          init: {
            body: JSON.stringify({
              unitNumber: unitNumber.trim(),
              floorLabel: floorLabel.trim(),
              typeName: 'Apartamento Residencial',
              baseRateMinor: rentMinor,
              capacity: 4,
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
      void queryClient.invalidateQueries({ queryKey: ['condo', 'overview'] });
      onSuccess(`Unidad ${d.unitNumber} registrada en el condominio.`);
      onClose();
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const leaseMutation = useMutation({
    mutationFn: async () => {
      const targetUnit = unitId || units[0]?.id || '';
      if (!targetUnit || !splitPreview.valid) throw new Error('Selecciona unidad y verifica que los porcentajes sumen 100%.');
      const nowSec = Math.floor(Date.now() / 1000);
      const res = await rpc.api.leases.contracts.activate.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          leaseNumber: leaseNumber.trim(),
          unitId: targetUnit,
          primaryPartyId: splitPreview.allocations[0]!.partyId,
          monthlyRentMinor: rentMinor,
          startDate: nowSec,
          endDate: nowSec + 86_400 * 365,
          splitRentShares: splitPreview.allocations.map((a) => ({ partyId: a.partyId, shareBps: a.shareBps })),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['condo', 'overview'] });
      onSuccess(`Contrato ${leaseNumber} activado con Split Rent.`);
      onClose();
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  if (!mode) return null;

  return (
    <div role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">{mode === 'unit' ? 'Nueva Unidad / Apartamento' : 'Activar Contrato Lease + Split Rent'}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
        </div>

        {errorMsg ? <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}

        {mode === 'unit' ? (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); unitMutation.mutate(); }} className="space-y-3">
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">N° Unidad / Apartamento</span><input value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} required /></label>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Torre / Edificio</span><input value={floorLabel} onChange={(e) => setFloorLabel(e.target.value)} className={`${INPUT_CLS} w-full`} /></label>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Canon / Cuota Mensual (USD)</span><input value={rentMajor} onChange={(e) => setRentMajor(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} required /></label>
            <button type="submit" disabled={unitMutation.isPending} className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">Crear Unidad</button>
          </form>
        ) : (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); leaseMutation.mutate(); }} className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">N° Contrato</span><input value={leaseNumber} onChange={(e) => setLeaseNumber(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} required /></label>
              <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Unidad</span>
                <select value={unitId || units[0]?.id || ''} onChange={(e) => setUnitId(e.target.value)} className={`${INPUT_CLS} w-full`}>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
                </select>
              </label>
            </div>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Canon Mensual Total (USD)</span><input value={rentMajor} onChange={(e) => setRentMajor(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} required /></label>

            <div className="space-y-2 rounded-lg border border-border bg-muted/25 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Distribución Split Rent (100%)</span>
                <StatusBadge label={`${(splitPreview.totalBps / 100).toFixed(0)}%`} tone={splitPreview.valid ? 'success' : 'warning'} />
              </div>
              {shares.map((s, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select value={s.partyId || parties[0]?.id || ''} onChange={(e) => setShares((prev) => prev.map((r, i) => i === idx ? { ...r, partyId: e.target.value } : r))} className={`${INPUT_CLS} flex-1`}>
                    {parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                  </select>
                  <input value={s.percentInput} onChange={(e) => setShares((prev) => prev.map((r, i) => i === idx ? { ...r, percentInput: e.target.value } : r))} className={`${INPUT_CLS} w-20 font-mono tabular-nums`} placeholder="%" />
                  <span className="w-20 text-right font-mono text-[11px] text-muted-foreground">{formatMinorUnits(splitPreview.allocations[idx]?.amountMinor ?? 0, 'USD')}</span>
                  <button type="button" disabled={shares.length <= 1} onClick={() => setShares((prev) => prev.filter((_, i) => i !== idx))} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"><Trash2 className="size-3.5" /></button>
                </div>
              ))}
              <button type="button" onClick={() => setShares((prev) => [...prev, { partyId: parties[0]?.id ?? '', percentInput: '0' }])} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <Plus className="size-3" /><span>Agregar Co-Titular</span>
              </button>
            </div>
            <button type="submit" disabled={!splitPreview.valid || leaseMutation.isPending} className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-45">Activar Contrato Lease</button>
          </form>
        )}
      </div>
    </div>
  );
}
