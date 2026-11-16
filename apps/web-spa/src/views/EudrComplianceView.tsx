import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Leaf, Plus } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 EU Deforestation Regulation (EUDR) Plots & Due Diligence Statements view. */
export function EudrComplianceView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('PLOT-BR-001');
  const [title, setTitle] = useState('Finca Alto Serra · GeoJSON');
  const [country, setCountry] = useState('BR');

  const recordsQuery = useQuery({
    queryKey: ['system', 'custom-records', 'eudr_plot'],
    queryFn: async () => {
      const res = await rpc.api.system['custom-records'].$get({ query: { entitySlug: 'eudr_plot' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.system['custom-records'].$post({
        json: {
          entitySlug: 'eudr_plot',
          code: code.trim(),
          title: title.trim(),
          data: { countryCode: country.trim().toUpperCase(), riskStatus: 'NEGLIGIBLE', commodity: 'coffee' },
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['system', 'custom-records', 'eudr_plot'] }),
  });

  const items = recordsQuery.data?.items ?? [];
  type EudrRow = (typeof items)[number];
  const columns: DataTableColumn<EudrRow>[] = [
    { id: 'code', header: 'Parcela / DDS', cell: (r) => <span className="font-mono text-xs font-medium">{r.code}</span> },
    { id: 'title', header: 'Origen / Polígono', cell: (r) => <span className="font-medium">{r.title}</span> },
    { id: 'country', header: 'País', cell: (r) => <StatusBadge label={String(r.data.countryCode ?? 'EU')} tone="info" /> },
    { id: 'risk', header: 'Riesgo EUDR', cell: (r) => <StatusBadge label={String(r.data.riskStatus ?? 'NEGLIGIBLE')} tone="success" appearance="dot" /> },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !title.trim()) return;
    createMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="eudr-compliance-view">
      <PageHeader title="EUDR · Trazabilidad & Debida Diligencia" description="Registro de parcelas georreferenciadas, evaluación de riesgo y declaraciones EUDR." actions={<StatusBadge label="EU Compliance" tone="success" icon={<Leaf className="size-3" />} />} />

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-4">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PLOT-001" className={`${INPUT_CLS} font-mono text-xs`} />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Descripción de parcela" className={INPUT_CLS} />
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="País (BR, CO, VE)" className={`${INPUT_CLS} font-mono text-xs uppercase`} />
        <button type="submit" disabled={createMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Registrar Parcela</span></button>
      </form>

      <DataTable columns={columns} data={items} getRowId={(r) => r.id} loading={recordsQuery.isLoading} emptyTitle="Sin parcelas EUDR registradas" />
    </section>
  );
}
