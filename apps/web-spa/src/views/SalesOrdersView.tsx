import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { formatMinorUnits, readApiError, type Phase2ViewProps } from './phase2-format';

interface SalesOrdersViewProps extends Phase2ViewProps {
  onNavigate: (href: string) => void;
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
  if (status === 'cancelled') return { label: 'Cancelada', tone: 'error' };
  if (fulfillment === 'fulfilled' || status === 'completed' || status === 'settled') {
    return { label: 'Fulfilled', tone: 'success' };
  }
  if (status === 'confirmed' || status === 'paid') {
    return { label: 'Confirmed', tone: 'info', confirmed: true };
  }
  return { label: 'Pending Approval', tone: 'warning' };
}

/** Open Mercato DS v3 Sales Orders & Quotes back-office table with SavedViews & CSV export. */
export function SalesOrdersView({ vocabulary, rpc, onNavigate }: SalesOrdersViewProps) {
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState('all');

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
          {o.channelId ?? (o.orderKind === 'pos_sale' ? 'POS Sucursal' : 'Wholesale')}
        </span>
      ),
    },
    {
      id: 'net',
      header: 'Total (neto)',
      align: 'right',
      sortValue: (o) => o.netSubtotalMinor,
      cell: (o) => (
        <span className="font-mono tabular-nums">{formatMinorUnits(o.netSubtotalMinor, o.currency)}</span>
      ),
    },
    {
      id: 'gross',
      header: 'Total (bruto)',
      align: 'right',
      sortValue: (o) => o.grandTotalMinor,
      cell: (o) => (
        <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(o.grandTotalMinor, o.currency)}</span>
      ),
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
        o.status,
        o.currency,
        o.netSubtotalMinor,
        o.grandTotalMinor,
      ]),
    );
  }

  return (
    <section className="space-y-5" data-slot="sales-orders-view">
      <PageHeader
        title="Órdenes de Venta"
        description={`Revisa documentos con contexto de ${vocabulary.partySingular.toLowerCase()}, totales neto/bruto y canales de cobro.`}
        onRefresh={() => void ordersQuery.refetch()}
        refreshing={ordersQuery.isFetching}
        actions={
          <>
            <SavedViewsBar
              views={[
                { id: 'all', label: 'Todas las órdenes' },
                { id: 'fulfilled', label: 'Completadas' },
                { id: 'pending', label: 'Pendientes' },
                { id: 'pos', label: 'Mostrador POS' },
              ]}
              activeViewId={activeView}
              onSelectView={setActiveView}
              onExport={handleExportCsv}
            />
            <button
              type="button"
              onClick={() => onNavigate('/pos')}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs hover:bg-primary-hover"
            >
              <Plus className="size-3.5" />
              <span>Crear documento</span>
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Documentos" value={summary?.totalCount ?? allItems.length} loading={ordersQuery.isLoading} />
        <KpiCard title="Facturación Bruta" value={formatMinorUnits(summary?.grossRevenueMinor ?? 0, 'USD')} loading={ordersQuery.isLoading} />
        <KpiCard title="Fulfilled" value={summary?.fulfilledCount ?? 0} loading={ordersQuery.isLoading} />
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
        emptyDescription="Emite la primera venta desde POS para ver el historial comercial completo."
        emptyActionLabel="Ir a Caja POS"
        onEmptyAction={() => onNavigate('/pos')}
        rowActions={() => [
          { id: 'pos', label: 'Nueva venta en POS', onSelect: () => onNavigate('/pos') },
          { id: 'wms', label: 'Ver picking WMS', onSelect: () => onNavigate('/wms') },
        ]}
      />
    </section>
  );
}
