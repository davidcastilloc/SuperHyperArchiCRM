import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FileText, Plus, Printer } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { formatMinorToInput, formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Sales Quotes, Line Builder & Public Link view. */
export function QuotesView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [partyId, setPartyId] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('1');
  const [totalMajor, setTotalMajor] = useState('450.00');
  const [copiedOrder, setCopiedOrder] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const quotesQuery = useQuery({
    queryKey: ['pos', 'quotes'],
    queryFn: async () => {
      const res = await rpc.api.pos.orders.$get({ query: { orderKind: 'quote', limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'quotes-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const productsQuery = useQuery({
    queryKey: ['catalog', 'products', 'quotes-select'],
    queryFn: async () => {
      const res = await rpc.api.catalog.products.$get({ query: { limit: '50' } });
      if (!res.ok) return { items: [] as Array<{ id: string; sku: string; name: string; basePriceMinor: number }> };
      return res.json();
    },
  });

  const createMutation = useMutation({
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
      void queryClient.invalidateQueries({ queryKey: ['pos', 'quotes'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const items = quotesQuery.data?.items ?? [];
  const parties = partiesQuery.data?.items ?? [];
  const products = productsQuery.data?.items ?? [];

  function recalcFromProduct(nextProdId: string, nextQty: string) {
    setProductId(nextProdId);
    setQty(nextQty);
    const prod = products.find((p) => p.id === nextProdId);
    const qNum = Math.max(1, Number.parseInt(nextQty, 10) || 1);
    if (prod) {
      setTotalMajor(formatMinorToInput(prod.basePriceMinor * qNum));
    }
  }

  function copyPublicQuoteLink(orderNumber: string) {
    const url = `${window.location.origin}/quote/${orderNumber}`;
    void navigator.clipboard?.writeText(url);
    setCopiedOrder(orderNumber);
    setTimeout(() => setCopiedOrder(null), 2000);
  }

  type QuoteRow = (typeof items)[number];
  const columns: DataTableColumn<QuoteRow>[] = [
    { id: 'num', header: 'Cotización', cell: (q) => <span className="font-mono text-xs font-medium">{q.orderNumber}</span> },
    { id: 'party', header: vocabulary.partySingular, cell: (q) => <span className="font-medium">{q.partyName ?? 'General'}</span> },
    { id: 'total', header: 'Monto', align: 'right', cell: (q) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(q.grandTotalMinor, q.currency)}</span> },
    { id: 'st', header: 'Estado', cell: (q) => <StatusBadge label={q.status === 'fulfilled' ? 'Aprobada' : q.status === 'cancelled' ? 'Rechazada' : 'Vigente'} tone={q.status === 'cancelled' ? 'error' : 'info'} appearance="dot" /> },
    {
      id: 'link',
      header: 'Enlace Público',
      cell: (q) => (
        <button
          type="button"
          onClick={() => copyPublicQuoteLink(q.orderNumber)}
          className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] font-medium hover:bg-muted"
        >
          <Copy className="size-3" />
          <span>{copiedOrder === q.orderNumber ? 'Copiado' : `Copiar /quote/${q.orderNumber}`}</span>
        </button>
      ),
    },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="quotes-view">
      <PageHeader
        title="Cotizaciones & Documentos Comerciales"
        description="Emisión de presupuestos formales, enlaces públicos (/quote/[nro]) y comprobantes imprimibles."
        onRefresh={() => void quotesQuery.refetch()}
        actions={
          <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted">
            <Printer className="size-3.5 text-muted-foreground" />
            <span>Imprimir PDF</span>
          </button>
        }
      />

      {errorMsg ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      {parties.length === 0 && !partiesQuery.isLoading ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          No hay {vocabulary.partyPlural.toLowerCase()} registrados aún. Crea primero un registro en <a href="/parties" className="font-semibold underline">Directorio</a> o emite a público general.
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-5">
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">{vocabulary.partySingular}</span>
          <select value={partyId || parties[0]?.id || ''} onChange={(e) => setPartyId(e.target.value)} className={`${INPUT_CLS} w-full`}>
            <option value="">General / Mostrador</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Producto Base (opcional)</span>
          <select value={productId} onChange={(e) => recalcFromProduct(e.target.value, qty)} className={`${INPUT_CLS} w-full`}>
            <option value="">Monto manual</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name} ({formatMinorUnits(p.basePriceMinor, 'USD')})</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Cantidad</span>
          <input type="number" min={1} value={qty} onChange={(e) => recalcFromProduct(productId, e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-medium text-muted-foreground">Monto USD ($)</span>
          <input value={totalMajor} onChange={(e) => setTotalMajor(e.target.value)} placeholder="450.00" className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
        </label>
        <button type="submit" disabled={createMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
          <Plus className="size-3.5" /><span>Emitir Cotización</span>
        </button>
      </form>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(q) => q.id}
        loading={quotesQuery.isLoading}
        emptyTitle="Sin cotizaciones"
        emptyDescription="Crea un presupuesto formal para compartir con tu cliente."
        rowActions={(q) => [
          { id: 'copy', label: 'Copiar enlace público', onSelect: () => copyPublicQuoteLink(q.orderNumber) },
          { id: 'print', label: 'Imprimir comprobante', onSelect: () => window.print() },
        ]}
      />
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><FileText className="size-3.5" /><span>Listo para generación PDF nativa del navegador.</span></p>
    </section>
  );
}
