import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, GitBranch, Play, Plus, Trash2 } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

export interface WorkflowStepItem {
  id: string;
  label: string;
  kind: string;
}

const DEFAULT_NODES: WorkflowStepItem[] = [
  { id: 'trigger', label: 'Evento: Orden Creada', kind: 'trigger' },
  { id: 'rule', label: 'Validar Crédito & Stock', kind: 'condition' },
  { id: 'action', label: 'Notificar + Emitir Factura', kind: 'action' },
];

/** Validates and serializes workflow steps into JSON, rejecting empty definitions. */
export function serializeWorkflowSteps(steps: WorkflowStepItem[]): string {
  const clean = steps.filter((s) => s.label.trim().length > 0);
  if (clean.length === 0) {
    throw new Error('El workflow debe contener al menos un paso válido.');
  }
  return JSON.stringify(clean);
}

/** Open Mercato DS v3 Visual Workflows Editor with interactive step builder & Execution Instances view. */
export function WorkflowsVisualView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [workflowCode, setWorkflowCode] = useState('wf_order_fulfillment');
  const [triggerEvent, setTriggerEvent] = useState('on_order_created');
  const [steps, setSteps] = useState<WorkflowStepItem[]>(DEFAULT_NODES);
  const [newStepLabel, setNewStepLabel] = useState('');
  const [newStepKind, setNewStepKind] = useState('action');
  const [feedback, setFeedback] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const wfQuery = useQuery({
    queryKey: ['automation', 'workflows'],
    queryFn: async () => {
      const res = await rpc.api.automation.workflows.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsedNodes = JSON.parse(serializeWorkflowSteps(steps)) as WorkflowStepItem[];
      const res = await rpc.api.automation.workflows.$post({
        json: { workflowCode: workflowCode.trim(), nodes: parsedNodes, triggers: [triggerEvent] },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setFeedback({ tone: 'info', text: `Workflow ${workflowCode} guardado con ${steps.length} pasos.` });
      void queryClient.invalidateQueries({ queryKey: ['automation', 'workflows'] });
    },
    onError: (err) => setFeedback({ tone: 'error', text: err.message }),
  });

  const runMutation = useMutation({
    mutationFn: async (wfId: string) => {
      const res = await rpc.api.automation.workflows.run.$post({
        json: { workflowId: wfId, correlationKey: `RUN-${Date.now()}` },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setFeedback({ tone: 'info', text: 'Ejecución de workflow iniciada.' });
      void queryClient.invalidateQueries({ queryKey: ['automation', 'workflows'] });
    },
    onError: (err) => setFeedback({ tone: 'error', text: err.message }),
  });

  const defs = wfQuery.data?.definitions ?? [];
  const instances = wfQuery.data?.instances ?? [];
  type DefRow = (typeof defs)[number];
  const cols: DataTableColumn<DefRow>[] = [
    { id: 'code', header: 'Workflow', cell: (w) => <span className="font-mono text-xs font-medium">{w.workflowCode}</span> },
    { id: 'trig', header: 'Trigger', cell: (w) => <StatusBadge label={w.eventTriggersJson} tone="info" /> },
    { id: 'ver', header: 'Versión', cell: (w) => <span className="font-mono text-xs">v{w.versionNo}</span> },
    {
      id: 'run',
      header: 'Ejecutar',
      align: 'right',
      cell: (w) => (
        <button type="button" onClick={() => runMutation.mutate(w.id)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted">
          <Play className="size-3" /><span>Ejecutar</span>
        </button>
      ),
    },
  ];

  function handleAddStep() {
    if (!newStepLabel.trim()) return;
    setSteps((prev) => [...prev, { id: `step_${Date.now()}`, label: newStepLabel.trim(), kind: newStepKind }]);
    setNewStepLabel('');
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!workflowCode.trim() || saveMutation.isPending) return;
    saveMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="workflows-visual-view">
      <PageHeader title="Editor Visual de Workflows & Instancias" description="Constructor interactivo de pasos, triggers de dominio y monitoreo de ejecuciones." actions={<StatusBadge label={`${instances.length} ejecuciones`} tone="success" icon={<GitBranch className="size-3" />} />} />

      {feedback ? (
        <p role={feedback.tone === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-xs font-medium ${feedback.tone === 'error' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-status-info-border bg-status-info-bg text-status-info-text'}`}>
          {feedback.text}
        </p>
      ) : null}

      <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/25 p-5">
          {steps.map((node, idx) => (
            <div key={node.id} className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 shadow-xs">
                <div>
                  <p className="text-overline uppercase text-muted-foreground">{node.kind}</p>
                  <p className="text-xs font-semibold">{node.label}</p>
                </div>
                <button type="button" aria-label={`Quitar ${node.label}`} onClick={() => setSteps((prev) => prev.filter((s) => s.id !== node.id))} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              {idx < steps.length - 1 ? <ArrowRight className="size-4 text-muted-foreground" /> : null}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 items-end gap-2.5 md:grid-cols-4">
          <label className="space-y-1 text-xs md:col-span-2">
            <span className="font-medium text-muted-foreground">Nuevo Paso del Workflow</span>
            <input value={newStepLabel} onChange={(e) => setNewStepLabel(e.target.value)} placeholder="Ej. Validar Stock / Enviar Correo" className={`${INPUT_CLS} w-full`} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Tipo de Nodo</span>
            <select value={newStepKind} onChange={(e) => setNewStepKind(e.target.value)} className={`${INPUT_CLS} w-full`}>
              <option value="trigger">trigger</option>
              <option value="condition">condition</option>
              <option value="action">action</option>
            </select>
          </label>
          <button type="button" onClick={handleAddStep} disabled={!newStepLabel.trim()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-45">
            <Plus className="size-3.5" /><span>Agregar Paso</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 items-end gap-2.5 border-t border-border pt-3 md:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Código de Workflow</span>
            <input value={workflowCode} onChange={(e) => setWorkflowCode(e.target.value)} placeholder="wf_code" className={`${INPUT_CLS} w-full font-mono text-xs`} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Evento Disparador</span>
            <input value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} placeholder="evento_disparador" className={`${INPUT_CLS} w-full font-mono text-xs`} />
          </label>
          <button type="submit" disabled={saveMutation.isPending || steps.length === 0} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-45">
            <Plus className="size-3.5" /><span>Guardar Definición</span>
          </button>
        </form>
      </div>

      <DataTable columns={cols} data={defs} getRowId={(w) => w.id} loading={wfQuery.isLoading} emptyTitle="Sin workflows definidos" />
    </section>
  );
}
