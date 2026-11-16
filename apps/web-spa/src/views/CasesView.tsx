import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { INPUT_CLS, type Phase2ViewProps } from './phase2-format';

/** Clinical SOAP + Co-Sign, ABA Trial, and Legal Matter/Docket workbench. */
export function CasesView({ vocabulary, rpc }: Phase2ViewProps) {
  const [patientPartyId, setPatientPartyId] = useState('pty_1');
  const [subjective, setSubjective] = useState('Paciente refiere mejoría.');
  const [assessment, setAssessment] = useState('Evolución favorable.');
  const [noteId, setNoteId] = useState('');
  const [abaBehavior, setAbaBehavior] = useState('Seguimiento visual');
  const [matterRef, setMatterRef] = useState('MAT-2026-001');
  const [matterTitle, setMatterTitle] = useState('Revisión contractual');
  const [feedback, setFeedback] = useState<string | null>(null);

  const soapMutation = useMutation({
    mutationFn: async (cosign: boolean) => {
      const res = await rpc.api.cases.med['soap-notes'].$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          patientPartyId: patientPartyId.trim(),
          noteFormat: 'SOAP',
          subjective: subjective.trim(),
          assessment: assessment.trim(),
          ...(cosign && noteId.trim()
            ? { clinicalNoteId: noteId.trim(), cosignStatus: 'approved' as const }
            : {}),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      setNoteId(data.id);
      setFeedback(`Nota SOAP ${data.id} · Estado: ${data.status} · Co-firma: ${data.supervisionStatus ?? 'pendiente'}`);
    },
    onError: (err) => setFeedback(err.message),
  });

  const abaMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.cases.med['aba-trials'].$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          patientPartyId: patientPartyId.trim(),
          recordKind: 'aba_trial',
          titleOrBehavior: abaBehavior.trim(),
          isCorrectTrial: true,
          durationSec: 45,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => setFeedback(`Ensayo ABA ${data.id} registrado (${data.titleOrBehavior}).`),
    onError: (err) => setFeedback(err.message),
  });

  const matterMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.cases.legal.matters.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          referenceNumber: matterRef.trim(),
          clientPartyId: patientPartyId.trim(),
          practiceArea: 'corporate',
          title: matterTitle.trim(),
          billingMode: 'retainer_trust',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => setFeedback(`Expediente Legal ${data.referenceNumber} (${data.status}) creado.`),
    onError: (err) => setFeedback(err.message),
  });

  function handleSoapSubmit(e: FormEvent) {
    e.preventDefault();
    if (!patientPartyId.trim() || soapMutation.isPending) return;
    soapMutation.mutate(false);
  }

  return (
    <section className="space-y-4 p-4" data-slot="cases-view">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{vocabulary.caseSingular}s · Salud (SOAP/ABA) & Legal</h1>
        <p className="text-sm text-muted-foreground">
          Notas clínicas SOAP con cola de co-firma, ensayos ABA y expedientes legales.
        </p>
      </div>

      {feedback && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          {feedback}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={handleSoapSubmit} className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">Nota Clínica SOAP & Co-Firma</h2>
          <input className={INPUT_CLS} value={patientPartyId} onChange={(e) => setPatientPartyId(e.target.value)} placeholder="ID Paciente / Cliente" />
          <input className={INPUT_CLS} value={subjective} onChange={(e) => setSubjective(e.target.value)} placeholder="Subjetivo" />
          <input className={INPUT_CLS} value={assessment} onChange={(e) => setAssessment(e.target.value)} placeholder="Evaluación" />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={soapMutation.isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
              {soapMutation.isPending ? 'Guardando...' : 'Crear Nota SOAP'}
            </button>
            <button type="button" disabled={!noteId.trim() || soapMutation.isPending} onClick={() => soapMutation.mutate(true)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium">
              Co-Firmar ({noteId || 'sin ID'})
            </button>
          </div>
        </form>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">Ensayo ABA & Expediente Legal</h2>
          <div className="flex gap-2">
            <input className={INPUT_CLS} value={abaBehavior} onChange={(e) => setAbaBehavior(e.target.value)} placeholder="Conducta ABA" />
            <button type="button" disabled={abaMutation.isPending} onClick={() => abaMutation.mutate()} className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium">
              Registrar ABA
            </button>
          </div>
          <div className="flex gap-2">
            <input className={INPUT_CLS} value={matterRef} onChange={(e) => setMatterRef(e.target.value)} placeholder="Ref. Legal" />
            <input className={INPUT_CLS} value={matterTitle} onChange={(e) => setMatterTitle(e.target.value)} placeholder="Título" />
            <button type="button" disabled={matterMutation.isPending} onClick={() => matterMutation.mutate()} className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium">
              Crear Matter
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
