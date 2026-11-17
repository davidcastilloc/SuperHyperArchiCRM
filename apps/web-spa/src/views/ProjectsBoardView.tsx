import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Plus } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, parseNonNegInt, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 PSA Projects & Time-Tracking Board view. */
export function ProjectsBoardView({ rpc, vocabulary }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [partyId, setPartyId] = useState('');
  const [code, setCode] = useState('PRJ-2026-01');
  const [name, setName] = useState('');
  const [budgetValue, setBudgetValue] = useState('80');
  const [rateMajor, setRateMajor] = useState('50.00');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'projects-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) return { items: [] as Array<{ id: string; displayName: string }> };
      return res.json();
    },
  });

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
        json: {
          code: code.trim(),
          name: name.trim(),
          budgetKind: 'hours',
          budgetValue: parseNonNegInt(budgetValue, 40),
          hourlyRateMinor: parseMajorToMinor(rateMajor),
          status: 'ACTIVE',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['staff', 'projects'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const parties = partiesQuery.data?.items ?? [];
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

      {errorMsg ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-6">
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">{vocabulary.partySingular}</span>
          <select value={partyId || parties[0]?.id || ''} onChange={(e) => setPartyId(e.target.value)} className={`${INPUT_CLS} w-full`}>
            <option value="">Interno / General</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Código</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PRJ-01" className={`${INPUT_CLS} w-full font-mono text-xs`} />
        </label>
        <label className="space-y-1 text-xs md:col-span-2">
          <span className="font-medium text-muted-foreground">Nombre del Proyecto</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Auditoría Fiscal Q4" className={`${INPUT_CLS} w-full`} required />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Horas / Tarifa USD</span>
          <div className="flex gap-1">
            <input value={budgetValue} onChange={(e) => setBudgetValue(e.target.value)} placeholder="80" className={`${INPUT_CLS} w-1/2 font-mono tabular-nums`} />
            <input value={rateMajor} onChange={(e) => setRateMajor(e.target.value)} placeholder="50.00" className={`${INPUT_CLS} w-1/2 font-mono tabular-nums`} />
          </div>
        </label>
        <button type="submit" disabled={createMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
          <Plus className="size-3.5" /><span>Crear Proyecto</span>
        </button>
      </form>

      <DataTable columns={columns} data={items} getRowId={(p) => p.id} loading={projectsQuery.isLoading} emptyTitle="Sin proyectos activos" />
    </section>
  );
}
