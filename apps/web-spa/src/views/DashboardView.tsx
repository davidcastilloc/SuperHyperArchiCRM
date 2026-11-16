import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ReceiptText, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { EmptyState, KpiCard, StatusBadge } from '@shac/ui';
import { formatMinorUnits, readApiError, type Phase2ViewProps } from './phase2-format';

interface DashboardViewProps extends Phase2ViewProps {
  onNavigate: (href: string) => void;
}

function formatEpochDate(epochSec: number): string {
  try {
    return new Date(epochSec * 1000).toLocaleDateString('es', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function outcomeTone(outcome: string): 'success' | 'warning' | 'error' | 'info' {
  if (outcome === 'won' || outcome === 'win') return 'success';
  if (outcome === 'lost') return 'error';
  if (outcome === 'open') return 'info';
  return 'warning';
}

/** Open Mercato DS v3 3-column operational Dashboard widget grid. */
export function DashboardView({ vocabulary, rpc, onNavigate }: DashboardViewProps) {
  const partiesQuery = useQuery({
    queryKey: ['dashboard', 'parties'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '5' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const dealsQuery = useQuery({
    queryKey: ['dashboard', 'deals'],
    queryFn: async () => {
      const res = await rpc.api.customers.deals.$get({ query: { limit: '5' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const productsQuery = useQuery({
    queryKey: ['dashboard', 'products'],
    queryFn: async () => {
      const res = await rpc.api.catalog.products.$get({ query: { limit: '5' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const parties = partiesQuery.data?.items ?? [];
  const deals = dealsQuery.data?.items ?? [];
  const products = productsQuery.data?.items ?? [];
  const dealsSummary = dealsQuery.data?.summary;

  return (
    <section className="space-y-6" data-slot="dashboard-view">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Organiza y monitorea los indicadores de {vocabulary.branchSingular} y tus registros recientes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('/app-store')}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs transition-colors hover:bg-muted"
          >
            <SlidersHorizontal className="size-3.5 text-muted-foreground" />
            <span>Personalizar</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/pos')}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
          >
            <ReceiptText className="size-3.5" />
            <span>Abrir POS (F2)</span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          title={`Total ${vocabulary.partyPlural}`}
          value={partiesQuery.data?.total ?? parties.length}
          loading={partiesQuery.isLoading}
          comparisonLabel="Directorio activo en sucursal"
        />
        <KpiCard
          title="Pipeline Abierto"
          value={formatMinorUnits(dealsSummary?.openValueMinor ?? 0, 'USD')}
          loading={dealsQuery.isLoading}
          trend={{ value: 100, direction: 'up' }}
          comparisonLabel="Oportunidades en negociación"
        />
        <KpiCard
          title="Catálogo & Mostrador"
          value={productsQuery.data?.total ?? products.length}
          loading={productsQuery.isLoading}
          comparisonLabel="SKUs listos para SmartCheck y POS"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col rounded-xl border border-border bg-card shadow-xs">
          <div className="flex items-start justify-between gap-2 border-b border-border/70 p-4">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold tracking-tight">Nuevos {vocabulary.partyPlural}</h2>
              <p className="text-xs text-muted-foreground">
                Últimos registros agregados para seguimiento inmediato.
              </p>
            </div>
            <button
              type="button"
              aria-label="Actualizar clientes"
              onClick={() => void partiesQuery.refetch()}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className={`size-3.5 ${partiesQuery.isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {parties.length === 0 ? (
            <div className="p-4">
              <EmptyState size="sm" title={`Sin ${vocabulary.partyPlural.toLowerCase()}`} actionLabel="Ir a Clientes" onAction={() => onNavigate('/parties')} />
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {parties.map((party) => (
                <div key={party.id} className="space-y-1.5 px-4 py-3.5 transition-colors hover:bg-muted/35">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium">{party.displayName}</p>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{formatEpochDate(party.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{party.rolesMask.join(', ')}</p>
                  <button
                    type="button"
                    onClick={() => onNavigate('/parties')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
                  >
                    <span>Ver registro</span>
                    <ArrowUpRight className="size-3 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col rounded-xl border border-border bg-card shadow-xs">
          <div className="flex items-start justify-between gap-2 border-b border-border/70 p-4">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold tracking-tight">Nuevas Oportunidades</h2>
              <p className="text-xs text-muted-foreground">
                Negociaciones activas y valor estimado del pipeline comercial.
              </p>
            </div>
            <button
              type="button"
              aria-label="Actualizar deals"
              onClick={() => void dealsQuery.refetch()}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className={`size-3.5 ${dealsQuery.isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {deals.length === 0 ? (
            <div className="p-4">
              <EmptyState size="sm" title="Sin oportunidades aún" actionLabel="Crear Deal en CRM" onAction={() => onNavigate('/parties')} />
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {deals.map((deal) => (
                <div key={deal.id} className="space-y-1.5 px-4 py-3.5 transition-colors hover:bg-muted/35">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium">{deal.title}</p>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{formatEpochDate(deal.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge label={deal.outcome} tone={outcomeTone(deal.outcome)} appearance="dot" />
                    <span className="font-mono text-xs font-medium tabular-nums">{formatMinorUnits(deal.valueMinor, deal.currency)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('/parties')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
                  >
                    <span>Ver registro</span>
                    <ArrowUpRight className="size-3 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col rounded-xl border border-border bg-card shadow-xs">
          <div className="flex items-start justify-between gap-2 border-b border-border/70 p-4">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold tracking-tight">Catálogo Activo</h2>
              <p className="text-xs text-muted-foreground">
                Productos disponibles para consulta rápida y facturación.
              </p>
            </div>
            <button
              type="button"
              aria-label="Actualizar productos"
              onClick={() => void productsQuery.refetch()}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className={`size-3.5 ${productsQuery.isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {products.length === 0 ? (
            <div className="p-4">
              <EmptyState size="sm" title="Sin productos" actionLabel="Ir a Catálogo" onAction={() => onNavigate('/catalog')} />
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {products.map((prod) => (
                <div key={prod.id} className="space-y-1.5 px-4 py-3.5 transition-colors hover:bg-muted/35">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium">{prod.name}</p>
                    <span className="shrink-0 font-mono text-xs font-semibold tabular-nums">
                      {formatMinorUnits(prod.basePriceMinor, prod.primaryCurrency)}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">{prod.sku}</p>
                  <button
                    type="button"
                    onClick={() => onNavigate('/catalog')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
                  >
                    <span>Ver registro</span>
                    <ArrowUpRight className="size-3 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
