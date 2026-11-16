import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { DataTable, FilterBar, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Immutable Action & Audit Logs viewer (kernel_action_logs). */
export function AuditLogsView({ rpc }: Phase2ViewProps) {
  const [search, setSearch] = useState('');

  const logsQuery = useQuery({
    queryKey: ['system', 'audit-logs'],
    queryFn: async () => {
      const res = await rpc.api.system['audit-logs'].$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const term = search.trim().toLowerCase();
  const items = (logsQuery.data?.items ?? []).filter(
    (l) =>
      !term ||
      l.commandId.toLowerCase().includes(term) ||
      l.resourceKind.toLowerCase().includes(term) ||
      l.resourceId.toLowerCase().includes(term),
  );

  type LogRow = (typeof items)[number];
  const columns: DataTableColumn<LogRow>[] = [
    {
      id: 'cmd',
      header: 'Comando',
      sortValue: (l) => l.commandId,
      cell: (l) => <span className="font-mono text-xs font-medium">{l.commandId}</span>,
    },
    {
      id: 'res',
      header: 'Recurso',
      cell: (l) => (
        <div className="space-y-0.5">
          <p className="text-xs font-medium">{l.resourceKind}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{l.resourceId}</p>
        </div>
      ),
    },
    {
      id: 'stream',
      header: 'Stream',
      cell: (l) => <StatusBadge label={l.logStream} tone="neutral" appearance="dot" />,
    },
    {
      id: 'actor',
      header: 'Actor / Org',
      cell: (l) => <span className="font-mono text-xs text-muted-foreground">{l.actorId} · {l.orgId}</span>,
    },
    {
      id: 'time',
      header: 'Fecha',
      sortValue: (l) => l.createdAt,
      cell: (l) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {new Date(l.createdAt * 1000).toLocaleString('es')}
        </span>
      ),
    },
  ];

  return (
    <section className="space-y-5" data-slot="audit-logs-view">
      <PageHeader
        title="Audit Logs"
        description="Bitácora inmutable de mutaciones sobre comandos del kernel y recursos del tenant."
        onRefresh={() => void logsQuery.refetch()}
        refreshing={logsQuery.isFetching}
        actions={<StatusBadge label="Inmutable D1" tone="info" icon={<History className="size-3" />} />}
      />

      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Filtrar por comando, recurso o ID..." />

      <DataTable
        columns={columns}
        data={items}
        getRowId={(l) => l.id}
        loading={logsQuery.isLoading}
        emptyTitle="Sin eventos de auditoría"
        emptyDescription="Cada creación o mutación en el sistema registra un evento criptográfico aquí."
      />
    </section>
  );
}
