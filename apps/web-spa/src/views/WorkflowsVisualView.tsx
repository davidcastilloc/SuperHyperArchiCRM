import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, GitBranch, Play, Plus } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

const DEFAULT_NODES = [
  { id: 'trigger', label: 'Evento: Orden Creada', kind: 'trigger' },
  { id: 'rule', label: 'Validar Crédito & Stock', kind: 'condition' },
  { id: 'action', label: 'Notificar + Emitir Factura', kind: 'action' },
];

/** Open Mercato DS v3 Visual Workflows Editor & Execution Instances view. */
export function WorkflowsVisualView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [workflowCode, setWorkflowCode] = useState('wf_order_fulfillment');
  const [triggerEvent, setTriggerEvent] = useState('on_order_created');

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
      const res = await rpc.api.automation.workflows.$post({
        json: { workflowCode: workflowCode.trim(), nodes: DEFAULT_NODES, triggers: [triggerEvent] },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['automation', 'workflows'] }),
  });

  const runMutation = useMutation({
    mutationFn: async (wfId: string) => {
      const res = await rpc.api.automation.workflows.run.$post({
        json: { workflowId: wfId, correlationKey: `RUN-${Date.now()}` },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['automation', 'workflows'] }),
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
          <Play className="size-3" />
          <span>Ejecutar</span>
        </button>
      ),
    },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!workflowCode.trim()) return;
    saveMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="workflows-visual-view">
      <PageHeader title="Editor Visual de Workflows & Instancias" description="Orquestación gráfica por nodos, triggers de dominio y monitoreo de ejecuciones." actions={<StatusBadge label={`${instances.length} ejecuciones`} tone="success" icon={<GitBranch className="size-3" />} />} />

      <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/25 p-5">
          {DEFAULT_NODES.map((node, idx) => (
            <div key={node.id} className="flex items-center gap-3">
              <div className="rounded-lg border border-border bg-card px-4 py-2.5 shadow-xs">
                <p className="text-overline uppercase text-muted-foreground">{node.kind}</p>
                <p className="text-xs font-semibold">{node.label}</p>
              </div>
              {idx < DEFAULT_NODES.length - 1 ? <ArrowRight className="size-4 text-muted-foreground" /> : null}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
          <input value={workflowCode} onChange={(e) => setWorkflowCode(e.target.value)} placeholder="wf_code" className={`${INPUT_CLS} font-mono text-xs`} />
          <input value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} placeholder="evento_disparador" className={`${INPUT_CLS} font-mono text-xs`} />
          <button type="submit" disabled={saveMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Guardar Definición</span></button>
        </form>
      </div>

      <DataTable columns={cols} data={defs} getRowId={(w) => w.id} loading={wfQuery.isLoading} emptyTitle="Sin workflows definidos" />
    </section>
  );
}
