import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Printer } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Sales Quotes & Printable Documents view. */
export function QuotesView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [partyId, setPartyId] = useState('');
  const [totalMajor, setTotalMajor] = useState('450.00');

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

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.pos.quotes.$post({
        json: { partyId: partyId || partiesQuery.data?.items[0]?.id, totalMinor: Math.max(100, parseMajorToMinor(totalMajor)), currency: 'USD' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pos', 'quotes'] }),
  });

  const items = quotesQuery.data?.items ?? [];
  const parties = partiesQuery.data?.items ?? [];
  type QuoteRow = (typeof items)[number];
  const columns: DataTableColumn<QuoteRow>[] = [
    { id: 'num', header: 'Cotización', cell: (q) => <span className="font-mono text-xs font-medium">{q.orderNumber}</span> },
    { id: 'party', header: vocabulary.partySingular, cell: (q) => <span className="font-medium">{q.partyName ?? 'General'}</span> },
    { id: 'total', header: 'Monto', align: 'right', cell: (q) => <span className="font-mono font-semibold tabular-nums">{formatMinorUnits(q.grandTotalMinor, q.currency)}</span> },
    { id: 'st', header: 'Estado', cell: (q) => <StatusBadge label={q.status} tone="info" appearance="dot" /> },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="quotes-view">
      <PageHeader
        title="Cotizaciones & Documentos Comerciales"
        description="Emisión de presupuestos formales y comprobantes imprimibles."
        onRefresh={() => void quotesQuery.refetch()}
        actions={
          <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted">
            <Printer className="size-3.5 text-muted-foreground" />
            <span>Imprimir PDF</span>
          </button>
        }
      />

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-3">
        <select value={partyId || parties[0]?.id || ''} onChange={(e) => setPartyId(e.target.value)} className={INPUT_CLS}>
          {parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
        </select>
        <input value={totalMajor} onChange={(e) => setTotalMajor(e.target.value)} placeholder="Monto USD ($)" className={`${INPUT_CLS} font-mono tabular-nums`} />
        <button type="submit" disabled={createMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Emitir Cotización</span></button>
      </form>

      <DataTable columns={columns} data={items} getRowId={(q) => q.id} loading={quotesQuery.isLoading} emptyTitle="Sin cotizaciones" emptyDescription="Crea un presupuesto formal para compartir con tu cliente." rowActions={() => [{ id: 'print', label: 'Imprimir comprobante', onSelect: () => window.print() }]} />
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><FileText className="size-3.5" /><span>Listo para generación PDF nativa del navegador.</span></p>
    </section>
  );
}
