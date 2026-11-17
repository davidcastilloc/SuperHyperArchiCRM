import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Check, FileText, FlaskConical, Pill, ShieldAlert, Stethoscope, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { DataTable, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { ClinicalAiScribeModal } from './ClinicalAiScribeModal';
import { ClinicalLabsRcmPanel } from './ClinicalLabsRcmPanel';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

type TabId = 'vitals' | 'soap' | 'erx' | 'labs' | 'rcm';

function formatVitalsBadges(vitalsJson: string): string {
  try {
    const v = JSON.parse(vitalsJson || '{}') as Record<string, number | undefined>;
    return `PA ${v.bpSystolic ?? '—'}/${v.bpDiastolic ?? '—'} · FC ${v.heartRate ?? '—'} · ${v.tempC ?? '—'}°C · SpO2 ${v.spo2Pct ?? '—'}%`;
  } catch {
    return vitalsJson;
  }
}

/** Clinical EHR & Practice Workspace: Patient Selector, DRAFT->SIGNED SOAP, eRx, Lab/Imaging, and RCM 837. */
export function ClinicalEhrView({ rpc, vocabulary }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('vitals');
  const [scribeOpen, setScribeOpen] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [newPatientName, setNewPatientName] = useState('');
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [rxName, setRxName] = useState('');
  const [rxDose, setRxDose] = useState('');
  const [rxSig, setRxSig] = useState('Tomar 1 cada 8 horas por 7 días');

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'clinical-patients'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '100' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const overviewQuery = useQuery({
    queryKey: ['clinical', 'overview'],
    queryFn: async () => {
      const res = await rpc.api.clinical.overview.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const allParties = partiesQuery.data?.items ?? [];
  const patients = allParties.filter((p) => p.rolesMask.includes('patient') || p.rolesMask.includes('customer'));
  const activePatientId = selectedPatientId || patients[0]?.id || '';
  const patientMap = new Map(allParties.map((p) => [p.id, p.displayName]));

  const createPatientMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.customers.parties.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          displayName: newPatientName.trim(),
          partyKind: 'person',
          rolesMask: ['patient'],
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (p) => {
      setErrorMsg(null);
      setNewPatientName('');
      setShowNewPatient(false);
      setSelectedPatientId(p.id);
      void queryClient.invalidateQueries({ queryKey: ['customers', 'parties'] });
      setStatusMsg(`${vocabulary.partySingular} ${p.displayName} registrado.`);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const signNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      const res = await rpc.api.clinical.notes[':id'].sign.$post(
        { param: { id: noteId } },
        { init: { body: JSON.stringify({}), headers: { 'content-type': 'application/json' } } },
      );
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      setStatusMsg('Nota clínica SOAP revisada y firmada (SIGNED).');
      void queryClient.invalidateQueries({ queryKey: ['clinical', 'overview'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const rxMutation = useMutation({
    mutationFn: async () => {
      if (!activePatientId) throw new Error('Selecciona un paciente activo.');
      const res = await rpc.api.clinical.prescriptions.$post({
        json: { clientMutationId: crypto.randomUUID(), patientPartyId: activePatientId, medicationName: rxName, dosage: rxDose, sigInstructions: rxSig },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      setRxName('');
      setRxDose('');
      void queryClient.invalidateQueries({ queryKey: ['clinical', 'overview'] });
      setStatusMsg('Receta electrónica eRx transmitida.');
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const encounters = (overviewQuery.data?.encounters ?? []) as Array<{ id: string; patient_party_id: string; chief_complaint: string; vitals_json: string; status: string }>;
  const notes = (overviewQuery.data?.notes ?? []) as Array<{ id: string; patient_party_id: string; subjective: string; assessment: string; status: string }>;
  const prescriptions = (overviewQuery.data?.prescriptions ?? []) as Array<{ id: string; medication_name: string; dosage: string; sig_instructions: string; status: string }>;
  const labs = (overviewQuery.data?.labs ?? []) as Array<{ id: string; order_or_accession_no: string; modality_or_category: string; abnormal_flag: string; status: string }>;
  const rcmClaims = (overviewQuery.data?.rcmClaims ?? []) as Array<{ id: string; claim_or_check_number: string; total_charge_minor: number; patient_responsibility_minor: number; status: string }>;

  return (
    <section className="space-y-4">
      <PageHeader
        title={`Historia Clínica EHR · ${vocabulary.partyPlural}`}
        description="Signos vitales, AI Scribe SOAP (borrador -> firma), eRx, Laboratorio y Scrubber RCM."
        actions={
          <button
            type="button"
            onClick={() => setScribeOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs"
          >
            <Stethoscope className="size-3.5" />
            <span>Nueva Consulta + AI Scribe</span>
          </button>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card p-3.5 shadow-xs">
        <label className="min-w-60 flex-1 space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">{vocabulary.partySingular} Activo</span>
          <select value={activePatientId} onChange={(e) => setSelectedPatientId(e.target.value)} className={`${INPUT_CLS} w-full`}>
            {patients.length === 0 ? <option value="">Sin pacientes — registra uno</option> : null}
            {patients.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setShowNewPatient((v) => !v)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted">
          <UserPlus className="size-3.5" /><span>Registrar {vocabulary.partySingular}</span>
        </button>
      </div>

      {showNewPatient ? (
        <form onSubmit={(e) => { e.preventDefault(); if (newPatientName.trim()) createPatientMutation.mutate(); }} className="flex gap-2 rounded-xl border border-border bg-card p-3">
          <input value={newPatientName} onChange={(e) => setNewPatientName(e.target.value)} placeholder={`Nombre del ${vocabulary.partySingular.toLowerCase()}`} className={`${INPUT_CLS} flex-1`} />
          <button type="submit" disabled={createPatientMutation.isPending} className="h-9 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground">Guardar</button>
        </form>
      ) : null}

      {errorMsg ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}
      {statusMsg ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">{statusMsg}</div> : null}

      <SegmentedTabs
        activeId={tab}
        onSelect={(v) => setTab(v as TabId)}
        tabs={[
          { id: 'vitals', label: 'Signos & Espera', count: encounters.length, icon: <Activity className="size-3.5" /> },
          { id: 'soap', label: 'Notas SOAP', count: notes.length, icon: <FileText className="size-3.5" /> },
          { id: 'erx', label: 'Recetas eRx', count: prescriptions.length, icon: <Pill className="size-3.5" /> },
          { id: 'labs', label: 'Lab & Imagen', count: labs.length, icon: <FlaskConical className="size-3.5" /> },
          { id: 'rcm', label: 'Seguros RCM', count: rcmClaims.length, icon: <ShieldAlert className="size-3.5" /> },
        ]}
      />

      {tab === 'vitals' ? (
        <DataTable
          columns={[
            { id: 'pat', header: vocabulary.partySingular, cell: (r) => <span className="text-xs font-medium">{patientMap.get(r.patient_party_id) ?? r.patient_party_id}</span> },
            { id: 'cc', header: 'Motivo', cell: (r) => r.chief_complaint },
            { id: 'vit', header: 'Signos Vitales', cell: (r) => <span className="font-mono text-[11px] text-muted-foreground">{formatVitalsBadges(r.vitals_json)}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="info" appearance="dot" /> },
          ]}
          data={encounters}
          getRowId={(r) => r.id}
          emptyTitle="Sin consultas registradas"
        />
      ) : null}

      {tab === 'soap' ? (
        <DataTable
          columns={[
            { id: 'pat', header: vocabulary.partySingular, cell: (r) => <span className="text-xs font-medium">{patientMap.get(r.patient_party_id) ?? r.patient_party_id}</span> },
            { id: 'sub', header: 'Subjetivo', cell: (r) => <span className="line-clamp-2 text-xs">{r.subjective}</span> },
            { id: 'ass', header: 'Evaluación IA / CIE-10', cell: (r) => <span className="line-clamp-2 text-xs font-medium">{r.assessment}</span> },
            {
              id: 'st',
              header: 'Firma',
              cell: (r) => (
                <div className="flex items-center gap-2">
                  <StatusBadge label={r.status} tone={r.status === 'SIGNED' ? 'success' : 'warning'} appearance="dot" />
                  {r.status !== 'SIGNED' ? (
                    <button type="button" onClick={() => signNoteMutation.mutate(r.id)} className="inline-flex h-7 items-center gap-1 rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground">
                      <Check className="size-3" /><span>Revisar y Firmar</span>
                    </button>
                  ) : null}
                </div>
              ),
            },
          ]}
          data={notes}
          getRowId={(r) => r.id}
          emptyTitle="Sin notas SOAP aún"
        />
      ) : null}

      {tab === 'erx' ? (
        <div className="space-y-4">
          <form className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); rxMutation.mutate(); }}>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Medicamento</span><input placeholder="Amoxicilina" value={rxName} onChange={(e) => setRxName(e.target.value)} className={`${INPUT_CLS} w-full`} required /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Dosis</span><input placeholder="500mg" value={rxDose} onChange={(e) => setRxDose(e.target.value)} className={`${INPUT_CLS} w-full`} required /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Indicaciones (SIG)</span><input value={rxSig} onChange={(e) => setRxSig(e.target.value)} className={`${INPUT_CLS} w-full`} required /></label>
            <button type="submit" disabled={rxMutation.isPending} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Emitir eRx</button>
          </form>
          <DataTable
            columns={[
              { id: 'med', header: 'Medicamento', cell: (r) => <span className="font-medium">{r.medication_name}</span> },
              { id: 'dose', header: 'Dosis', cell: (r) => r.dosage },
              { id: 'sig', header: 'Indicaciones', cell: (r) => r.sig_instructions },
              { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> },
            ]}
            data={prescriptions}
            getRowId={(r) => r.id}
            emptyTitle="Sin recetas emitidas"
          />
        </div>
      ) : null}

      {tab === 'labs' || tab === 'rcm' ? (
        <ClinicalLabsRcmPanel
          rpc={rpc}
          mode={tab}
          activePatientId={activePatientId}
          labs={labs}
          rcmClaims={rcmClaims}
          onStatus={setStatusMsg}
          onError={setErrorMsg}
        />
      ) : null}

      <ClinicalAiScribeModal
        open={scribeOpen}
        onClose={() => setScribeOpen(false)}
        rpc={rpc}
        patients={patients}
        selectedPatientId={activePatientId}
        onCreated={(m) => setStatusMsg(m)}
      />
    </section>
  );
}
