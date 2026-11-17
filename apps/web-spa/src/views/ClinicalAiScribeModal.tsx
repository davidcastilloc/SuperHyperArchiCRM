import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Stethoscope, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

interface ClinicalAiScribeModalProps {
  open: boolean;
  onClose: () => void;
  rpc: Phase2ViewProps['rpc'];
  patients: Array<{ id: string; displayName: string }>;
  selectedPatientId: string;
  onCreated: (msg: string) => void;
}

/** AI Medical Scribe & Vitals intake modal generating DRAFT SOAP + ICD-10 notes. */
export function ClinicalAiScribeModal({
  open,
  onClose,
  rpc,
  patients,
  selectedPatientId,
  onCreated,
}: ClinicalAiScribeModalProps) {
  const queryClient = useQueryClient();
  const [patientPartyId, setPatientPartyId] = useState(selectedPatientId);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [bpSys, setBpSys] = useState('120');
  const [bpDia, setBpDia] = useState('80');
  const [hr, setHr] = useState('76');
  const [tempC, setTempC] = useState('36.7');
  const [spo2, setSpo2] = useState('98');
  const [dictationText, setDictationText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (selectedPatientId) setPatientPartyId(selectedPatientId);
  }, [selectedPatientId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const mutation = useMutation({
    mutationFn: async () => {
      const targetPatient = patientPartyId || selectedPatientId || patients[0]?.id || '';
      if (!targetPatient) throw new Error('Selecciona o registra un paciente antes de iniciar la consulta.');
      const res = await rpc.api.clinical.encounters.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          patientPartyId: targetPatient,
          chiefComplaint: chiefComplaint.trim() || 'Consulta general',
          vitals: {
            bpSystolic: Number(bpSys) || 120,
            bpDiastolic: Number(bpDia) || 80,
            heartRate: Number(hr) || 76,
            tempC: Number(tempC) || 36.7,
            spo2Pct: Number(spo2) || 98,
          },
          dictationText,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['clinical', 'overview'] });
      onCreated('Consulta registrada y borrador SOAP (DRAFT) generado para revisión médica.');
      setChiefComplaint('');
      setDictationText('');
      onClose();
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Scribe Clínico"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            <Stethoscope className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Nueva Consulta · Signos Vitales + AI Scribe</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar AI Scribe" className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        {errorMsg ? (
          <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMsg}
          </div>
        ) : null}

        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Paciente</span>
              <select value={patientPartyId || patients[0]?.id || ''} onChange={(e) => setPatientPartyId(e.target.value)} className={`${INPUT_CLS} w-full`}>
                {patients.length === 0 ? <option value="">Sin pacientes registrados</option> : null}
                {patients.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Motivo de consulta</span>
              <input placeholder="Motivo de consulta" value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} className={`${INPUT_CLS} w-full`} required />
            </label>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            <label className="text-[10px] text-muted-foreground">PAS<input value={bpSys} onChange={(e) => setBpSys(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full font-mono`} /></label>
            <label className="text-[10px] text-muted-foreground">PAD<input value={bpDia} onChange={(e) => setBpDia(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full font-mono`} /></label>
            <label className="text-[10px] text-muted-foreground">FC<input value={hr} onChange={(e) => setHr(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full font-mono`} /></label>
            <label className="text-[10px] text-muted-foreground">Temp °C<input value={tempC} onChange={(e) => setTempC(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full font-mono`} /></label>
            <label className="text-[10px] text-muted-foreground">SpO2 %<input value={spo2} onChange={(e) => setSpo2(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full font-mono`} /></label>
          </div>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Dictado o resumen clínico</span>
            <textarea
              rows={4}
              value={dictationText}
              onChange={(e) => setDictationText(e.target.value)}
              placeholder="El AI Scribe genera un borrador SOAP (DRAFT) para tu firma..."
              className="w-full rounded-md border border-input bg-background p-3 text-xs"
            />
          </label>
          <button type="submit" disabled={mutation.isPending || patients.length === 0} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-45">
            <Sparkles className="size-3.5" />
            <span>{mutation.isPending ? 'Generando SOAP con IA...' : 'Guardar Signos y Generar Borrador SOAP'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
