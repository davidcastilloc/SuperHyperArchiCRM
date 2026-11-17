import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Stethoscope, X } from 'lucide-react';
import { useState } from 'react';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

interface ClinicalAiScribeModalProps {
  open: boolean;
  onClose: () => void;
  rpc: Phase2ViewProps['rpc'];
  onCreated: (msg: string) => void;
}

/** AI Medical Scribe & Vitals intake modal generating SOAP + ICD-10 notes. */
export function ClinicalAiScribeModal({ open, onClose, rpc, onCreated }: ClinicalAiScribeModalProps) {
  const queryClient = useQueryClient();
  const [patientPartyId, setPatientPartyId] = useState('pty_pat_1');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [bpSys, setBpSys] = useState('120');
  const [bpDia, setBpDia] = useState('80');
  const [hr, setHr] = useState('76');
  const [tempC, setTempC] = useState('36.7');
  const [spo2, setSpo2] = useState('98');
  const [dictationText, setDictationText] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.clinical.encounters.$post({
        json: {
          patientPartyId: patientPartyId.trim() || 'pty_pat_1',
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
      void queryClient.invalidateQueries({ queryKey: ['clinical', 'overview'] });
      onCreated('Consulta registrada y nota SOAP generada con AI Scribe.');
      setChiefComplaint('');
      setDictationText('');
      onClose();
    },
  });

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="AI Scribe Clínico" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
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

        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input placeholder="ID Paciente" value={patientPartyId} onChange={(e) => setPatientPartyId(e.target.value)} className={`${INPUT_CLS} font-mono`} required />
            <input placeholder="Motivo de consulta" value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} className={INPUT_CLS} required />
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            <label className="text-[10px] text-muted-foreground">PAS<input value={bpSys} onChange={(e) => setBpSys(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full font-mono`} /></label>
            <label className="text-[10px] text-muted-foreground">PAD<input value={bpDia} onChange={(e) => setBpDia(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full font-mono`} /></label>
            <label className="text-[10px] text-muted-foreground">FC<input value={hr} onChange={(e) => setHr(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full font-mono`} /></label>
            <label className="text-[10px] text-muted-foreground">Temp °C<input value={tempC} onChange={(e) => setTempC(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full font-mono`} /></label>
            <label className="text-[10px] text-muted-foreground">SpO2 %<input value={spo2} onChange={(e) => setSpo2(e.target.value)} className={`${INPUT_CLS} mt-0.5 w-full font-mono`} /></label>
          </div>
          <textarea
            rows={4}
            value={dictationText}
            onChange={(e) => setDictationText(e.target.value)}
            placeholder="Dictado o resumen clínico (el AI Scribe genera nota SOAP + CIE-10 automáticamente)..."
            className="w-full rounded-md border border-input bg-background p-3 text-xs"
          />
          <button type="submit" disabled={mutation.isPending} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            <Sparkles className="size-3.5" />
            <span>{mutation.isPending ? 'Generando SOAP con IA...' : 'Guardar Signos y Generar SOAP'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
