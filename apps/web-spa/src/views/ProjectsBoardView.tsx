import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Plus } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseNonNegInt, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 PSA Projects & Time-Tracking Board view. */
export function ProjectsBoardView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('PRJ-2026-01');
  const [name, setName] = useState('Implementación POS Sucursal');
  const [budgetValue, setBudgetValue] = useState('80');

  const projectsQuery = useQuery({
    queryKey: ['staff', 'projects'],
    queryFn: async () => {
      const res = await rpc.api.staff.projects.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.staff.projects.$post({
        json: { code: code.trim(), name: name.trim(), budgetKind: 'hours', budgetValue: parseNonNegInt(budgetValue, 40), hourlyRateMinor: 5000, status: 'ACTIVE' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['staff', 'projects'] }),
  });

  const items = projectsQuery.data?.items ?? [];
  type ProjRow = (typeof items)[number];
  const columns: DataTableColumn<ProjRow>[] = [
    { id: 'code', header: 'Código', cell: (p) => <span className="font-mono text-xs font-medium">{p.code}</span> },
    { id: 'name', header: 'Proyecto', cell: (p) => <span className="font-medium">{p.name}</span> },
    { id: 'budget', header: 'Presupuesto', align: 'right', cell: (p) => <span className="font-mono text-xs tabular-nums">{p.budgetValue} h</span> },
    { id: 'rate', header: 'Tarifa/h', align: 'right', cell: (p) => <span className="font-mono text-xs tabular-nums">{formatMinorUnits(p.hourlyRateMinor, 'USD')}</span> },
    { id: 'status', header: 'Estado', cell: (p) => <StatusBadge label={p.status} tone={p.status === 'ACTIVE' ? 'success' : 'neutral'} appearance="dot" /> },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    createMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="projects-board-view">
      <PageHeader
        title="Proyectos & Tablero PSA"
        description="Control de proyectos facturables, horas presupuestadas y seguimiento operativo."
        onRefresh={() => void projectsQuery.refetch()}
        actions={<StatusBadge label="PSA + Time-Tracking" tone="info" icon={<FolderKanban className="size-3" />} />}
      />

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-4">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PRJ-01" className={`${INPUT_CLS} font-mono text-xs`} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del proyecto" className={INPUT_CLS} />
        <input value={budgetValue} onChange={(e) => setBudgetValue(e.target.value)} placeholder="Horas" className={`${INPUT_CLS} font-mono tabular-nums`} />
        <button type="submit" disabled={createMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Crear Proyecto</span></button>
      </form>

      <DataTable columns={columns} data={items} getRowId={(p) => p.id} loading={projectsQuery.isLoading} emptyTitle="Sin proyectos activos" />
    </section>
  );
}
