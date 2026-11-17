import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Coins, PackagePlus, Plus } from 'lucide-react';
import { DataTable, FilterBar, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { useMarketVocabulary } from '../lib/marketProfile';
import { CustomFieldsSection } from './CustomFieldsSection';
import {
  formatMinorUnits,
  INPUT_CLS,
  parseMajorToMinor,
  parseRateToMicros,
  readApiError,
  type Phase2ViewProps,
} from './phase2-format';

/** Open Mercato DS v3 Catalog, BCV exchange rate (decimal), 5-layer pricing quote, and FEFO receipt. */
export function CatalogView({ rpc }: Phase2ViewProps) {
  const vocabulary = useMarketVocabulary();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [basePriceMajor, setBasePriceMajor] = useState('10.00');
  const [costPriceMajor, setCostPriceMajor] = useState('7.00');
  const [customAttrs, setCustomAttrs] = useState<Record<string, string | number | boolean>>({});
  const [rateDecimal, setRateDecimal] = useState('54.75');
  const [feedback, setFeedback] = useState<string | null>(null);

  const productsQuery = useQuery({
    queryKey: ['catalog', 'products', search],
    queryFn: async () => {
      const trimmed = search.trim();
      const res = await rpc.api.catalog.products.$get({
        query: trimmed ? { limit: '50', search: trimmed } : { limit: '50' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const categoriesQuery = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: async () => {
      const res = await rpc.api.catalog.categories.$get();
      if (!res.ok) return { items: [] as Array<{ id: string; code: string; name: string; kind: string }> };
      return res.json();
    },
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.catalog.products.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          sku: sku.trim(),
          name: name.trim(),
          categoryId: categoryId || undefined,
          basePriceMinor: parseMajorToMinor(basePriceMajor),
          costPriceMinor: parseMajorToMinor(costPriceMajor),
          primaryCurrency: 'USD',
          ...(Object.keys(customAttrs).length > 0 ? { customAttributes: customAttrs } : {}),
        } as never,
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setSku('');
      setName('');
      setCustomAttrs({});
      setShowCreate(false);
      setFeedback(`Producto ${data.product.sku} creado (${data.product.id})`);
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
    },
    onError: (err) => setFeedback(err.message),
  });

  const rateMutation = useMutation({
    mutationFn: async () => {
      const rateMicros = Math.max(1, parseRateToMicros(rateDecimal));
      const res = await rpc.api.catalog.rates.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          fromCurrency: 'USD',
          toCurrency: 'VES',
          rateMicros,
          source: 'BCV',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => setFeedback(`Tasa USD a VES actualizada (${rateDecimal} Bs/USD)`),
    onError: (err) => setFeedback(err.message),
  });

  const quoteMutation = useMutation({
    mutationFn: async (productId: string) => {
      const res = await rpc.api.catalog.pricing.quote.$post({
        json: { productId, qty: 1, secondaryCurrency: 'VES' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onError: (err) => setFeedback(err.message),
  });

  const stockMutation = useMutation({
    mutationFn: async (productId: string) => {
      const res = await rpc.api.branch.inventory.balances.$get({ query: { productId } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onError: (err) => setFeedback(err.message),
  });

  const receiveLotMutation = useMutation({
    mutationFn: async (prod: { id: string; sku: string; costPriceMinor: number }) => {
      const res = await rpc.api.branch.inventory['receive-lot'].$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          productId: prod.id,
          lotCode: `LOT-${prod.sku}-${Math.floor(Date.now() / 1000)}`,
          qty: 10,
          unitCostMinor: prod.costPriceMinor,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      setFeedback(`+10 unidades recibidas en ${vocabulary.branchSingular} para ${vars.sku}`);
      stockMutation.mutate(vars.id);
    },
    onError: (err) => setFeedback(err.message),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !name.trim() || createMutation.isPending) return;
    createMutation.mutate();
  }

  const categories = (categoriesQuery.data?.items ?? []).filter((c) => c.kind === 'product_category');
  const items = productsQuery.data?.items ?? [];
  type ProductRow = (typeof items)[number];
  const columns: DataTableColumn<ProductRow>[] = [
    {
      id: 'sku',
      header: 'SKU',
      sortValue: (p) => p.sku,
      cell: (p) => <span className="font-mono text-xs font-medium">{p.sku}</span>,
    },
    {
      id: 'name',
      header: 'Producto / Servicio',
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="space-y-0.5">
          <p className="font-medium">{p.name}</p>
          <StatusBadge label="Publicado" tone="success" appearance="dot" />
        </div>
      ),
    },
    {
      id: 'price',
      header: 'Precio Base',
      align: 'right',
      sortValue: (p) => p.basePriceMinor,
      cell: (p) => (
        <span className="font-mono font-medium tabular-nums">
          {formatMinorUnits(p.basePriceMinor, p.primaryCurrency)}
        </span>
      ),
    },
    {
      id: 'quick',
      header: 'Operación Rápida',
      align: 'right',
      cell: (p) => (
        <div className="inline-flex flex-wrap justify-end gap-1.5">
          <button type="button" onClick={() => quoteMutation.mutate(p.id)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-muted">
            <Calculator className="size-3 text-muted-foreground" />
            <span>Cotizar</span>
          </button>
          <button
            type="button"
            disabled={receiveLotMutation.isPending}
            onClick={() => receiveLotMutation.mutate({ id: p.id, sku: p.sku, costPriceMinor: p.costPriceMinor })}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <PackagePlus className="size-3 text-muted-foreground" />
            <span>+10 Stock</span>
          </button>
        </div>
      ),
    },
  ];

  return (
    <section className="space-y-5" data-slot="catalog-view">
      <PageHeader
        title="Productos y Tarifas"
        description={`Catálogo maestro 5-capas, tasas BCV y saldo FEFO en ${vocabulary.branchSingular}.`}
        onRefresh={() => void productsQuery.refetch()}
        refreshing={productsQuery.isFetching}
        actions={
          <button type="button" onClick={() => setShowCreate((prev) => !prev)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs hover:bg-primary-hover">
            <Plus className="size-3.5" /><span>{showCreate ? 'Cerrar formulario' : 'Nuevo Producto'}</span>
          </button>
        }
      />

      {showCreate ? (
        <form onSubmit={handleCreate} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-6">
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">SKU / Código</span><input type="text" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU-001" className={`${INPUT_CLS} w-full font-mono`} /></label>
          <label className="space-y-1 text-xs md:col-span-2"><span className="font-medium text-muted-foreground">Nombre del Producto / Servicio</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre comercial" className={`${INPUT_CLS} w-full`} /></label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Categoría</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${INPUT_CLS} w-full`}>
              <option value="">General</option>
              {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Precio Base (USD)</span><input type="text" value={basePriceMajor} onChange={(e) => setBasePriceMajor(e.target.value)} placeholder="10.00" className={`${INPUT_CLS} w-full font-mono tabular-nums`} /></label>
          <div className="flex items-end gap-2">
            <label className="flex-1 space-y-1 text-xs"><span className="font-medium text-muted-foreground">Costo (USD)</span><input type="text" value={costPriceMajor} onChange={(e) => setCostPriceMajor(e.target.value)} placeholder="7.00" className={`${INPUT_CLS} w-full font-mono tabular-nums`} /></label>
            <button type="submit" disabled={createMutation.isPending || !sku.trim() || !name.trim()} className="h-9 shrink-0 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground disabled:opacity-50">Guardar</button>
          </div>
          <div className="md:col-span-6"><CustomFieldsSection rpc={rpc} targetEntity="cat_products" values={customAttrs} onChange={setCustomAttrs} /></div>
        </form>
      ) : null}

      {feedback ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p> : null}

      {quoteMutation.data ? (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs">
          Cotización ({quoteMutation.data.appliedLayer}): {formatMinorUnits(quoteMutation.data.unitPriceWithTaxMinor, quoteMutation.data.primaryCurrency)}
          {quoteMutation.data.secondaryUnitPriceWithTaxMinor !== null && quoteMutation.data.secondaryCurrency
            ? ` · ${formatMinorUnits(quoteMutation.data.secondaryUnitPriceWithTaxMinor, quoteMutation.data.secondaryCurrency)}`
            : ''}
        </p>
      ) : null}

      {stockMutation.data ? (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs">
          {vocabulary.branchSingular} FEFO ({stockMutation.data.productId ?? 'ALL'}): disponible={stockMutation.data.totalAvailableQty} · en_mano={stockMutation.data.totalOnHandQty}
        </p>
      ) : null}

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por SKU o nombre..."
        trailingItems={
          <div className="flex items-center gap-2">
            <label htmlFor="cat-fx-rate" className="text-xs font-medium text-muted-foreground">Tasa (Bs/USD)</label>
            <input id="cat-fx-rate" type="text" value={rateDecimal} onChange={(e) => setRateDecimal(e.target.value)} className={`${INPUT_CLS} w-24 font-mono tabular-nums`} />
            <button type="button" disabled={rateMutation.isPending} onClick={() => rateMutation.mutate()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted disabled:opacity-50">
              <Coins className="size-3.5 text-muted-foreground" /><span>Fijar Tasa BCV</span>
            </button>
          </div>
        }
      />

      <DataTable
        columns={columns} data={items} getRowId={(p) => p.id} loading={productsQuery.isLoading}
        emptyTitle="Sin productos en catálogo" emptyDescription="Registra el primer SKU para habilitar SmartCheck y POS."
        emptyActionLabel="Nuevo Producto" onEmptyAction={() => setShowCreate(true)}
        rowActions={(p) => [
          { id: 'stock', label: 'Consultar saldo FEFO', onSelect: () => stockMutation.mutate(p.id) },
          { id: 'quote', label: 'Cotizar 5 capas', onSelect: () => quoteMutation.mutate(p.id) },
        ]}
      />
    </section>
  );
}
