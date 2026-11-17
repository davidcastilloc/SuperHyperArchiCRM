import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Play, Sparkles, XCircle } from 'lucide-react';
import { PageHeader, StatusBadge } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

interface ProposalRow {
  id: string;
  target_command_id: string;
  target_record_id: string | null;
  confidence_bps: number;
  disposition: string;
  model_id: string;
  created_at: number;
}

/** Open Mercato DS v3 Business Rules evaluator & InboxOps Proposal Cards (1-click human approval). */
export function AutomationView({ rpc }: Phase2ViewProps) {
  const qc = useQueryClient();
  const [entityType, setEntityType] = useState('work_order');
  const [lifecycleEvent, setLifecycleEvent] = useState('on_create');
  const [manualProposalId, setManualProposalId] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const proposalsQuery = useQuery({
    queryKey: ['automation', 'proposals'],
    queryFn: async () => {
      const res = await rpc.api.automation.proposals.$get();
      if (!res.ok) throw await readApiError(res);
      return (await res.json()) as { items: ProposalRow[] };
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.automation.rules.evaluate.$post({
        json: {
          entityType: entityType.trim(),
          lifecycleEvent: lifecycleEvent.trim(),
          payload: { priority: 'URGENT' },
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) =>
      setFeedback({ tone: 'info', text: `Reglas evaluadas: ${data.evaluatedCount} · Coincidencias: ${data.matchedRules.length}` }),
    onError: (err) => setFeedback({ tone: 'error', text: err.message }),
  });

  const decideMutation = useMutation({
    mutationFn: async (input: { proposalId: string; decision: 'APPROVED' | 'REJECTED' }) => {
      const res = await rpc.api.automation.proposals.decide.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          proposalId: input.proposalId.trim(),
          decision: input.decision,
          humanConfirmed: input.decision === 'APPROVED',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ['automation', 'proposals'] });
      setManualProposalId('');
      setFeedback({ tone: 'info', text: `Propuesta ${data.id}: ${data.disposition} · ${data.executionStatus}` });
    },
    onError: (err) => setFeedback({ tone: 'error', text: err.message }),
  });

  function handleEvaluate(e: FormEvent) {
    e.preventDefault();
    if (!evaluateMutation.isPending) evaluateMutation.mutate();
  }

  const proposals = proposalsQuery.data?.items ?? [];

  return (
    <section className="space-y-5" data-slot="automation-view">
      <PageHeader
        title="Automatización · Reglas & InboxOps IA"
        description="Evaluación determinista de eventos de negocio y aprobación humana explícita en 1 clic."
        actions={<StatusBadge label="Human-in-the-loop" tone="info" icon={<Sparkles className="size-3" />} />}
      />

      {feedback ? (
        <p
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-md border px-3 py-2 text-xs font-medium ${
            feedback.tone === 'error'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-status-info-border bg-status-info-bg text-status-info-text'
          }`}
        >
          {feedback.text}
        </p>
      ) : null}

      {proposalsQuery.error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {proposalsQuery.error instanceof Error ? proposalsQuery.error.message : 'Error cargando propuestas IA.'}
        </p>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <form onSubmit={handleEvaluate} className="space-y-3.5 rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="text-sm font-semibold">Evaluador de Reglas de Negocio</h2>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Entidad objetivo</span>
            <select className={`${INPUT_CLS} w-full`} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              <option value="work_order">work_order</option>
              <option value="pos_order">pos_order</option>
              <option value="lease_contract">lease_contract</option>
              <option value="clinical_note">clinical_note</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Evento de ciclo de vida</span>
            <select className={`${INPUT_CLS} w-full`} value={lifecycleEvent} onChange={(e) => setLifecycleEvent(e.target.value)}>
              <option value="on_create">on_create</option>
              <option value="on_status_change">on_status_change</option>
              <option value="on_overdue">on_overdue</option>
            </select>
          </label>
          <button type="submit" disabled={evaluateMutation.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs">
            <Play className="size-3.5" />
            <span>{evaluateMutation.isPending ? 'Evaluando...' : 'Evaluar Reglas'}</span>
          </button>
        </form>

        <div className="space-y-3.5 rounded-xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">InboxOps · Propuestas IA</h2>
            <StatusBadge label={`${proposals.filter((p) => p.disposition === 'PENDING').length} pendientes`} tone="warning" appearance="dot" />
          </div>

          {proposals.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              No hay propuestas IA pendientes en este momento.
            </p>
          ) : (
            <div className="space-y-2">
              {proposals.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/25 p-3 text-xs">
                  <div>
                    <p className="font-semibold text-foreground">{p.target_command_id}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {p.id.slice(0, 12)} · {(p.confidence_bps / 100).toFixed(0)}% conf. · {p.disposition}
                    </p>
                  </div>
                  {p.disposition === 'PENDING' ? (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ proposalId: p.id, decision: 'APPROVED' })}
                        className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground shadow-xs"
                      >
                        <CheckCircle2 className="size-3" /><span>Aprobar</span>
                      </button>
                      <button
                        type="button"
                        disabled={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ proposalId: p.id, decision: 'REJECTED' })}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted"
                      >
                        <XCircle className="size-3 text-muted-foreground" /><span>Rechazar</span>
                      </button>
                    </div>
                  ) : (
                    <StatusBadge label={p.disposition} tone={p.disposition === 'APPROVED' ? 'success' : 'neutral'} />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="min-w-0 flex-1 space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">ID manual de propuesta (opcional)</span>
              <input className={`${INPUT_CLS} w-full font-mono text-xs`} value={manualProposalId} onChange={(e) => setManualProposalId(e.target.value)} placeholder="prop_..." />
            </label>
            <button type="button" disabled={!manualProposalId.trim() || decideMutation.isPending} onClick={() => decideMutation.mutate({ proposalId: manualProposalId, decision: 'APPROVED' })} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow-xs disabled:opacity-45">
              <CheckCircle2 className="size-3.5" /><span>Aprobar</span>
            </button>
            <button type="button" disabled={!manualProposalId.trim() || decideMutation.isPending} onClick={() => decideMutation.mutate({ proposalId: manualProposalId, decision: 'REJECTED' })} className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted disabled:opacity-45">
              <XCircle className="size-3.5 text-muted-foreground" /><span>Rechazar</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
