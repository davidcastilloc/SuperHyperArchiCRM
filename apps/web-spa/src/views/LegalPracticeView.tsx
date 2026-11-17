import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Clock, FileSearch, Gavel, Landmark, Pause, Play, Plus, RotateCcw, Scale, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AiCopilotBanner, DataTable, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { useAuthSession } from '../lib/authSession';
import { useMarketProfile } from '../lib/marketProfile';
import { LegalAiContractModal } from './LegalAiContractModal';
import { LegalEdiscoveryAndEthicsPanel } from './LegalEdiscoveryAndEthicsPanel';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

type LegalTab = 'matters' | 'time' | 'iolta' | 'dockets' | 'ediscovery' | 'briefs' | 'ethics';

function bumpMatterRef(ref: string): string {
  const m = /^(.*?)(\d+)$/.exec(ref.trim());
  if (!m) return `${ref}-2`;
  const nextNum = String(Number(m[2]) + 1).padStart(m[2]!.length, '0');
  return `${m[1]}${nextNum}`;
}

/** Legal Practice Suite: Active Matter Bar, Dockets form, Persistent Stopwatch, IOLTA Trust & AI Review. */
export function LegalPracticeView({ rpc, vocabulary }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const profile = useMarketProfile();
  const session = useAuthSession();
  const timerKey = `shac.legal.timer.${profile.tenantId}.${session?.actor.orgId ?? 'org_1'}`;

  const [tab, setTab] = useState<LegalTab>('matters');
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(timerKey) : null;
      return raw ? Math.max(0, Number.parseInt(raw, 10) || 0) : 0;
    } catch { return 0; }
  });
  const [hourlyRateMajor, setHourlyRateMajor] = useState('150.00');
  const [activeMatterRef, setActiveMatterRef] = useState('');
  const [clientPartyId, setClientPartyId] = useState('');
  const [matterRef, setMatterRef] = useState('EXP-2026-01');
  const [matterTitle, setMatterTitle] = useState('');
  const [practiceArea, setPracticeArea] = useState('Corporativo');
  const [docketCourt, setDocketCourt] = useState('Juzgado Superior Mercantil');
  const [docketNo, setDocketNo] = useState('');
  const [docketSummary, setDocketSummary] = useState('');
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    try { window.localStorage.setItem(timerKey, String(elapsedSec)); } catch { /* ignore */ }
  }, [timerKey, elapsedSec]);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'legal-clients'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '100' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const overviewQuery = useQuery({
    queryKey: ['legal', 'overview'],
    queryFn: async () => {
      const res = await rpc.api.legal.overview.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const clients = partiesQuery.data?.items ?? [];
  const matters = (overviewQuery.data?.matters ?? []) as Array<{ id: string; reference_number: string; client_party_id: string; practice_area: string; title: string; status: string }>;
  const currentMatterRef = activeMatterRef || matters[0]?.reference_number || matterRef;

  const matterMutation = useMutation({
    mutationFn: async () => {
      const targetClient = clientPartyId || clients[0]?.id || '';
      if (!targetClient) throw new Error(`Registra primero un ${vocabulary.partySingular.toLowerCase()} en Directorio.`);
      const res = await rpc.api.legal.matters.$post({
        json: { referenceNumber: matterRef.trim(), clientPartyId: targetClient, practiceArea, title: matterTitle.trim() },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['legal', 'overview'] });
      setActiveMatterRef(d.referenceNumber);
      setMatterRef((prev) => bumpMatterRef(prev));
      setMatterTitle('');
      setStatusMsg(`Expediente ${d.referenceNumber} abierto.`);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const docketMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.legal.dockets.$post({
        json: {
          matterId: currentMatterRef,
          courtName: docketCourt.trim(),
          docketNumber: docketNo.trim(),
          summary: docketSummary.trim(),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      setDocketNo('');
      setDocketSummary('');
      void queryClient.invalidateQueries({ queryKey: ['legal', 'overview'] });
      setStatusMsg('Docket judicial registrado.');
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const logTimeMutation = useMutation({
    mutationFn: async () => {
      const mins = Math.max(15, Math.ceil(elapsedSec / 60));
      const res = await rpc.api.legal['time-entries'].$post({
        json: {
          matterId: currentMatterRef,
          durationMinutes: mins,
          hourlyRateMinor: parseMajorToMinor(hourlyRateMajor),
          description: `Sesión cronometrada (${mins} min)`,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      setTimerRunning(false);
      setElapsedSec(0);
      void queryClient.invalidateQueries({ queryKey: ['legal', 'overview'] });
      setStatusMsg(`Horas registradas en ${currentMatterRef}: ${formatMinorUnits(d.amountMinor, 'USD')}`);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await rpc.api.automation['ai-chat'].$post({ json: { prompt } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => { setErrorMsg(null); setAiReply(d.reply); },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const dockets = ((overviewQuery.data?.dockets ?? []) as Array<{ id: string; matter_id: string; case_number: string; case_title: string; court_name: string; filing_status: string }>)
    .filter((d) => !activeMatterRef || d.matter_id === activeMatterRef);
  const timeEntries = ((overviewQuery.data?.timeEntries ?? []) as Array<{ id: string; matter_id: string; duration_minutes: number; amount_minor: number; description: string }>)
    .filter((t) => !activeMatterRef || t.matter_id === activeMatterRef);
  const trustLedgers = (overviewQuery.data?.trustLedgers ?? []) as Array<{ id: string; matter_or_lease_id: string; currency: string; balance_minor: number; status: string }>;

  const hh = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');

  return (
    <section className="space-y-4" data-slot="legal-practice-view">
      <PageHeader
        title="Suite Legal, Dockets & Fideicomiso IOLTA"
        description="Expedientes, cronómetro facturable persistente, cuentas Escrow/IOLTA y auditoría IA."
        onRefresh={() => void overviewQuery.refetch()}
        refreshing={overviewQuery.isFetching}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2 font-mono text-xs tabular-nums">
              <Clock className="size-3.5 text-primary" /><span>{hh}:{mm}:{ss}</span>
              <input value={hourlyRateMajor} onChange={(e) => setHourlyRateMajor(e.target.value)} aria-label="Tarifa USD/h" className="w-14 border-l border-border bg-transparent pl-1.5 text-[11px]" title="Tarifa USD/hora" />
              <button type="button" onClick={() => setTimerRunning((v) => !v)} aria-label="Iniciar o pausar cronómetro" className="rounded p-0.5 hover:bg-muted">
                {timerRunning ? <Pause className="size-3.5 text-amber-500" /> : <Play className="size-3.5 text-emerald-600" />}
              </button>
              <button type="button" onClick={() => { setTimerRunning(false); setElapsedSec(0); }} aria-label="Reiniciar cronómetro" className="rounded p-0.5 text-muted-foreground hover:bg-muted">
                <RotateCcw className="size-3" />
              </button>
              <button type="button" onClick={() => logTimeMutation.mutate()} disabled={logTimeMutation.isPending} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Guardar</button>
            </div>
            <button type="button" onClick={() => setAiModalOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
              <Scale className="size-3.5" /><span>Revisar Contrato IA</span>
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
        <label className="min-w-64 flex-1 space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Expediente Activo</span>
          <select value={activeMatterRef} onChange={(e) => setActiveMatterRef(e.target.value)} className={`${INPUT_CLS} w-full`}>
            <option value="">Todos los expedientes</option>
            {matters.map((m) => <option key={m.id} value={m.reference_number}>{m.reference_number} · {m.title}</option>)}
          </select>
        </label>
      </div>

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

      {errorMsg ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}
      {statusMsg ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{statusMsg}</p> : null}

      <SegmentedTabs
        activeId={tab}
        onSelect={(id) => setTab(id as LegalTab)}
        tabs={[
          { id: 'matters', label: 'Expedientes', count: matters.length, icon: <Briefcase className="size-3.5" /> },
          { id: 'time', label: 'Horas Facturables', count: timeEntries.length, icon: <Clock className="size-3.5" /> },
          { id: 'iolta', label: 'Trust IOLTA', count: trustLedgers.length, icon: <Landmark className="size-3.5" /> },
          { id: 'dockets', label: 'Dockets', count: dockets.length, icon: <Gavel className="size-3.5" /> },
          { id: 'ediscovery', label: 'e-Discovery', icon: <FileSearch className="size-3.5" /> },
          { id: 'briefs', label: 'Escritos IA', icon: <Sparkles className="size-3.5" /> },
          { id: 'ethics', label: 'Ética & CLE', icon: <ShieldCheck className="size-3.5" /> },
        ]}
      />

      {tab === 'matters' ? (
        <div className="space-y-4">
          <form className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); matterMutation.mutate(); }}>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">{vocabulary.partySingular}</span>
              <select value={clientPartyId || clients[0]?.id || ''} onChange={(e) => setClientPartyId(e.target.value)} className={`${INPUT_CLS} w-full`}>
                {clients.length === 0 ? <option value="">Sin {vocabulary.partyPlural.toLowerCase()}</option> : null}
                {clients.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Referencia</span><input value={matterRef} onChange={(e) => setMatterRef(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} required /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Título del caso</span><input value={matterTitle} onChange={(e) => setMatterTitle(e.target.value)} className={`${INPUT_CLS} w-full`} required /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Área</span><input value={practiceArea} onChange={(e) => setPracticeArea(e.target.value)} className={`${INPUT_CLS} w-full`} required /></label>
            <button type="submit" disabled={matterMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Abrir Expediente</span></button>
          </form>
          <DataTable columns={[{ id: 'ref', header: 'Referencia', cell: (r) => <span className="font-mono text-xs">{r.reference_number}</span> }, { id: 'tit', header: 'Título', cell: (r) => <span className="font-medium">{r.title}</span> }, { id: 'area', header: 'Área', cell: (r) => r.practice_area }, { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="info" /> }]} data={matters} getRowId={(r) => r.id} emptyTitle="Sin expedientes abiertos" />
        </div>
      ) : null}

      {tab === 'time' ? (
        <DataTable columns={[{ id: 'mat', header: 'Expediente', cell: (r) => <span className="font-mono text-xs">{r.matter_id}</span> }, { id: 'desc', header: 'Actividad', cell: (r) => r.description }, { id: 'min', header: 'Minutos', cell: (r) => <span className="font-mono tabular-nums">{r.duration_minutes}m</span> }, { id: 'amt', header: 'Facturable', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.amount_minor, 'USD')}</span> }]} data={timeEntries} getRowId={(r) => r.id} emptyTitle="Sin horas facturables" />
      ) : null}

      {tab === 'iolta' ? (
        <DataTable columns={[{ id: 'ref', header: 'Caso / Contrato', cell: (r) => <span className="font-mono text-xs">{r.matter_or_lease_id}</span> }, { id: 'bal', header: 'Saldo Protegido', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.balance_minor, r.currency)}</span> }, { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" /> }]} data={trustLedgers} getRowId={(r) => r.id} emptyTitle="Sin cuentas IOLTA" />
      ) : null}

      {tab === 'dockets' ? (
        <div className="space-y-4">
          <form className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); docketMutation.mutate(); }}>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Tribunal</span><input value={docketCourt} onChange={(e) => setDocketCourt(e.target.value)} className={`${INPUT_CLS} w-full`} required /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">N° Causa / Docket</span><input placeholder="DKT-2026-01" value={docketNo} onChange={(e) => setDocketNo(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} required /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Actuación / Carátula</span><input placeholder="Audiencia preliminar" value={docketSummary} onChange={(e) => setDocketSummary(e.target.value)} className={`${INPUT_CLS} w-full`} required /></label>
            <button type="submit" disabled={docketMutation.isPending} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Registrar Docket</button>
          </form>
          <DataTable columns={[{ id: 'no', header: 'N° Causa', cell: (r) => <span className="font-mono text-xs">{r.case_number}</span> }, { id: 'tit', header: 'Carátula', cell: (r) => r.case_title }, { id: 'crt', header: 'Tribunal', cell: (r) => r.court_name }, { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.filing_status} tone="info" /> }]} data={dockets} getRowId={(r) => r.id} emptyTitle="Sin dockets judiciales" />
        </div>
      ) : null}

      {tab === 'ediscovery' || tab === 'briefs' || tab === 'ethics' ? (
        <LegalEdiscoveryAndEthicsPanel rpc={rpc} tab={tab} activeMatterId={currentMatterRef} onStatus={setStatusMsg} onError={setErrorMsg} />
      ) : null}

      <LegalAiContractModal open={aiModalOpen} onClose={() => setAiModalOpen(false)} rpc={rpc} />
    </section>
  );
}
