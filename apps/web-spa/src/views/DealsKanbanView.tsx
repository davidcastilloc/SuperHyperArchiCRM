import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Columns3, Table2, Trophy, XCircle } from 'lucide-react';
import {
  DataTable,
  downloadCsvFile,
  KpiCard,
  PageHeader,
  SavedViewsBar,
  StatusBadge,
  type DataTableColumn,
} from '@shac/ui';
import { formatMinorUnits, readApiError, type Phase2ViewProps } from './phase2-format';

const KANBAN_STAGES = [
  { id: 'stage_qualified', label: 'Calificación', probBps: 2500 },
  { id: 'stage_proposal', label: 'Propuesta', probBps: 5000 },
  { id: 'stage_negotiation', label: 'Negociación', probBps: 7500 },
  { id: 'stage_commit', label: 'Cierre', probBps: 9000 },
] as const;

/** Open Mercato DS v3 CRM Deals Pipeline Kanban Board + Table view. */
export function DealsKanbanView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'kanban' | 'table'>('kanban');
  const [viewFilter, setViewFilter] = useState('all');

  const dealsQuery = useQuery({
    queryKey: ['customers', 'deals', 'kanban-board'],
    queryFn: async () => {
      const res = await rpc.api.customers.deals.$get({ query: { limit: '100' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const stageMutation = useMutation({
    mutationFn: async (params: {
      dealId: string;
      stageId: string;
      probabilityBps: number;
      outcome: 'open' | 'won' | 'lost';
    }) => {
      const res = await rpc.api.customers.deals.stage.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          ...params,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers', 'deals'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'deals'] });
    },
  });

  const allDeals = dealsQuery.data?.items ?? [];
  const summary = dealsQuery.data?.summary;
  const deals =
    viewFilter === 'all' ? allDeals : allDeals.filter((d) => d.outcome === viewFilter);

  type DealItem = (typeof deals)[number];
  const tableCols: DataTableColumn<DealItem>[] = [
    { id: 'title', header: 'Oportunidad', sortValue: (d) => d.title, cell: (d) => <span className="font-medium">{d.title}</span> },
    { id: 'party', header: vocabulary.partySingular, cell: (d) => <span className="text-xs">{d.partyName ?? d.partyId}</span> },
    { id: 'stage', header: 'Etapa', cell: (d) => <span className="font-mono text-xs">{d.stageId.replace('stage_', '')}</span> },
    {
      id: 'outcome',
      header: 'Estado',
      cell: (d) => (
        <StatusBadge
          label={d.outcome}
          tone={d.outcome === 'won' ? 'success' : d.outcome === 'lost' ? 'error' : 'info'}
          appearance="dot"
        />
      ),
    },
    { id: 'val', header: 'Valor', align: 'right', sortValue: (d) => d.valueMinor, cell: (d) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(d.valueMinor, d.currency)}</span> },
  ];

  function advanceDeal(deal: DealItem) {
    const idx = KANBAN_STAGES.findIndex((s) => s.id === deal.stageId);
    const next = KANBAN_STAGES[Math.min(KANBAN_STAGES.length - 1, Math.max(0, idx + 1))] ?? KANBAN_STAGES[0];
    stageMutation.mutate({
      dealId: deal.id,
      stageId: next.id,
      probabilityBps: next.probBps,
      outcome: 'open',
    });
  }

  return (
    <section className="space-y-5" data-slot="deals-kanban-view">
      <PageHeader
        title="Oportunidades (Deals Pipeline)"
        description="Tablero Kanban multi-etapa con ponderación automática y cierre ganado/perdido."
        onRefresh={() => void dealsQuery.refetch()}
        refreshing={dealsQuery.isFetching}
        actions={
          <>
            <SavedViewsBar
              views={[
                { id: 'all', label: 'Todos los deals' },
                { id: 'open', label: 'Abiertos' },
                { id: 'won', label: 'Ganados' },
                { id: 'lost', label: 'Perdidos' },
              ]}
              activeViewId={viewFilter}
              onSelectView={setViewFilter}
              onExport={() =>
                downloadCsvFile(
                  'crm-deals.csv',
                  ['Title', 'Party', 'Stage', 'Outcome', 'ValueMinor', 'Currency'],
                  deals.map((d) => [d.title, d.partyName ?? d.partyId, d.stageId, d.outcome, d.valueMinor, d.currency]),
                )
              }
            />
            <div className="inline-flex rounded-md border border-border bg-background p-0.5 shadow-xs">
              <button
                type="button"
                onClick={() => setMode('kanban')}
                className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                  mode === 'kanban' ? 'bg-muted text-foreground' : 'text-muted-foreground'
                }`}
              >
                <Columns3 className="size-3.5" />
                <span>Kanban</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('table')}
                className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                  mode === 'table' ? 'bg-muted text-foreground' : 'text-muted-foreground'
                }`}
              >
                <Table2 className="size-3.5" />
                <span>Tabla</span>
              </button>
            </div>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total Oportunidades" value={summary?.totalCount ?? allDeals.length} loading={dealsQuery.isLoading} />
        <KpiCard title="Pipeline Abierto" value={formatMinorUnits(summary?.openValueMinor ?? 0, 'USD')} loading={dealsQuery.isLoading} />
        <KpiCard title="Pipeline Ponderado" value={formatMinorUnits(summary?.weightedValueMinor ?? 0, 'USD')} loading={dealsQuery.isLoading} />
        <KpiCard title="Cerrado Ganado" value={formatMinorUnits(summary?.wonValueMinor ?? 0, 'USD')} loading={dealsQuery.isLoading} />
      </div>

      {mode === 'table' ? (
        <DataTable
          columns={tableCols}
          data={deals}
          getRowId={(d) => d.id}
          loading={dealsQuery.isLoading}
          emptyTitle="Sin oportunidades en esta vista"
          emptyDescription="Crea oportunidades desde la ficha 360° de Clientes."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {KANBAN_STAGES.map((stage) => {
            const stageDeals = deals.filter((d) => d.stageId === stage.id);
            const colTotal = stageDeals.reduce((acc, d) => acc + d.valueMinor, 0);
            return (
              <div key={stage.id} className="flex flex-col rounded-xl border border-border bg-muted/25">
                <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wider">{stage.label}</h2>
                    <span className="rounded-full bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                      {stageDeals.length}
                    </span>
                  </div>
                  <span className="font-mono text-xs font-medium text-muted-foreground tabular-nums">
                    {formatMinorUnits(colTotal, 'USD')}
                  </span>
                </div>

                <div className="flex-1 space-y-2.5 p-3">
                  {stageDeals.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">Sin deals en {stage.label.toLowerCase()}</p>
                  ) : (
                    stageDeals.map((deal) => (
                      <div key={deal.id} className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-xs">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug">{deal.title}</p>
                          <StatusBadge
                            label={deal.outcome}
                            tone={deal.outcome === 'won' ? 'success' : deal.outcome === 'lost' ? 'error' : 'info'}
                            appearance="dot"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{deal.partyName ?? deal.partyId}</p>
                        <div className="flex items-center justify-between border-t border-border/70 pt-2">
                          <span className="font-mono text-xs font-semibold tabular-nums">
                            {formatMinorUnits(deal.valueMinor, deal.currency)}
                          </span>
                          <div className="inline-flex items-center gap-1">
                            {stage.id !== 'stage_commit' && deal.outcome === 'open' ? (
                              <button
                                type="button"
                                title="Avanzar etapa"
                                onClick={() => advanceDeal(deal)}
                                className="inline-flex size-6 items-center justify-center rounded border border-border hover:bg-muted"
                              >
                                <ArrowRight className="size-3" />
                              </button>
                            ) : null}
                            {deal.outcome !== 'won' ? (
                              <button
                                type="button"
                                title="Marcar ganada"
                                onClick={() =>
                                  stageMutation.mutate({
                                    dealId: deal.id,
                                    stageId: 'stage_commit',
                                    probabilityBps: 10_000,
                                    outcome: 'won',
                                  })
                                }
                                className="inline-flex size-6 items-center justify-center rounded border border-border text-status-success-icon hover:bg-muted"
                              >
                                <Trophy className="size-3" />
                              </button>
                            ) : null}
                            {deal.outcome !== 'lost' ? (
                              <button
                                type="button"
                                title="Marcar perdida"
                                onClick={() =>
                                  stageMutation.mutate({
                                    dealId: deal.id,
                                    stageId: deal.stageId,
                                    probabilityBps: 0,
                                    outcome: 'lost',
                                  })
                                }
                                className="inline-flex size-6 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted"
                              >
                                <XCircle className="size-3" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
