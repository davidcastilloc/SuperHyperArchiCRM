import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderTree, Layers, Plus } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Catalog Categories, Dictionaries & Product Variants view. */
export function CatalogStructureView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'categories' | 'variants'>('categories');
  const [code, setCode] = useState('CAT-BEV');
  const [name, setName] = useState('Bebidas & Café');
  const [kind, setKind] = useState<'product_category' | 'dictionary' | 'brand'>('product_category');
  const [productId, setProductId] = useState('');
  const [varSku, setVarSku] = useState('');
  const [varBarcode, setVarBarcode] = useState('');
  const [presName, setPresName] = useState('Caja x 12');
  const [overrideMajor, setOverrideMajor] = useState('15.00');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const catsQuery = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: async () => {
      const res = await rpc.api.catalog.categories.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const varsQuery = useQuery({
    queryKey: ['catalog', 'variants'],
    queryFn: async () => {
      const res = await rpc.api.catalog.variants.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const prodsQuery = useQuery({
    queryKey: ['catalog', 'products', 'struct-select'],
    queryFn: async () => {
      const res = await rpc.api.catalog.products.$get({ query: { limit: '100' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const addCatMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.catalog.categories.$post({ json: { kind, code: code.trim(), name: name.trim() } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'categories'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const addVarMutation = useMutation({
    mutationFn: async () => {
      const targetProd = productId || prodsQuery.data?.items[0]?.id || '';
      const res = await rpc.api.catalog.variants.$post({
        json: {
          productId: targetProd,
          sku: varSku.trim(),
          barcode: varBarcode.trim() || undefined,
          presentationName: presName.trim(),
          overridePriceMinor: parseMajorToMinor(overrideMajor),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      setVarSku('');
      setVarBarcode('');
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'variants'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const cats = catsQuery.data?.items ?? [];
  const vars = varsQuery.data?.items ?? [];
  const prods = prodsQuery.data?.items ?? [];
  const prodMap = new Map(prods.map((p) => [p.id, `${p.sku} · ${p.name}`]));
  type CatRow = (typeof cats)[number];
  type VarRow = (typeof vars)[number];

  const catCols: DataTableColumn<CatRow>[] = [
    { id: 'code', header: 'Código', cell: (c) => <span className="font-mono text-xs font-medium">{c.code}</span> },
    { id: 'name', header: 'Nombre', cell: (c) => <span className="font-medium">{c.name}</span> },
    { id: 'kind', header: 'Tipo', cell: (c) => <StatusBadge label={c.kind} tone="info" /> },
    { id: 'st', header: 'Estado', cell: (c) => <StatusBadge label={c.isActive ? 'Activa' : 'Inactiva'} tone={c.isActive ? 'success' : 'neutral'} appearance="dot" /> },
  ];
  const varCols: DataTableColumn<VarRow>[] = [
    { id: 'sku', header: 'SKU Variante', cell: (v) => <span className="font-mono text-xs font-medium">{v.sku}</span> },
    { id: 'pres', header: 'Presentación', cell: (v) => <span className="font-medium">{v.presentationName}</span> },
    { id: 'prod', header: 'Producto Padre', cell: (v) => <span className="text-xs text-muted-foreground">{prodMap.get(v.productId) ?? v.productId}</span> },
    { id: 'price', header: 'Precio Override', align: 'right', cell: (v) => <span className="font-mono tabular-nums">{v.overridePriceMinor !== null ? formatMinorUnits(v.overridePriceMinor, 'USD') : 'Base'}</span> },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (tab === 'categories' && code.trim() && name.trim()) addCatMutation.mutate();
    if (tab === 'variants' && varSku.trim()) addVarMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="catalog-structure-view">
      <PageHeader title="Categorías, Diccionarios & Variantes" description="Taxonomía de catálogo y presentaciones multi-empaque por SKU." />

      <div className="flex gap-4 border-b border-border">
        <button type="button" onClick={() => setTab('categories')} className={`inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium ${tab === 'categories' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'}`}>
          <FolderTree className="size-3.5" />
          <span>Categorías & Diccionarios ({cats.length})</span>
        </button>
        <button type="button" onClick={() => setTab('variants')} className={`inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium ${tab === 'variants' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'}`}>
          <Layers className="size-3.5" />
          <span>Variantes & Presentaciones ({vars.length})</span>
        </button>
      </div>

      {errorMsg ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-5">
        {tab === 'categories' ? (
          <>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Tipo</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as 'product_category' | 'dictionary' | 'brand')} className={`${INPUT_CLS} w-full`}>
                <option value="product_category">Categoría de Producto</option>
                <option value="dictionary">Diccionario</option>
                <option value="brand">Marca</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Código</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CAT-BEV" className={`${INPUT_CLS} w-full font-mono text-xs`} />
            </label>
            <label className="space-y-1 text-xs md:col-span-2">
              <span className="font-medium text-muted-foreground">Nombre</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" className={`${INPUT_CLS} w-full`} />
            </label>
            <button type="submit" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Guardar</span></button>
          </>
        ) : (
          <>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Producto Padre</span>
              <select value={productId || prods[0]?.id || ''} onChange={(e) => setProductId(e.target.value)} className={`${INPUT_CLS} w-full`}>
                {prods.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">SKU Variante</span>
              <input value={varSku} onChange={(e) => setVarSku(e.target.value)} placeholder="SKU Variante" className={`${INPUT_CLS} w-full font-mono text-xs`} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Código de Barras</span>
              <input value={varBarcode} onChange={(e) => setVarBarcode(e.target.value)} placeholder="EAN / GTIN" className={`${INPUT_CLS} w-full font-mono text-xs`} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Presentación</span>
              <input value={presName} onChange={(e) => setPresName(e.target.value)} placeholder="Caja x 12" className={`${INPUT_CLS} w-full`} />
            </label>
            <div className="flex items-end gap-2">
              <label className="flex-1 space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Precio (USD)</span>
                <input value={overrideMajor} onChange={(e) => setOverrideMajor(e.target.value)} placeholder="15.00" className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
              </label>
              <button type="submit" className="h-9 shrink-0 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Crear</button>
            </div>
          </>
        )}
      </form>

      {tab === 'categories' ? (
        <DataTable columns={catCols} data={cats} getRowId={(c) => c.id} loading={catsQuery.isLoading} emptyTitle="Sin categorías" />
      ) : (
        <DataTable columns={varCols} data={vars} getRowId={(v) => v.id} loading={varsQuery.isLoading} emptyTitle="Sin variantes" />
      )}
    </section>
  );
}
