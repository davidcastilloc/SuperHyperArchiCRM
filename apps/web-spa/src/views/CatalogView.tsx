import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatMinorUnits,
  INPUT_CLS,
  parseNonNegInt,
  type Phase2ViewProps,
} from './phase2-format';

/** Universal Catalog, 5-layer pricing quote, and BranchInventoryDO balance view. */
export function CatalogView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [basePriceMinor, setBasePriceMinor] = useState('1000');
  const [costPriceMinor, setCostPriceMinor] = useState('700');

  const productsQuery = useQuery({
    queryKey: ['catalog', 'products', search],
    queryFn: async () => {
      const trimmed = search.trim();
      const res = await rpc.api.catalog.products.$get({
        query: trimmed ? { limit: '50', search: trimmed } : { limit: '50' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.catalog.products.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          sku: sku.trim(),
          name: name.trim(),
          basePriceMinor: parseNonNegInt(basePriceMinor, 0),
          costPriceMinor: parseNonNegInt(costPriceMinor, 0),
          primaryCurrency: 'USD',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      setSku('');
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
    },
  });

  const quoteMutation = useMutation({
    mutationFn: async (productId: string) => {
      const res = await rpc.api.catalog.pricing.quote.$post({
        json: { productId, qty: 1, secondaryCurrency: 'VES' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const stockMutation = useMutation({
    mutationFn: async (productId: string) => {
      const res = await rpc.api.branch.inventory.balances.$get({
        query: { productId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !name.trim() || createMutation.isPending) return;
    createMutation.mutate();
  }

  const items = productsQuery.data?.items ?? [];

  return (
    <section className="space-y-4 p-4" data-slot="catalog-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Catálogo y Precios 5-Capas</h1>
          <p className="text-sm text-muted-foreground">
            Precios enteros (minor units), tasas BCV y saldo FEFO en {vocabulary.branchSingular}.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar SKU o producto..."
          className={INPUT_CLS}
        />
      </div>

      <form onSubmit={handleCreate} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-5">
        <input
          type="text"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder="SKU"
          className={`${INPUT_CLS} font-mono`}
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del producto"
          className={`${INPUT_CLS} md:col-span-2`}
        />
        <input
          type="number"
          min={0}
          step={1}
          value={basePriceMinor}
          onChange={(e) => setBasePriceMinor(e.target.value)}
          placeholder="Precio minor"
          className={`${INPUT_CLS} font-mono tabular-nums`}
        />
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step={1}
            value={costPriceMinor}
            onChange={(e) => setCostPriceMinor(e.target.value)}
            placeholder="Costo minor"
            className={`${INPUT_CLS} w-full font-mono tabular-nums`}
          />
          <button
            type="submit"
            disabled={createMutation.isPending || !sku.trim() || !name.trim()}
            className="h-9 shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Crear
          </button>
        </div>
      </form>

      {quoteMutation.data ? (
        <div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-mono">
          Cotización ({quoteMutation.data.appliedLayer}):{' '}
          {formatMinorUnits(quoteMutation.data.unitPriceWithTaxMinor, quoteMutation.data.primaryCurrency)}
          {quoteMutation.data.secondaryUnitPriceWithTaxMinor !== null && quoteMutation.data.secondaryCurrency
            ? ` · ${formatMinorUnits(quoteMutation.data.secondaryUnitPriceWithTaxMinor, quoteMutation.data.secondaryCurrency)}`
            : ''}
        </div>
      ) : null}

      {stockMutation.data ? (
        <div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-mono">
          {vocabulary.branchSingular} FEFO ({stockMutation.data.productId ?? 'ALL'}):{' '}
          disponible={stockMutation.data.totalAvailableQty} · en_mano={stockMutation.data.totalOnHandQty}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Precio Base</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Sin productos visibles.
                </td>
              </tr>
            ) : (
              items.map((prod) => (
                <tr key={prod.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{prod.sku}</td>
                  <td className="px-3 py-2 font-medium">{prod.name}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {formatMinorUnits(prod.basePriceMinor, prod.primaryCurrency)}
                  </td>
                  <td className="px-3 py-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => quoteMutation.mutate(prod.id)}
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Cotizar
                    </button>
                    <button
                      type="button"
                      onClick={() => stockMutation.mutate(prod.id)}
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Stock
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
