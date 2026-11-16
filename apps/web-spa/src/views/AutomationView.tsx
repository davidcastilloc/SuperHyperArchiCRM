import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Play, Sparkles, XCircle } from 'lucide-react';
import { PageHeader, StatusBadge } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Business Rules evaluator & InboxOps Proposal Cards (1-click human approval). */
export function AutomationView({ rpc }: Phase2ViewProps) {
  const [entityType, setEntityType] = useState('work_order');
  const [lifecycleEvent, setLifecycleEvent] = useState('on_create');
  const [proposalId, setProposalId] = useState('prop_demo_1');
  const [feedback, setFeedback] = useState<string | null>(null);

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
    onSuccess: (data) => setFeedback(`Reglas evaluadas: ${data.evaluatedCount} · Coincidencias: ${data.matchedRules.length}`),
    onError: (err) => setFeedback(err.message),
  });

  const decideMutation = useMutation({
    mutationFn: async (decision: 'APPROVED' | 'REJECTED') => {
      const res = await rpc.api.automation.proposals.decide.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          proposalId: proposalId.trim(),
          decision,
          humanConfirmed: decision === 'APPROVED',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => setFeedback(`Propuesta ${data.id}: ${data.disposition} · ${data.executionStatus}`),
    onError: (err) => setFeedback(err.message),
  });

  function handleEvaluate(e: FormEvent) {
    e.preventDefault();
    if (!evaluateMutation.isPending) evaluateMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="automation-view">
      <PageHeader
        title="Automatización · Reglas & InboxOps IA"
        description="Evaluación determinista de eventos de negocio y aprobación humana explícita en 1 clic."
        actions={<StatusBadge label="Human-in-the-loop" tone="info" icon={<Sparkles className="size-3" />} />}
      />

      {feedback ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p> : null}

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
            <h2 className="text-sm font-semibold">InboxOps · Proposal Card</h2>
            <StatusBadge label="Pendiente de firma" tone="warning" appearance="dot" />
          </div>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Identificador de propuesta IA</span>
            <input className={`${INPUT_CLS} w-full font-mono text-xs`} value={proposalId} onChange={(e) => setProposalId(e.target.value)} placeholder="Proposal ID" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!proposalId.trim() || decideMutation.isPending} onClick={() => decideMutation.mutate('APPROVED')} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs">
              <CheckCircle2 className="size-3.5" />
              <span>Aprobar y Ejecutar</span>
            </button>
            <button type="button" disabled={!proposalId.trim() || decideMutation.isPending} onClick={() => decideMutation.mutate('REJECTED')} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted">
              <XCircle className="size-3.5 text-muted-foreground" />
              <span>Rechazar</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
