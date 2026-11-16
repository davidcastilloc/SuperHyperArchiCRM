import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Coins, PackagePlus, Plus } from 'lucide-react';
import { DataTable, FilterBar, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import {
  formatMinorUnits,
  INPUT_CLS,
  parseNonNegInt,
  readApiError,
  type Phase2ViewProps,
} from './phase2-format';

/** Open Mercato DS v3 Catalog, BCV exchange rate, 5-layer pricing quote, and FEFO receipt. */
export function CatalogView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [basePriceMinor, setBasePriceMinor] = useState('1000');
  const [costPriceMinor, setCostPriceMinor] = useState('700');
  const [rateMicros, setRateMicros] = useState('54750000');
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
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setSku('');
      setName('');
      setShowCreate(false);
      setFeedback(`Producto ${data.product.sku} creado (${data.product.id})`);
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
    },
    onError: (err) => setFeedback(err.message),
  });

  const rateMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.catalog.rates.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          fromCurrency: 'USD',
          toCurrency: 'VES',
          rateMicros: Math.max(1, parseNonNegInt(rateMicros, 54_750_000)),
          source: 'BCV',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => setFeedback(`Tasa USD a VES actualizada (${rateMicros} micros)`),
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
          <button
            type="button"
            onClick={() => setShowCreate((prev) => !prev)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs hover:bg-primary-hover"
          >
            <Plus className="size-3.5" />
            <span>{showCreate ? 'Cerrar formulario' : 'Nuevo Producto'}</span>
          </button>
        }
      />

      {showCreate ? (
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-5">
          <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" className={`${INPUT_CLS} font-mono`} />
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del producto" className={`${INPUT_CLS} md:col-span-2`} />
          <input type="number" min={0} step={1} value={basePriceMinor} onChange={(e) => setBasePriceMinor(e.target.value)} placeholder="Precio minor" className={`${INPUT_CLS} font-mono tabular-nums`} />
          <div className="flex gap-2">
            <input type="number" min={0} step={1} value={costPriceMinor} onChange={(e) => setCostPriceMinor(e.target.value)} placeholder="Costo minor" className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
            <button type="submit" disabled={createMutation.isPending || !sku.trim() || !name.trim()} className="h-9 shrink-0 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
              Guardar
            </button>
          </div>
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
            <input
              type="number"
              min={1}
              step={1}
              value={rateMicros}
              onChange={(e) => setRateMicros(e.target.value)}
              aria-label="Tasa USD a VES en micros"
              className={`${INPUT_CLS} w-36 font-mono tabular-nums`}
            />
            <button
              type="button"
              disabled={rateMutation.isPending}
              onClick={() => rateMutation.mutate()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted disabled:opacity-50"
            >
              <Coins className="size-3.5 text-muted-foreground" />
              <span>Fijar Tasa BCV</span>
            </button>
          </div>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        getRowId={(p) => p.id}
        loading={productsQuery.isLoading}
        emptyTitle="Sin productos en catálogo"
        emptyDescription="Registra el primer SKU para habilitar SmartCheck y POS."
        emptyActionLabel="Nuevo Producto"
        onEmptyAction={() => setShowCreate(true)}
        rowActions={(p) => [
          { id: 'stock', label: 'Consultar saldo FEFO', onSelect: () => stockMutation.mutate(p.id) },
          { id: 'quote', label: 'Cotizar 5 capas', onSelect: () => quoteMutation.mutate(p.id) },
        ]}
      />
    </section>
  );
}
