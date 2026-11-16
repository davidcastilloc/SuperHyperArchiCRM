import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMinorUnits, INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** 10-second auto-closing SmartCheck dual-currency price verifier kiosk. */
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
    <section className="mx-auto max-w-xl space-y-4 p-6" data-slot="smartcheck-kiosk-view">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SmartCheck Kiosco (10s)</h1>
        <p className="text-sm text-muted-foreground">
          Verificador táctil de precios con impuestos en {vocabulary.branchSingular}.
        </p>
      </div>

      <form onSubmit={handleScan} className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Escanea SKU o código de producto..."
          className={`${INPUT_CLS} h-12 flex-1 font-mono text-base`}
        />
        <button
          type="submit"
          disabled={checkMutation.isPending || !code.trim()}
          className="h-12 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Consultar
        </button>
      </form>

      {quickProducts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {quickProducts.map((prod) => (
            <button
              key={prod.id}
              type="button"
              onClick={() => {
                setCode(prod.sku);
                checkMutation.mutate(prod.sku);
              }}
              className="min-h-10 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              <span className="font-mono text-muted-foreground">{prod.sku}</span> · {prod.name}
            </button>
          ))}
        </div>
      ) : null}

      {checkMutation.isError ? (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {checkMutation.error.message}
        </p>
      ) : null}

      {item && secondsLeft > 0 ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-lg font-semibold">{item.name}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {item.sku} · {item.presentationName}
              </p>
            </div>
            <span className="rounded bg-muted px-2 py-1 font-mono text-xs tabular-nums">
              Cierra en {secondsLeft}s
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Precio IVA incluido</p>
              <p className="font-mono text-2xl font-bold tabular-nums">
                {formatMinorUnits(item.unitPriceInclTaxMinor, item.primaryCurrency)}
              </p>
            </div>
            {item.secondaryUnitPriceInclTaxMinor !== null && item.secondaryCurrency ? (
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Referencia {item.secondaryCurrency}</p>
                <p className="font-mono text-2xl font-bold tabular-nums">
                  {formatMinorUnits(item.secondaryUnitPriceInclTaxMinor, item.secondaryCurrency)}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
