import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Clock, ScanBarcode, Search, Tag } from 'lucide-react';
import { PageHeader, StatusBadge } from '@shac/ui';
import { formatMinorUnits, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 10-second auto-closing SmartCheck dual-currency price verifier. */
export function SmartCheckKioskView({ vocabulary, rpc }: Phase2ViewProps) {
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);

  const productsQuery = useQuery({
    queryKey: ['catalog', 'products', 'smartcheck-chips'],
    queryFn: async () => {
      const res = await rpc.api.catalog.products.$get({ query: { limit: '12' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const checkMutation = useMutation({
    mutationFn: async (lookupCode: string) => {
      const res = await rpc.api.pos.kiosk.smartcheck.$get({
        query: { code: lookupCode, secondaryCurrency: 'VES' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setSecondsLeft(data.autoCloseSeconds);
    },
  });

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          checkMutation.reset();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft, checkMutation]);

  function handleScan(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || checkMutation.isPending) return;
    checkMutation.mutate(trimmed);
  }

  const item = checkMutation.data;
  const quickProducts = productsQuery.data?.items ?? [];

  return (
    <section className="mx-auto max-w-3xl space-y-5" data-slot="smartcheck-kiosk-view">
      <PageHeader
        title="SmartCheck Kiosco (10s)"
        description={`Verificador táctil multimoneda con impuestos incluidos en ${vocabulary.branchSingular}.`}
        onRefresh={() => void productsQuery.refetch()}
        refreshing={productsQuery.isFetching}
      />

      <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-5">
        <form onSubmit={handleScan} className="flex flex-col gap-2.5 sm:flex-row">
          <div className="relative flex-1">
            <ScanBarcode className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Escanea SKU o código de barras..."
              className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 font-mono text-sm shadow-xs placeholder:font-sans placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <button
            type="submit"
            disabled={checkMutation.isPending || !code.trim()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover disabled:opacity-45"
          >
            <Search className="size-4" />
            <span>{checkMutation.isPending ? 'Consultando...' : 'Consultar'}</span>
          </button>
        </form>

        {checkMutation.isError ? (
          <div className="rounded-lg border border-status-error-border bg-status-error-bg px-3.5 py-2.5 text-xs font-medium text-status-error-text">
            {checkMutation.error.message}
          </div>
        ) : null}

        {item && secondsLeft > 0 ? (
          <div className="space-y-4 border-t border-border pt-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-0.5">
                <h2 className="text-lg font-semibold tracking-tight">{item.name}</h2>
                <p className="font-mono text-xs text-muted-foreground">
                  {item.sku} · {item.presentationName}
                </p>
              </div>
              <StatusBadge
                label={`Auto-cierre en ${secondsLeft}s`}
                tone="info"
                icon={<Clock className="size-3" />}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-border/70 pt-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-overline font-medium uppercase text-muted-foreground">Precio IVA incluido</p>
                <p className="font-mono text-3xl font-semibold tracking-tight tabular-nums">
                  {formatMinorUnits(item.unitPriceInclTaxMinor, item.primaryCurrency)}
                </p>
              </div>
              {item.secondaryUnitPriceInclTaxMinor !== null && item.secondaryCurrency ? (
                <div className="space-y-1 sm:border-l sm:border-border/70 sm:pl-4">
                  <p className="text-overline font-medium uppercase text-muted-foreground">
                    Referencia {item.secondaryCurrency}
                  </p>
                  <p className="font-mono text-3xl font-semibold tracking-tight text-muted-foreground tabular-nums">
                    {formatMinorUnits(item.secondaryUnitPriceInclTaxMinor, item.secondaryCurrency)}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {quickProducts.length > 0 ? (
          <div className="space-y-2.5 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Tag className="size-3.5" />
                <span>Acceso rápido a SKUs activos</span>
              </span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {quickProducts.length} ítems
              </span>
            </div>
            <div className="divide-y divide-border/70 rounded-lg border border-border">
              {quickProducts.map((prod) => (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => {
                    setCode(prod.sku);
                    checkMutation.mutate(prod.sku);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {prod.sku}
                    </span>
                    <span className="truncate font-medium">{prod.name}</span>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-medium text-muted-foreground tabular-nums">
                    {formatMinorUnits(prod.basePriceMinor, prod.primaryCurrency)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
