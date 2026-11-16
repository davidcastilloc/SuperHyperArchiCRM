import { useQuery } from '@tanstack/react-query';
import { EmptyState, KpiCard } from '@shac/ui';
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

/** Open Mercato-style 3-column operational Dashboard widget grid. */
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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Resumen operativo de {vocabulary.branchSingular} y accesos directos a tus registros recientes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('/pos')}
            className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
          >
            Abrir POS (F2)
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/app-store')}
            className="h-9 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted"
          >
            Personalizar
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          title={`Total ${vocabulary.partyPlural}`}
          value={partiesQuery.data?.total ?? parties.length}
          loading={partiesQuery.isLoading}
        />
        <KpiCard
          title="Oportunidades Abiertas"
          value={formatMinorUnits(dealsSummary?.openValueMinor ?? 0, 'USD')}
          loading={dealsQuery.isLoading}
        />
        <KpiCard
          title="Productos en Catálogo"
          value={productsQuery.data?.total ?? products.length}
          loading={productsQuery.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Nuevos {vocabulary.partyPlural}</h2>
              <p className="text-xs text-muted-foreground">
                Últimos registros agregados para seguimiento rápido.
              </p>
            </div>
            <button
              type="button"
              aria-label="Actualizar clientes"
              onClick={() => void partiesQuery.refetch()}
              className="h-7 w-7 shrink-0 rounded border border-border text-xs hover:bg-muted"
            >
              ↻
            </button>
          </div>

          {parties.length === 0 ? (
            <EmptyState size="sm" title={`Sin ${vocabulary.partyPlural.toLowerCase()}`} actionLabel="Ir a Clientes" onAction={() => onNavigate('/parties')} />
          ) : (
            <div className="space-y-2">
              {parties.map((party) => (
                <div key={party.id} className="rounded-lg border border-border bg-background p-3 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium truncate">{party.displayName}</p>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatEpochDate(party.createdAt)}</span>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">{party.rolesMask.join(', ')}</p>
                  <button
                    type="button"
                    onClick={() => onNavigate('/parties')}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Ver registro
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Nuevas Oportunidades (Deals)</h2>
              <p className="text-xs text-muted-foreground">
                Negociaciones activas y valor estimado del pipeline.
              </p>
            </div>
            <button
              type="button"
              aria-label="Actualizar deals"
              onClick={() => void dealsQuery.refetch()}
              className="h-7 w-7 shrink-0 rounded border border-border text-xs hover:bg-muted"
            >
              ↻
            </button>
          </div>

          {deals.length === 0 ? (
            <EmptyState size="sm" title="Sin oportunidades aún" actionLabel="Crear Deal en CRM" onAction={() => onNavigate('/parties')} />
          ) : (
            <div className="space-y-2">
              {deals.map((deal) => (
                <div key={deal.id} className="rounded-lg border border-border bg-background p-3 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium truncate">{deal.title}</p>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatEpochDate(deal.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {deal.partyName ?? deal.partyId} · <span className="font-mono">{deal.outcome}</span> ·{' '}
                    <span className="font-mono font-medium text-foreground">{formatMinorUnits(deal.valueMinor, deal.currency)}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('/parties')}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Ver registro
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Catálogo y Mostrador</h2>
              <p className="text-xs text-muted-foreground">
                Productos listos para SmartCheck 10s y cobro en POS.
              </p>
            </div>
            <button
              type="button"
              aria-label="Actualizar productos"
              onClick={() => void productsQuery.refetch()}
              className="h-7 w-7 shrink-0 rounded border border-border text-xs hover:bg-muted"
            >
              ↻
            </button>
          </div>

          {products.length === 0 ? (
            <EmptyState size="sm" title="Sin productos" actionLabel="Ir a Catálogo" onAction={() => onNavigate('/catalog')} />
          ) : (
            <div className="space-y-2">
              {products.map((prod) => (
                <div key={prod.id} className="rounded-lg border border-border bg-background p-3 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium truncate">{prod.name}</p>
                    <span className="shrink-0 font-mono text-xs font-semibold tabular-nums">
                      {formatMinorUnits(prod.basePriceMinor, prod.primaryCurrency)}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">{prod.sku}</p>
                  <button
                    type="button"
                    onClick={() => onNavigate('/catalog')}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Ver registro
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
