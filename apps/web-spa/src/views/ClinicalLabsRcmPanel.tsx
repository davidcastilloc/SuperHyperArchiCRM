import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable, StatusBadge } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

interface ClinicalLabsRcmPanelProps {
  rpc: Phase2ViewProps['rpc'];
  mode: 'labs' | 'rcm';
  activePatientId: string;
  labs: Array<{ id: string; order_or_accession_no: string; modality_or_category: string; abnormal_flag: string; status: string }>;
  rcmClaims: Array<{ id: string; claim_or_check_number: string; total_charge_minor: number; patient_responsibility_minor: number; status: string }>;
  onStatus: (msg: string) => void;
  onError: (msg: string | null) => void;
}

/** Clinical Laboratory/Imaging orders and RCM 837 claim scrubber tabs. */
export function ClinicalLabsRcmPanel({ rpc, mode, activePatientId, labs, rcmClaims, onStatus, onError }: ClinicalLabsRcmPanelProps) {
  const queryClient = useQueryClient();
  const [labTitle, setLabTitle] = useState('');
  const [rcmTitle, setRcmTitle] = useState('Consulta Especializada 99213');
  const [rcmIcd10, setRcmIcd10] = useState('R51.9');
  const [rcmCharge, setRcmCharge] = useState('120.00');
  const [rcmPaid, setRcmPaid] = useState('80.00');

  const labMutation = useMutation({
    mutationFn: async () => {
      if (!activePatientId) throw new Error('Selecciona un paciente activo.');
      const res = await rpc.api.clinical['labs-and-rcm'].$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          kind: 'lab_order',
          patientPartyId: activePatientId,
          titleOrModality: labTitle.trim(),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      onError(null);
      setLabTitle('');
      void queryClient.invalidateQueries({ queryKey: ['clinical', 'overview'] });
      onStatus(`Orden de laboratorio/imagen ${(d as { accessionNo?: string }).accessionNo ?? ''} creada.`);
    },
    onError: (err: Error) => onError(err.message),
  });

  const rcmMutation = useMutation({
    mutationFn: async () => {
      if (!activePatientId) throw new Error('Selecciona un paciente activo.');
      const codes = rcmIcd10.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await rpc.api.clinical['labs-and-rcm'].$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          kind: 'rcm_claim',
          patientPartyId: activePatientId,
          titleOrModality: rcmTitle,
          totalChargeMinor: parseMajorToMinor(rcmCharge),
          insurerPaidMinor: parseMajorToMinor(rcmPaid),
          diagnosisCodes: codes,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      onError(null);
      void queryClient.invalidateQueries({ queryKey: ['clinical', 'overview'] });
      onStatus(`Reclamo 837 ${(d as { claimNumber?: string }).claimNumber ?? ''} auditado.`);
    },
    onError: (err: Error) => onError(err.message),
  });

  if (mode === 'labs') {
    return (
      <div className="space-y-4">
        <form className="flex flex-wrap items-end gap-2.5 rounded-xl border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); if (labTitle.trim()) labMutation.mutate(); }}>
          <label className="min-w-64 flex-1 space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Estudio / Modalidad (Laboratorio o Imagen)</span>
            <input placeholder="Ej. Hematología Completa / RX Tórax" value={labTitle} onChange={(e) => setLabTitle(e.target.value)} className={`${INPUT_CLS} w-full`} required />
          </label>
          <button type="submit" disabled={labMutation.isPending} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground">Solicitar Estudio</button>
        </form>
        <DataTable
          columns={[
            { id: 'acc', header: 'Orden', cell: (r) => <span className="font-mono text-xs">{r.order_or_accession_no}</span> },
            { id: 'mod', header: 'Estudio', cell: (r) => r.modality_or_category },
            { id: 'flag', header: 'Alerta', cell: (r) => <StatusBadge label={r.abnormal_flag} tone={r.abnormal_flag === 'NORMAL' ? 'success' : 'warning'} /> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="info" /> },
          ]}
          data={labs}
          getRowId={(r) => r.id}
          emptyTitle="Sin órdenes de laboratorio"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); rcmMutation.mutate(); }}>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Procedimiento / CPT</span><input value={rcmTitle} onChange={(e) => setRcmTitle(e.target.value)} className={`${INPUT_CLS} w-full`} /></label>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">CIE-10 (coma)</span><input value={rcmIcd10} onChange={(e) => setRcmIcd10(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} /></label>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Cargo Total (USD)</span><input value={rcmCharge} onChange={(e) => setRcmCharge(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} /></label>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Cubierto Seguro (USD)</span><input value={rcmPaid} onChange={(e) => setRcmPaid(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} /></label>
        <button type="submit" disabled={rcmMutation.isPending} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Auditar 837</button>
      </form>
      <DataTable
        columns={[
          { id: 'no', header: 'Reclamo', cell: (r) => <span className="font-mono text-xs">{r.claim_or_check_number}</span> },
          { id: 'tot', header: 'Total', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.total_charge_minor, 'USD')}</span> },
          { id: 'pat', header: 'Copago Paciente', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.patient_responsibility_minor, 'USD')}</span> },
          { id: 'warn', header: 'Scrubber', cell: (r) => <StatusBadge label={r.status} tone={r.status === 'READY' ? 'success' : 'warning'} /> },
        ]}
        data={rcmClaims}
        getRowId={(r) => r.id}
        emptyTitle="Sin reclamos RCM"
      />
    </div>
  );
}
