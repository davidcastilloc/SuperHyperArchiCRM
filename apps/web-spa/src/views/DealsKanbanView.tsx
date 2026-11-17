import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Columns3, MapPin, Plus, Table2, Trophy, XCircle } from 'lucide-react';
import { DataTable, downloadCsvFile, KpiCard, PageHeader, SavedViewsBar, StatusBadge, type DataTableColumn } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

const KANBAN_STAGES = [
  { id: 'stage_qualified', label: 'Calificación', probBps: 2500 },
  { id: 'stage_proposal', label: 'Propuesta', probBps: 5000 },
  { id: 'stage_negotiation', label: 'Negociación', probBps: 7500 },
  { id: 'stage_commit', label: 'Cierre', probBps: 9000 },
] as const;

export function getAdjacentDealStages(currentStage: string): { prev: string | null; next: string | null } {
  const idx = KANBAN_STAGES.findIndex((s) => s.id === currentStage);
  if (idx < 0) return { prev: null, next: KANBAN_STAGES[1]?.id ?? null };
  return {
    prev: idx > 0 ? KANBAN_STAGES[idx - 1]!.id : null,
    next: idx < KANBAN_STAGES.length - 1 ? KANBAN_STAGES[idx + 1]!.id : null,
  };
}

/** Open Mercato DS v3 CRM Deals Pipeline Kanban Board + Bidirectional Stages + Creation. */
export function DealsKanbanView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'kanban' | 'table' | 'map'>('kanban');
  const [viewFilter, setViewFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [partyId, setPartyId] = useState('');
  const [dealTitle, setDealTitle] = useState('');
  const [dealValueMajor, setDealValueMajor] = useState('500.00');
  const [dealStage, setDealStage] = useState<string>('stage_qualified');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'deals-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) return { items: [] as Array<{ id: string; displayName: string }> };
      return res.json();
    },
    enabled: showCreate,
  });

  const dealsQuery = useQuery({
    queryKey: ['customers', 'deals', 'kanban-board'],
    queryFn: async () => {
      const res = await rpc.api.customers.deals.$get({ query: { limit: '100' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const createDealMutation = useMutation({
    mutationFn: async () => {
      const targetParty = partyId || partiesQuery.data?.items[0]?.id || '';
      if (!targetParty) throw new Error(`Selecciona un ${vocabulary.partySingular.toLowerCase()} primero.`);
      const res = await rpc.api.customers.deals.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          partyId: targetParty,
          pipelineId: 'pipe_default',
          title: dealTitle.trim(),
          valueMinor: Math.max(100, parseMajorToMinor(dealValueMajor)),
          currency: 'USD',
          stageId: dealStage,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      setDealTitle('');
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['customers', 'deals'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'deals'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const stageMutation = useMutation({
    mutationFn: async (params: { dealId: string; stageId: string; probabilityBps: number; outcome: 'open' | 'won' | 'lost' }) => {
      const res = await rpc.api.customers.deals.stage.$post({ json: { clientMutationId: crypto.randomUUID(), ...params } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['customers', 'deals'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'deals'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const allDeals = dealsQuery.data?.items ?? [];
  const summary = dealsQuery.data?.summary;
  const deals = viewFilter === 'all' ? allDeals : allDeals.filter((d) => d.outcome === viewFilter);

  function moveStage(dealId: string, targetStageId: string) {
    const st = KANBAN_STAGES.find((s) => s.id === targetStageId) ?? KANBAN_STAGES[0];
    stageMutation.mutate({ dealId, stageId: st.id, probabilityBps: st.probBps, outcome: 'open' });
  }

  type DealItem = (typeof deals)[number];
  const tableCols: DataTableColumn<DealItem>[] = [
    { id: 'title', header: 'Oportunidad', sortValue: (d) => d.title, cell: (d) => <span className="font-medium">{d.title}</span> },
    { id: 'party', header: vocabulary.partySingular, cell: (d) => <span className="text-xs">{d.partyName ?? d.partyId}</span> },
    { id: 'stage', header: 'Etapa', cell: (d) => <span className="font-mono text-xs">{d.stageId.replace('stage_', '')}</span> },
    { id: 'outcome', header: 'Estado', cell: (d) => <StatusBadge label={d.outcome} tone={d.outcome === 'won' ? 'success' : d.outcome === 'lost' ? 'error' : 'info'} appearance="dot" /> },
    { id: 'val', header: 'Valor', align: 'right', sortValue: (d) => d.valueMinor, cell: (d) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(d.valueMinor, d.currency)}</span> },
  ];

  const byOrg = new Map<string, { count: number; totalMinor: number }>();
  for (const d of deals) {
    const prev = byOrg.get(d.orgId) ?? { count: 0, totalMinor: 0 };
    byOrg.set(d.orgId, { count: prev.count + 1, totalMinor: prev.totalMinor + d.valueMinor });
  }
  const regionRows = Array.from(byOrg.entries()).map(([orgId, v]) => ({ id: orgId, orgId, ...v }));

  return (
    <section className="space-y-5" data-slot="deals-kanban-view">
      <PageHeader
        title="Oportunidades (Deals Pipeline)"
        description="Tablero Kanban bidireccional con ponderación automática y cierre ganado/perdido."
        onRefresh={() => void dealsQuery.refetch()}
        refreshing={dealsQuery.isFetching}
        actions={
          <>
            <SavedViewsBar
              views={[{ id: 'all', label: 'Todos' }, { id: 'open', label: 'Abiertos' }, { id: 'won', label: 'Ganados' }, { id: 'lost', label: 'Perdidos' }]}
              activeViewId={viewFilter}
              onSelectView={setViewFilter}
              onExport={() => downloadCsvFile('crm-deals.csv', ['Title', 'Party', 'Stage', 'Outcome', 'ValueMinor', 'Currency'], deals.map((d) => [d.title, d.partyName ?? d.partyId, d.stageId, d.outcome, d.valueMinor, d.currency]))}
            />
            <button type="button" onClick={() => setShowCreate((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
              <Plus className="size-3.5" /><span>Nueva Oportunidad</span>
            </button>
            <div className="inline-flex rounded-md border border-border bg-background p-0.5 shadow-xs">
              <button type="button" onClick={() => setMode('kanban')} className={`inline-flex h-8 items-center gap-1 rounded px-2 text-xs font-medium ${mode === 'kanban' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}><Columns3 className="size-3.5" /><span>Kanban</span></button>
              <button type="button" onClick={() => setMode('table')} className={`inline-flex h-8 items-center gap-1 rounded px-2 text-xs font-medium ${mode === 'table' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}><Table2 className="size-3.5" /><span>Tabla</span></button>
              <button type="button" onClick={() => setMode('map')} className={`inline-flex h-8 items-center gap-1 rounded px-2 text-xs font-medium ${mode === 'map' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}><MapPin className="size-3.5" /><span>Mapa</span></button>
            </div>
          </>
        }
      />

      {errorMsg ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}

      {showCreate ? (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); createDealMutation.mutate(); }} className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-5">
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">{vocabulary.partySingular}</span>
            <select value={partyId || partiesQuery.data?.items[0]?.id || ''} onChange={(e) => setPartyId(e.target.value)} className={`${INPUT_CLS} w-full`}>
              {(partiesQuery.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs md:col-span-2"><span className="font-medium text-muted-foreground">Título Oportunidad</span><input value={dealTitle} onChange={(e) => setDealTitle(e.target.value)} placeholder="Ej. Contrato Anual Flota" className={`${INPUT_CLS} w-full`} required /></label>
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Valor (USD) / Etapa</span>
            <div className="flex gap-1"><input value={dealValueMajor} onChange={(e) => setDealValueMajor(e.target.value)} className={`${INPUT_CLS} w-1/2 font-mono tabular-nums`} /><select value={dealStage} onChange={(e) => setDealStage(e.target.value)} className={`${INPUT_CLS} w-1/2`}>{KANBAN_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
          </label>
          <button type="submit" disabled={createDealMutation.isPending} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Guardar Deal</button>
        </form>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total Oportunidades" value={summary?.totalCount ?? allDeals.length} loading={dealsQuery.isLoading} />
        <KpiCard title="Pipeline Abierto" value={formatMinorUnits(summary?.openValueMinor ?? 0, 'USD')} loading={dealsQuery.isLoading} />
        <KpiCard title="Pipeline Ponderado" value={formatMinorUnits(summary?.weightedValueMinor ?? 0, 'USD')} loading={dealsQuery.isLoading} />
        <KpiCard title="Cerrado Ganado" value={formatMinorUnits(summary?.wonValueMinor ?? 0, 'USD')} loading={dealsQuery.isLoading} />
      </div>

      {mode === 'map' ? (
        <DataTable
          columns={[
            { id: 'org', header: vocabulary.branchSingular, cell: (r) => <span className="font-mono text-xs font-medium">{r.orgId}</span> },
            { id: 'cnt', header: 'Oportunidades', align: 'right', cell: (r) => <span className="font-mono tabular-nums">{r.count}</span> },
            { id: 'tot', header: 'Valor Pipeline', align: 'right', cell: (r) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(r.totalMinor, 'USD')}</span> },
          ]}
          data={regionRows}
          getRowId={(r) => r.id}
          emptyTitle="Sin oportunidades por sucursal"
        />
      ) : mode === 'table' ? (
        <DataTable columns={tableCols} data={deals} getRowId={(d) => d.id} loading={dealsQuery.isLoading} emptyTitle="Sin oportunidades en esta vista" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {KANBAN_STAGES.map((stage) => {
            const stageDeals = deals.filter((d) => d.stageId === stage.id);
            const colTotal = stageDeals.reduce((acc, d) => acc + d.valueMinor, 0);
            return (
              <div key={stage.id} className="flex flex-col rounded-xl border border-border bg-muted/25">
                <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
                  <div className="flex items-center gap-2"><h2 className="text-xs font-semibold uppercase tracking-wider">{stage.label}</h2><span className="rounded-full bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">{stageDeals.length}</span></div>
                  <span className="font-mono text-xs font-medium text-muted-foreground tabular-nums">{formatMinorUnits(colTotal, 'USD')}</span>
                </div>
                <div className="flex-1 space-y-2.5 p-3">
                  {stageDeals.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">Sin deals en {stage.label.toLowerCase()}</p> : stageDeals.map((deal) => {
                    const adj = getAdjacentDealStages(deal.stageId);
                    return (
                      <div key={deal.id} className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-xs">
                        <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium leading-snug">{deal.title}</p><StatusBadge label={deal.outcome} tone={deal.outcome === 'won' ? 'success' : deal.outcome === 'lost' ? 'error' : 'info'} appearance="dot" /></div>
                        <p className="text-xs text-muted-foreground">{deal.partyName ?? deal.partyId}</p>
                        <div className="flex items-center justify-between border-t border-border/70 pt-2">
                          <span className="font-mono text-xs font-semibold tabular-nums">{formatMinorUnits(deal.valueMinor, deal.currency)}</span>
                          <div className="inline-flex items-center gap-1">
                            {adj.prev && deal.outcome === 'open' ? (
                              <button type="button" aria-label="Retroceder etapa" onClick={() => moveStage(deal.id, adj.prev!)} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded border border-border hover:bg-muted"><ArrowLeft className="size-3.5" /></button>
                            ) : null}
                            {adj.next && deal.outcome === 'open' ? (
                              <button type="button" aria-label="Avanzar etapa" onClick={() => moveStage(deal.id, adj.next!)} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded border border-border hover:bg-muted"><ArrowRight className="size-3.5" /></button>
                            ) : null}
                            {deal.outcome !== 'won' ? (
                              <button type="button" aria-label="Marcar ganada" onClick={() => stageMutation.mutate({ dealId: deal.id, stageId: 'stage_commit', probabilityBps: 10_000, outcome: 'won' })} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded border border-border text-status-success-icon hover:bg-muted"><Trophy className="size-3.5" /></button>
                            ) : null}
                            {deal.outcome !== 'lost' ? (
                              <button type="button" aria-label="Marcar perdida" onClick={() => stageMutation.mutate({ dealId: deal.id, stageId: deal.stageId, probabilityBps: 0, outcome: 'lost' })} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted"><XCircle className="size-3.5" /></button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
