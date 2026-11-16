import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCheck, ClipboardPlus, Scale, Stethoscope } from 'lucide-react';
import { PageHeader, StatusBadge } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Clinical SOAP + Co-Sign, ABA Trial, and Legal Matter/Docket workbench. */
export function CasesView({ vocabulary, rpc }: Phase2ViewProps) {
  const [patientPartyId, setPatientPartyId] = useState('');
  const [subjective, setSubjective] = useState('Paciente refiere mejoría.');
  const [assessment, setAssessment] = useState('Evolución favorable.');
  const [noteId, setNoteId] = useState('');
  const [abaBehavior, setAbaBehavior] = useState('Seguimiento visual');
  const [matterRef, setMatterRef] = useState('MAT-2026-001');
  const [matterTitle, setMatterTitle] = useState('Revisión contractual');
  const [feedback, setFeedback] = useState<string | null>(null);

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'cases-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const parties = partiesQuery.data?.items ?? [];
  const activePartyId = patientPartyId || parties[0]?.id || 'pty_1';

  const soapMutation = useMutation({
    mutationFn: async (cosign: boolean) => {
      const res = await rpc.api.cases.med['soap-notes'].$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          patientPartyId: activePartyId.trim(),
          noteFormat: 'SOAP',
          subjective: subjective.trim(),
          assessment: assessment.trim(),
          ...(cosign && noteId.trim()
            ? { clinicalNoteId: noteId.trim(), cosignStatus: 'approved' as const }
            : {}),
        },
      });
      if (!res.ok) throw await readApiError(res);
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
          patientPartyId: activePartyId.trim(),
          recordKind: 'aba_trial',
          titleOrBehavior: abaBehavior.trim(),
          isCorrectTrial: true,
          durationSec: 45,
        },
      });
      if (!res.ok) throw await readApiError(res);
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
          clientPartyId: activePartyId.trim(),
          practiceArea: 'corporate',
          title: matterTitle.trim(),
          billingMode: 'retainer_trust',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => setFeedback(`Expediente Legal ${data.referenceNumber} (${data.status}) creado.`),
    onError: (err) => setFeedback(err.message),
  });

  function handleSoapSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activePartyId.trim() || soapMutation.isPending) return;
    soapMutation.mutate(false);
  }

  return (
    <section className="space-y-5" data-slot="cases-view">
      <PageHeader
        title={`${vocabulary.caseSingular}s · Clínico (SOAP/ABA) & Legal`}
        description="Notas clínicas estructuradas con co-firma supervisora, ensayos ABA y expedientes jurídicos."
        onRefresh={() => void partiesQuery.refetch()}
        refreshing={partiesQuery.isFetching}
        actions={noteId ? <StatusBadge label={`Nota activa: ${noteId.slice(0, 8)}`} tone="info" /> : null}
      />

      {feedback ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <form onSubmit={handleSoapSubmit} className="space-y-3.5 rounded-xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <Stethoscope className="size-4 text-muted-foreground" />
              <span>Nota Clínica SOAP & Co-Firma</span>
            </h2>
            <StatusBadge label="HIPAA Audit" tone="neutral" />
          </div>
          <select className={`${INPUT_CLS} w-full`} value={activePartyId} onChange={(e) => setPatientPartyId(e.target.value)}>
            {parties.length === 0 ? <option value="pty_1">pty_1 (demo)</option> : parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
          <input className={`${INPUT_CLS} w-full`} value={subjective} onChange={(e) => setSubjective(e.target.value)} placeholder="Subjetivo" />
          <input className={`${INPUT_CLS} w-full`} value={assessment} onChange={(e) => setAssessment(e.target.value)} placeholder="Evaluación" />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={soapMutation.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs">
              <ClipboardPlus className="size-3.5" />
              <span>{soapMutation.isPending ? 'Guardando...' : 'Crear Nota SOAP'}</span>
            </button>
            <button type="button" disabled={!noteId.trim() || soapMutation.isPending} onClick={() => soapMutation.mutate(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted disabled:opacity-50">
              <CheckCheck className="size-3.5 text-muted-foreground" />
              <span>Co-Firmar Supervisor</span>
            </button>
          </div>
        </form>

        <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-xs divide-y divide-border">
          <div className="space-y-2.5 pb-4">
            <h2 className="text-sm font-semibold">Registro de Ensayo Conductual (ABA)</h2>
            <div className="flex gap-2">
              <input className={`${INPUT_CLS} flex-1`} value={abaBehavior} onChange={(e) => setAbaBehavior(e.target.value)} placeholder="Conducta ABA" />
              <button type="button" disabled={abaMutation.isPending} onClick={() => abaMutation.mutate()} className="h-9 shrink-0 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted">
                Registrar ABA
              </button>
            </div>
          </div>

          <div className="space-y-2.5 pt-4">
            <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <Scale className="size-4 text-muted-foreground" />
              <span>Expediente Jurídico (Matter / Docket)</span>
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className={`${INPUT_CLS} font-mono text-xs`} value={matterRef} onChange={(e) => setMatterRef(e.target.value)} placeholder="Ref. Legal" />
              <input className={INPUT_CLS} value={matterTitle} onChange={(e) => setMatterTitle(e.target.value)} placeholder="Título del asunto" />
            </div>
            <button type="button" disabled={matterMutation.isPending} onClick={() => matterMutation.mutate()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs">
              <Scale className="size-3.5" />
              <span>Abrir Expediente</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
