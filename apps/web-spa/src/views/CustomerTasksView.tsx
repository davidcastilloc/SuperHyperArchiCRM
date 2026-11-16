import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CheckCircle2, ListTodo, Plus } from 'lucide-react';
import {
  DataTable,
  KpiCard,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

type InteractionKind = 'task' | 'call' | 'meeting' | 'note' | 'interaction';
type InteractionPriority = 'low' | 'normal' | 'high' | 'urgent';

/** Open Mercato DS v3 Customer Tasks, Activity Log, and Schedule Calendar view. */
export function CustomerTasksView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [showForm, setShowForm] = useState(false);
  const [partyId, setPartyId] = useState('');
  const [kind, setKind] = useState<InteractionKind>('task');
  const [priority, setPriority] = useState<InteractionPriority>('normal');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const tasksQuery = useQuery({
    queryKey: ['customers', 'interactions', 'all'],
    queryFn: async () => {
      const res = await rpc.api.customers.interactions.$get({ query: { limit: '100' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'tasks-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (payload: {
      id?: string;
      partyId?: string | null;
      kind: InteractionKind;
      priority: InteractionPriority;
      title: string;
      body?: string | null;
      status: 'open' | 'in_progress' | 'completed';
    }) => {
      const nowSec = Math.floor(Date.now() / 1000);
      const res = await rpc.api.customers.interactions.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          ...payload,
          dueAt: nowSec + 86_400,
          scheduledStart: nowSec + 3600,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setTitle('');
      setBody('');
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['customers', 'interactions'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'tasks'] });
    },
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || upsertMutation.isPending) return;
    upsertMutation.mutate({
      partyId: partyId || partiesQuery.data?.items[0]?.id || null,
      kind,
      priority,
      title: title.trim(),
      body: body.trim() || null,
      status: 'open',
    });
  }

  const items = tasksQuery.data?.items ?? [];
  const parties = partiesQuery.data?.items ?? [];
  const summary = tasksQuery.data?.summary;
  type TaskRow = (typeof items)[number];

  const columns: DataTableColumn<TaskRow>[] = [
    {
      id: 'title',
      header: 'Tarea / Actividad',
      sortValue: (t) => t.title,
      cell: (t) => (
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{t.title}</p>
          <p className="font-mono text-[11px] text-muted-foreground">customers:{t.kind}</p>
        </div>
      ),
    },
    {
      id: 'party',
      header: vocabulary.partySingular,
      cell: (t) => <span className="text-xs">{t.partyName ?? 'General'}</span>,
    },
    {
      id: 'priority',
      header: 'Prioridad',
      cell: (t) => (
        <StatusBadge
          label={t.priority}
          tone={t.priority === 'urgent' || t.priority === 'high' ? 'warning' : 'neutral'}
        />
      ),
    },
    {
      id: 'status',
      header: 'Estado',
      cell: (t) => (
        <StatusBadge
          label={t.status === 'completed' ? 'Completada' : 'Pendiente'}
          tone={t.status === 'completed' ? 'success' : 'info'}
          appearance="dot"
        />
      ),
    },
    {
      id: 'done',
      header: 'Acción',
      align: 'right',
      cell: (t) =>
        t.status !== 'completed' ? (
          <button
            type="button"
            onClick={() =>
              upsertMutation.mutate({
                id: t.id,
                partyId: t.partyId,
                kind: (t.kind as InteractionKind) || 'task',
                priority: (t.priority as InteractionPriority) || 'normal',
                title: t.title,
                body: t.body,
                status: 'completed',
              })
            }
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted"
          >
            <CheckCircle2 className="size-3.5 text-status-success-icon" />
            <span>Completar</span>
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">Listo</span>
        ),
    },
  ];

  return (
    <section className="space-y-5" data-slot="customer-tasks-view">
      <PageHeader
        title="Tareas de Clientes & Calendario"
        description={`Seguimientos, llamadas, reuniones e interacciones vinculadas a ${vocabulary.partyPlural.toLowerCase()}.`}
        onRefresh={() => void tasksQuery.refetch()}
        refreshing={tasksQuery.isFetching}
        actions={
          <>
            <div className="inline-flex rounded-md border border-border bg-background p-0.5 shadow-xs">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                  viewMode === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground'
                }`}
              >
                <ListTodo className="size-3.5" />
                <span>Lista</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('calendar')}
                className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-medium ${
                  viewMode === 'calendar' ? 'bg-muted text-foreground' : 'text-muted-foreground'
                }`}
              >
                <CalendarDays className="size-3.5" />
                <span>Agenda</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowForm((prev) => !prev)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs"
            >
              <Plus className="size-3.5" />
              <span>{showForm ? 'Cerrar' : 'Nueva Tarea'}</span>
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard title="Actividades Totales" value={summary?.totalCount ?? items.length} loading={tasksQuery.isLoading} />
        <KpiCard title="Tareas Pendientes" value={summary?.openCount ?? 0} loading={tasksQuery.isLoading} />
        <KpiCard title="Completadas" value={summary?.completedCount ?? 0} loading={tasksQuery.isLoading} />
      </div>

      {showForm ? (
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-5">
          <select value={partyId || parties[0]?.id || ''} onChange={(e) => setPartyId(e.target.value)} className={INPUT_CLS}>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as InteractionKind)} className={INPUT_CLS}>
            <option value="task">Tarea</option>
            <option value="call">Llamada</option>
            <option value="meeting">Reunión</option>
            <option value="interaction">Interacción</option>
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value as InteractionPriority)} className={INPUT_CLS}>
            <option value="normal">Prioridad Normal</option>
            <option value="high">Alta</option>
            <option value="urgent">Urgente</option>
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título de tarea o nota..." className={INPUT_CLS} />
          <button type="submit" disabled={!title.trim() || upsertMutation.isPending} className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">
            Guardar Tarea
          </button>
        </form>
      ) : null}

      {viewMode === 'list' ? (
        <DataTable
          columns={columns}
          data={items}
          getRowId={(t) => t.id}
          loading={tasksQuery.isLoading}
          emptyTitle="Sin tareas registradas"
          emptyDescription="Programa llamadas, seguimientos o recordatorios para tu equipo."
          emptyActionLabel="Nueva Tarea"
          onEmptyAction={() => setShowForm(true)}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-xs divide-y divide-border">
          {items.length === 0 ? (
            <p className="p-8 text-center text-xs text-muted-foreground">Sin eventos programados en la agenda.</p>
          ) : (
            items.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.partyName ?? 'General'} · <span className="font-mono">customers:{t.kind}</span>
                  </p>
                </div>
                <StatusBadge
                  label={t.status === 'completed' ? 'Completada' : 'Programada'}
                  tone={t.status === 'completed' ? 'success' : 'info'}
                  appearance="dot"
                />
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
