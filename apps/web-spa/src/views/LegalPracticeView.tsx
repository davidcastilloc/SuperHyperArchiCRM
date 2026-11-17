import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Clock, Gavel, Landmark, Pause, Play, Plus, Scale } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AiCopilotBanner, DataTable, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { LegalAiContractModal } from './LegalAiContractModal';
import { formatMinorUnits, INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

type LegalTab = 'matters' | 'time' | 'iolta' | 'dockets';

/** Legal Practice Suite: Matters, Court Dockets, Live Billable Stopwatch, IOLTA Trust & AI Contract Review. */
export function LegalPracticeView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<LegalTab>('matters');
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [matterRef, setMatterRef] = useState('EXP-2026-01');
  const [matterTitle, setMatterTitle] = useState('');
  const [practiceArea, setPracticeArea] = useState('Corporativo');
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  const overviewQuery = useQuery({
    queryKey: ['legal', 'overview'],
    queryFn: async () => {
      const res = await rpc.api.legal.overview.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const matterMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.legal.matters.$post({
        json: { referenceNumber: matterRef.trim(), clientPartyId: 'pty_cli_1', practiceArea, title: matterTitle.trim() },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['legal', 'overview'] });
      setMatterTitle('');
      setStatusMsg('Expediente legal abierto.');
    },
  });

  const logTimeMutation = useMutation({
    mutationFn: async () => {
      const mins = Math.max(15, Math.ceil(elapsedSec / 60));
      const res = await rpc.api.legal['time-entries'].$post({
        json: { matterId: matterRef, durationMinutes: mins, hourlyRateMinor: 15000, description: `Sesión cronometrada (${mins} min)` },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      setTimerRunning(false);
      setElapsedSec(0);
      void queryClient.invalidateQueries({ queryKey: ['legal', 'overview'] });
      setStatusMsg(`Horas registradas: ${formatMinorUnits(d.amountMinor, 'USD')}`);
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

  const matters = (overviewQuery.data?.matters ?? []) as Array<{ id: string; reference_number: string; practice_area: string; title: string; status: string }>;
  const dockets = (overviewQuery.data?.dockets ?? []) as Array<{ id: string; case_number: string; case_title: string; court_name: string; filing_status: string }>;
  const timeEntries = (overviewQuery.data?.timeEntries ?? []) as Array<{ id: string; matter_id: string; duration_minutes: number; amount_minor: number; description: string }>;
  const trustLedgers = (overviewQuery.data?.trustLedgers ?? []) as Array<{ id: string; matter_or_lease_id: string; currency: string; balance_minor: number; status: string }>;

  const hh = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');

  return (
    <section className="space-y-5" data-slot="legal-practice-view">
      <PageHeader
        title="Suite Legal, Dockets & Fideicomiso IOLTA"
        description="Expedientes, cronómetro facturable en vivo, cuentas Escrow/IOLTA y auditoría de contratos IA."
        onRefresh={() => void overviewQuery.refetch()}
        refreshing={overviewQuery.isFetching}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 font-mono text-xs tabular-nums">
              <Clock className="size-3.5 text-primary" />
              <span>{hh}:{mm}:{ss}</span>
              <button type="button" onClick={() => setTimerRunning((v) => !v)} aria-label="Iniciar o pausar cronómetro" className="rounded p-0.5 hover:bg-muted">
                {timerRunning ? <Pause className="size-3.5 text-amber-500" /> : <Play className="size-3.5 text-emerald-600" />}
              </button>
              <button type="button" onClick={() => logTimeMutation.mutate()} disabled={logTimeMutation.isPending} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                Guardar
              </button>
            </div>
            <button type="button" onClick={() => setAiModalOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
              <Scale className="size-3.5" /><span>Revisar Contrato IA</span>
            </button>
          </div>
        }
      />

      <AiCopilotBanner
        title="Copiloto Jurídico IA"
        summary="Analiza cláusulas de riesgo, detecta conflictos de interés y resume plazos procesales."
        prompts={['Resumir horas facturables aprobadas', 'Auditar saldos IOLTA activos']}
        onRunPrompt={(p) => aiMutation.mutate(p)}
        reply={aiReply}
        onClearReply={() => setAiReply(null)}
        loading={aiMutation.isPending}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard title="Expedientes" value={matters.length} />
        <KpiCard title="Dockets Judiciales" value={dockets.length} />
        <KpiCard title="Registros de Tiempo" value={timeEntries.length} />
        <KpiCard title="Cuentas IOLTA" value={trustLedgers.length} />
      </div>

      {statusMsg ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{statusMsg}</p> : null}

      <SegmentedTabs
        activeId={tab}
        onSelect={(id) => setTab(id as LegalTab)}
        tabs={[
          { id: 'matters', label: 'Expedientes', count: matters.length, icon: <Briefcase className="size-3.5" /> },
          { id: 'time', label: 'Horas Facturables', count: timeEntries.length, icon: <Clock className="size-3.5" /> },
          { id: 'iolta', label: 'Trust IOLTA', count: trustLedgers.length, icon: <Landmark className="size-3.5" /> },
          { id: 'dockets', label: 'Dockets', count: dockets.length, icon: <Gavel className="size-3.5" /> },
        ]}
      />

      {tab === 'matters' ? (
        <div className="space-y-4">
          <form className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); matterMutation.mutate(); }}>
            <input placeholder="Ref (EXP-2026-01)" value={matterRef} onChange={(e) => setMatterRef(e.target.value)} className={`${INPUT_CLS} font-mono`} required />
            <input placeholder="Título del caso" value={matterTitle} onChange={(e) => setMatterTitle(e.target.value)} className={INPUT_CLS} required />
            <input placeholder="Área (Corporativo)" value={practiceArea} onChange={(e) => setPracticeArea(e.target.value)} className={INPUT_CLS} required />
            <button type="submit" className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
              <Plus className="size-3.5" /><span>Abrir Expediente</span>
            </button>
          </form>
          <DataTable
            columns={[
              { id: 'ref', header: 'Referencia', cell: (r) => <span className="font-mono text-xs">{r.reference_number}</span> },
              { id: 'tit', header: 'Título', cell: (r) => <span className="font-medium">{r.title}</span> },
              { id: 'area', header: 'Área', cell: (r) => r.practice_area },
              { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="info" /> },
            ]}
            data={matters}
            getRowId={(r) => r.id}
            emptyTitle="Sin expedientes abiertos"
          />
        </div>
      ) : null}

      {tab === 'time' ? (
        <DataTable
          columns={[
            { id: 'mat', header: 'Expediente', cell: (r) => <span className="font-mono text-xs">{r.matter_id}</span> },
            { id: 'desc', header: 'Actividad', cell: (r) => r.description },
            { id: 'min', header: 'Minutos', cell: (r) => <span className="font-mono tabular-nums">{r.duration_minutes}m</span> },
            { id: 'amt', header: 'Facturable', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.amount_minor, 'USD')}</span> },
          ]}
          data={timeEntries}
          getRowId={(r) => r.id}
          emptyTitle="Sin horas facturables"
        />
      ) : null}

      {tab === 'iolta' ? (
        <DataTable
          columns={[
            { id: 'ref', header: 'Caso / Contrato', cell: (r) => <span className="font-mono text-xs">{r.matter_or_lease_id}</span> },
            { id: 'bal', header: 'Saldo Protegido', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.balance_minor, r.currency)}</span> },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> },
          ]}
          data={trustLedgers}
          getRowId={(r) => r.id}
          emptyTitle="Sin cuentas IOLTA"
        />
      ) : null}

      {tab === 'dockets' ? (
        <DataTable
          columns={[
            { id: 'no', header: 'N° Causa', cell: (r) => <span className="font-mono text-xs">{r.case_number}</span> },
            { id: 'tit', header: 'Carátula', cell: (r) => r.case_title },
            { id: 'crt', header: 'Tribunal', cell: (r) => r.court_name },
            { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.filing_status} tone="info" /> },
          ]}
          data={dockets}
          getRowId={(r) => r.id}
          emptyTitle="Sin dockets judiciales"
        />
      ) : null}

      <LegalAiContractModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} rpc={rpc} />
    </section>
  );
}
