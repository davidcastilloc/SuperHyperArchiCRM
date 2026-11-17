import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, FileText, FlaskConical, Pill, Plus, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { AiCopilotBanner, DataTable, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { ClinicalAiScribeModal } from './ClinicalAiScribeModal';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

type ClinicalTab = 'vitals' | 'soap' | 'erx' | 'labs' | 'rcm';

/** Full Clinical EHR Workspace (Doctors-EHR-New assimilation on med_* D1 tables). */
export function ClinicalEhrView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ClinicalTab>('vitals');
  const [scribeOpen, setScribeOpen] = useState(false);
  const [rxName, setRxName] = useState('');
  const [rxDose, setRxDose] = useState('500mg');
  const [rxSig, setRxSig] = useState('Cada 8h por 7 días');
  const [rcmTitle, setRcmTitle] = useState('Consulta Especializada');
  const [rcmCharge, setRcmCharge] = useState('85.00');
  const [rcmPaid, setRcmPaid] = useState('65.00');
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['clinical', 'overview'],
    queryFn: async () => {
      const res = await rpc.api.clinical.overview.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const rxMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.clinical.prescriptions.$post({
        json: { patientPartyId: 'pty_pat_1', medicationName: rxName.trim(), dosage: rxDose, sigInstructions: rxSig },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clinical', 'overview'] });
      setRxName('');
      setStatusMsg('Receta electrónica (eRx) transmitida.');
    },
  });

  const rcmMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.clinical['labs-and-rcm'].$post({
        json: {
          kind: 'rcm_claim',
          patientPartyId: 'pty_pat_1',
          titleOrModality: rcmTitle,
          totalChargeMinor: parseMajorToMinor(rcmCharge),
          insurerPaidMinor: parseMajorToMinor(rcmPaid),
          diagnosisCodes: ['R51.9'],
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clinical', 'overview'] });
      setStatusMsg('Reclamo RCM 837 auditado y registrado.');
    },
  });

  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await rpc.api.automation['ai-chat'].$post({ json: { prompt } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => setAiReply(d.reply),
  });

  const encounters = (overviewQuery.data?.encounters ?? []) as Array<{ id: string; patient_party_id: string; chief_complaint: string; vitals_json: string; status: string }>;
  const notes = (overviewQuery.data?.notes ?? []) as Array<{ id: string; patient_party_id: string; subjective: string; assessment: string; status: string }>;
  const prescriptions = (overviewQuery.data?.prescriptions ?? []) as Array<{ id: string; medication_name: string; dosage: string; sig_instructions: string; status: string }>;
  const labs = (overviewQuery.data?.labs ?? []) as Array<{ id: string; order_or_accession_no: string; modality_or_category: string; abnormal_flag: string; status: string }>;
  const rcmClaims = (overviewQuery.data?.rcmClaims ?? []) as Array<{ id: string; claim_or_check_number: string; total_charge_minor: number; insurer_paid_minor: number; patient_responsibility_minor: number; status: string }>;

  return (
    <section className="space-y-5" data-slot="clinical-ehr-view">
      <PageHeader
        title="Clínica EHR & AI Scribe"
        description="Sala de espera, signos vitales, notas SOAP con IA, recetas eRx, laboratorio y auditoría RCM."
        onRefresh={() => void overviewQuery.refetch()}
        refreshing={overviewQuery.isFetching}
        actions={
          <button type="button" onClick={() => setScribeOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
            <Plus className="size-3.5" /><span>Consulta + AI Scribe</span>
          </button>
        }
      />

      <AiCopilotBanner
        title="Asistente Médico AI Scribe"
        summary="Resume signos vitales críticos, sugiere CIE-10 y detecta glosas potenciales en reclamos RCM."
        prompts={['Resumir signos vitales de pacientes', 'Revisar alertas de glosas RCM']}
        onRunPrompt={(p) => aiMutation.mutate(p)}
        reply={aiReply}
        onClearReply={() => setAiReply(null)}
        loading={aiMutation.isPending}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard title="Consultas Activas" value={encounters.length} />
        <KpiCard title="Notas SOAP" value={notes.length} />
        <KpiCard title="Recetas eRx" value={prescriptions.length} />
        <KpiCard title="Reclamos RCM" value={rcmClaims.length} />
      </div>

      {statusMsg ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{statusMsg}</p> : null}

      <SegmentedTabs
        activeId={tab}
        onSelect={(id) => setTab(id as ClinicalTab)}
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
            { id: 'pat', header: 'Paciente', cell: (r) => <span className="font-mono text-xs">{r.patient_party_id}</span> },
            { id: 'cc', header: 'Motivo', cell: (r) => r.chief_complaint },
            { id: 'vit', header: 'Signos Vitales', cell: (r) => <span className="font-mono text-[11px] text-muted-foreground">{r.vitals_json}</span> },
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
            { id: 'pat', header: 'Paciente', cell: (r) => <span className="font-mono text-xs">{r.patient_party_id}</span> },
            { id: 'sub', header: 'Subjetivo', cell: (r) => <span className="line-clamp-2 text-xs">{r.subjective}</span> },
            { id: 'ass', header: 'Evaluación IA / CIE-10', cell: (r) => <span className="line-clamp-2 text-xs font-medium">{r.assessment}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> },
          ]}
          data={notes}
          getRowId={(r) => r.id}
          emptyTitle="Sin notas SOAP aún"
        />
      ) : null}

      {tab === 'erx' ? (
        <div className="space-y-4">
          <form className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); rxMutation.mutate(); }}>
            <input placeholder="Medicamento" value={rxName} onChange={(e) => setRxName(e.target.value)} className={INPUT_CLS} required />
            <input placeholder="Dosis" value={rxDose} onChange={(e) => setRxDose(e.target.value)} className={INPUT_CLS} required />
            <input placeholder="Indicaciones (SIG)" value={rxSig} onChange={(e) => setRxSig(e.target.value)} className={INPUT_CLS} required />
            <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Emitir eRx</button>
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

      {tab === 'labs' ? (
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
      ) : null}

      {tab === 'rcm' ? (
        <div className="space-y-4">
          <form className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); rcmMutation.mutate(); }}>
            <input placeholder="Procedimiento" value={rcmTitle} onChange={(e) => setRcmTitle(e.target.value)} className={INPUT_CLS} />
            <input placeholder="Cargo Total USD" value={rcmCharge} onChange={(e) => setRcmCharge(e.target.value)} className={`${INPUT_CLS} font-mono`} />
            <input placeholder="Cubierto Seguro USD" value={rcmPaid} onChange={(e) => setRcmPaid(e.target.value)} className={`${INPUT_CLS} font-mono`} />
            <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Auditar 837</button>
          </form>
          <DataTable
            columns={[
              { id: 'no', header: 'Reclamo', cell: (r) => <span className="font-mono text-xs">{r.claim_or_check_number}</span> },
              { id: 'tot', header: 'Total', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.total_charge_minor, 'USD')}</span> },
              { id: 'pat', header: 'Copago Paciente', cell: (r) => <span className="font-mono tabular-nums">{formatMinorUnits(r.patient_responsibility_minor, 'USD')}</span> },
              { id: 'st', header: 'Scrubber', cell: (r) => <StatusBadge label={r.status} tone={r.status === 'READY' ? 'success' : 'warning'} /> },
            ]}
            data={rcmClaims}
            getRowId={(r) => r.id}
            emptyTitle="Sin reclamos RCM"
          />
        </div>
      ) : null}

      <ClinicalAiScribeModal open={scribeOpen} onClose={() => setScribeOpen(false)} rpc={rpc} onCreated={(m) => setStatusMsg(m)} />
    </section>
  );
}
