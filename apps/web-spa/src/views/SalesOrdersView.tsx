import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus } from 'lucide-react';
import {
  DataTable,
  downloadCsvFile,
  FilterBar,
  KpiCard,
  PageHeader,
  SavedViewsBar,
  StatusBadge,
  type DataTableColumn,
} from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

interface SalesOrdersViewProps extends Phase2ViewProps {
  onNavigate: (href: string) => void;
}

export function formatOrderStatusEs(status: string, fulfillment?: string): string {
  if (status === 'cancelled') return 'Cancelada';
  if (fulfillment === 'fulfilled' || status === 'fulfilled' || status === 'completed' || status === 'settled') {
    return 'Despachada';
  }
  if (status === 'confirmed' || status === 'paid') return 'Confirmada';
  return 'Pendiente';
}

function formatOrderDate(epochSec: number): string {
  try {
    return new Date(epochSec * 1000).toLocaleString('es', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function resolveOrderBadge(status: string, fulfillment: string): {
  label: string;
  tone: 'success' | 'warning' | 'info' | 'error';
  confirmed?: boolean;
} {
  const label = formatOrderStatusEs(status, fulfillment);
  if (label === 'Cancelada') return { label, tone: 'error' };
  if (label === 'Despachada') return { label, tone: 'success' };
  if (label === 'Confirmada') return { label, tone: 'info', confirmed: true };
  return { label, tone: 'warning' };
}

/** Open Mercato DS v3 Sales Orders & B2B Dispatch Orders table. */
export function SalesOrdersView({ vocabulary, rpc, onNavigate }: SalesOrdersViewProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [partyId, setPartyId] = useState('');
  const [totalMajor, setTotalMajor] = useState('120.00');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['pos', 'orders', search],
    queryFn: async () => {
      const trimmed = search.trim();
      const res = await rpc.api.pos.orders.$get({
        query: trimmed ? { limit: '100', search: trimmed } : { limit: '100' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'orders-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) return { items: [] as Array<{ id: string; displayName: string }> };
      return res.json();
    },
    enabled: showCreate,
  });

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.pos.quotes.$post({
        json: {
          partyId: partyId || partiesQuery.data?.items[0]?.id,
          totalMinor: Math.max(100, parseMajorToMinor(totalMajor)),
          currency: 'USD',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['pos', 'orders'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const allItems = ordersQuery.data?.items ?? [];
  const summary = ordersQuery.data?.summary;

  const visibleItems = useMemo(() => {
    if (activeView === 'fulfilled') {
      return allItems.filter(
        (o) => o.fulfillmentStatus === 'fulfilled' || o.status === 'completed' || o.status === 'settled',
      );
    }
    if (activeView === 'pending') {
      return allItems.filter(
        (o) => o.fulfillmentStatus !== 'fulfilled' && o.status !== 'completed' && o.status !== 'settled',
      );
    }
    if (activeView === 'pos') {
      return allItems.filter((o) => o.orderKind === 'pos_sale');
    }
    return allItems;
  }, [allItems, activeView]);

  type OrderRow = (typeof visibleItems)[number];
  const columns: DataTableColumn<OrderRow>[] = [
    {
      id: 'order',
      header: vocabulary.orderSingular,
      sortValue: (o) => o.orderNumber,
      cell: (o) => {
        const b = resolveOrderBadge(o.status, o.fulfillmentStatus);
        return (
          <div className="space-y-0.5">
            <p className="font-mono text-xs font-medium text-foreground">{o.orderNumber}</p>
            <StatusBadge
              label={b.label}
              tone={b.tone}
              appearance="dot"
              icon={b.confirmed ? <CheckCircle2 className="size-3 text-muted-foreground" /> : undefined}
            />
          </div>
        );
      },
    },
    {
      id: 'customer',
      header: vocabulary.partySingular,
      sortValue: (o) => o.partyName ?? 'Mostrador',
      cell: (o) => (
        <div className="space-y-0.5">
          <p className="font-medium">{o.partyName ?? `${vocabulary.partySingular} Mostrador`}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{o.registerId ?? 'Canal directo'}</p>
        </div>
      ),
    },
    {
      id: 'channel',
      header: 'Canal',
      cell: (o) => (
        <span className="text-xs text-muted-foreground">
          {o.channelId ?? (o.orderKind === 'pos_sale' ? 'POS Sucursal' : 'Wholesale B2B')}
        </span>
      ),
    },
    {
      id: 'net',
      header: 'Total (neto)',
      align: 'right',
      sortValue: (o) => o.netSubtotalMinor,
      cell: (o) => <span className="font-mono tabular-nums">{formatMinorUnits(o.netSubtotalMinor, o.currency)}</span>,
    },
    {
      id: 'gross',
      header: 'Total (bruto)',
      align: 'right',
      sortValue: (o) => o.grandTotalMinor,
      cell: (o) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(o.grandTotalMinor, o.currency)}</span>,
    },
    {
      id: 'date',
      header: 'Fecha',
      sortValue: (o) => o.createdAt,
      cell: (o) => <span className="text-xs text-muted-foreground tabular-nums">{formatOrderDate(o.createdAt)}</span>,
    },
  ];

  function handleExportCsv() {
    downloadCsvFile(
      'sales-orders.csv',
      ['Order', 'Customer', 'Channel', 'Status', 'Currency', 'NetMinor', 'GrossMinor'],
      visibleItems.map((o) => [
        o.orderNumber,
        o.partyName ?? 'Mostrador',
        o.channelId ?? o.orderKind,
        formatOrderStatusEs(o.status, o.fulfillmentStatus),
        o.currency,
        o.netSubtotalMinor,
        o.grandTotalMinor,
      ]),
    );
  }

  function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    createOrderMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="sales-orders-view">
      <PageHeader
        title={vocabulary.orderSingular}
        description={`Revisa documentos con contexto de ${vocabulary.partySingular.toLowerCase()}, totales neto/bruto y canales de cobro.`}
        onRefresh={() => void ordersQuery.refetch()}
        refreshing={ordersQuery.isFetching}
        actions={
          <>
            <SavedViewsBar
              views={[
                { id: 'all', label: 'Todas' },
                { id: 'fulfilled', label: 'Despachadas' },
                { id: 'pending', label: 'Pendientes' },
                { id: 'pos', label: 'Mostrador POS' },
              ]}
              activeViewId={activeView}
              onSelectView={setActiveView}
              onExport={handleExportCsv}
            />
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs hover:bg-primary-hover"
            >
              <Plus className="size-3.5" />
              <span>{showCreate ? 'Cerrar' : 'Nueva Orden B2B'}</span>
            </button>
          </>
        }
      />

      {errorMsg ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      {showCreate ? (
        <form onSubmit={handleCreateSubmit} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">{vocabulary.partySingular}</span>
            <select value={partyId || partiesQuery.data?.items[0]?.id || ''} onChange={(e) => setPartyId(e.target.value)} className={`${INPUT_CLS} w-full`}>
              <option value="">General</option>
              {(partiesQuery.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Monto Total (USD)</span>
            <input value={totalMajor} onChange={(e) => setTotalMajor(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
          </label>
          <button type="submit" disabled={createOrderMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground">
            <Plus className="size-3.5" />
            <span>Crear Documento</span>
          </button>
        </form>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Documentos" value={summary?.totalCount ?? allItems.length} loading={ordersQuery.isLoading} />
        <KpiCard title="Facturación Bruta" value={formatMinorUnits(summary?.grossRevenueMinor ?? 0, 'USD')} loading={ordersQuery.isLoading} />
        <KpiCard title="Despachadas" value={summary?.fulfilledCount ?? 0} loading={ordersQuery.isLoading} />
        <KpiCard title="Pendientes" value={summary?.pendingCount ?? 0} loading={ordersQuery.isLoading} />
      </div>

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por número de orden..."
      />

      <DataTable
        columns={columns}
        data={visibleItems}
        getRowId={(o) => o.id}
        loading={ordersQuery.isLoading}
        emptyTitle="Sin órdenes registradas"
        emptyDescription="Crea una orden B2B o emite la primera venta desde POS."
        emptyActionLabel="Nueva Orden B2B"
        onEmptyAction={() => setShowCreate(true)}
        rowActions={() => [
          { id: 'pos', label: 'Nueva venta en POS', onSelect: () => onNavigate('/pos') },
          { id: 'wms', label: 'Ver picking WMS', onSelect: () => onNavigate('/wms') },
        ]}
      />
    </section>
  );
}
