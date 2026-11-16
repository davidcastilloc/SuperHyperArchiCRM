import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { INPUT_CLS, type Phase2ViewProps } from './phase2-format';

/** Business Rules evaluator & InboxOps Proposal Cards (1-click human approval). */
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      setFeedback(`Reglas evaluadas: ${data.evaluatedCount} · Coincidencias: ${data.matchedRules.length}`);
    },
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      setFeedback(`Propuesta ${data.id}: ${data.disposition} -> ${data.executionStatus}`);
    },
    onError: (err) => setFeedback(err.message),
  });

  function handleEvaluate(e: FormEvent) {
    e.preventDefault();
    if (evaluateMutation.isPending) return;
    evaluateMutation.mutate();
  }

  return (
    <section className="space-y-4 p-4" data-slot="automation-view">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Automatización · Reglas & Proposal Cards IA</h1>
        <p className="text-sm text-muted-foreground">
          Evaluación determinista de reglas y aprobación humana explícita en 1 clic para InboxOps.
        </p>
      </div>

      {feedback && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          {feedback}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={handleEvaluate} className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">Evaluar Reglas de Negocio</h2>
          <input className={INPUT_CLS} value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="Tipo de entidad" />
          <input className={INPUT_CLS} value={lifecycleEvent} onChange={(e) => setLifecycleEvent(e.target.value)} placeholder="Evento de ciclo de vida" />
          <button type="submit" disabled={evaluateMutation.isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            {evaluateMutation.isPending ? 'Evaluando...' : 'Evaluar Reglas'}
          </button>
        </form>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">InboxOps · Proposal Card</h2>
          <input className={INPUT_CLS} value={proposalId} onChange={(e) => setProposalId(e.target.value)} placeholder="Proposal ID" />
          <div className="flex gap-2">
            <button type="button" disabled={!proposalId.trim() || decideMutation.isPending} onClick={() => decideMutation.mutate('APPROVED')} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
              Aprobar y Ejecutar (1 Clic)
            </button>
            <button type="button" disabled={!proposalId.trim() || decideMutation.isPending} onClick={() => decideMutation.mutate('REJECTED')} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium">
              Rechazar
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
