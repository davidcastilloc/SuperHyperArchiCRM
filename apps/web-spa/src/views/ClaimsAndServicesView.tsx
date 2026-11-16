import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Info, Plus, ShieldCheck, Wrench } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { formatMinorUnits, INPUT_CLS, parseNonNegInt, readApiError, type Phase2ViewProps } from './phase2-format';

const CLAIM_STEPS = [
  { step: 1, title: 'Reclamo recibido', desc: 'Confirmamos la solicitud y notificamos a sucursal.' },
  { step: 2, title: 'En revisión técnica', desc: 'El equipo valida cobertura de garantía y serial.' },
  { step: 3, title: 'Decisión', desc: 'Reemplazo anticipado, reparación o nota de crédito.' },
  { step: 4, title: 'Retorno de unidad', desc: 'Guía prepagada o recepción en mostrador.' },
  { step: 5, title: 'Resuelto', desc: 'Reemplazo despachado o reembolso emitido.' },
] as const;

/** Open Mercato DS v3 Warranty Claims (5-step timeline) & Field Work Orders view. */
export function ClaimsAndServicesView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'claims' | 'workorders'>('claims');
  const [showForm, setShowForm] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [partyId, setPartyId] = useState('');
  const [claimNum, setClaimNum] = useState('WTY-000002');
  const [sku, setSku] = useState('EQP-ESP-2G');
  const [reason, setReason] = useState('Fuga en cabezal de grupo');
  const [woTicket, setWoTicket] = useState('WO-2026-101');
  const [woDiag, setWoDiag] = useState('Mantenimiento preventivo y calibración');
  const [woLaborMinor, setWoLaborMinor] = useState('4500');

  const listQuery = useQuery({
    queryKey: ['services', 'claims-and-wo'],
    queryFn: async () => {
      const res = await rpc.api.services.claims.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'claims-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const parties = partiesQuery.data?.items ?? [];
  const activePartyId = partyId || parties[0]?.id || '';

  const createClaimMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.services.rma.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          claimNumber: claimNum.trim(),
          partyId: activePartyId,
          priority: 'HIGH',
          advanceReplacement: true,
          lines: [{ sku: sku.trim(), qty: 1, reason: reason.trim() }],
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (created) => {
      setShowForm(false);
      setSelectedClaimId(created.id);
      void queryClient.invalidateQueries({ queryKey: ['services', 'claims-and-wo'] });
    },
  });

  const createWoMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.services['work-orders'].$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          ticketNumber: woTicket.trim(),
          partyId: activePartyId || undefined,
          category: 'MAINTENANCE',
          initialDiagnosis: woDiag.trim(),
          laborCostMinor: parseNonNegInt(woLaborMinor, 0),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['services', 'claims-and-wo'] });
    },
  });

  const claims = listQuery.data?.claims ?? [];
  const workOrders = listQuery.data?.workOrders ?? [];
  const selectedClaim = claims.find((c) => c.id === selectedClaimId) ?? claims[0] ?? null;

  type ClaimRow = (typeof claims)[number];
  type WoRow = (typeof workOrders)[number];

  const claimCols: DataTableColumn<ClaimRow>[] = [
    { id: 'num', header: 'Garantía / RMA', sortValue: (c) => c.claimNumber, cell: (c) => <span className="font-mono text-xs font-medium">{c.claimNumber}</span> },
    { id: 'party', header: vocabulary.partySingular, cell: (c) => <span className="font-medium">{c.partyName ?? c.partyId}</span> },
    { id: 'prio', header: 'Prioridad', cell: (c) => <StatusBadge label={c.priority} tone={c.priority === 'URGENT' || c.priority === 'HIGH' ? 'warning' : 'neutral'} /> },
    { id: 'status', header: 'Estado', cell: (c) => <StatusBadge label={c.status} tone={c.status === 'RESOLVED' ? 'success' : 'info'} appearance="dot" /> },
  ];

  const woCols: DataTableColumn<WoRow>[] = [
    { id: 'ticket', header: 'Orden Técnica', sortValue: (w) => w.ticketNumber, cell: (w) => <span className="font-mono text-xs font-medium">{w.ticketNumber}</span> },
    { id: 'diag', header: 'Diagnóstico', cell: (w) => <span className="text-xs">{w.initialDiagnosis ?? w.category}</span> },
    { id: 'party', header: vocabulary.partySingular, cell: (w) => <span className="text-xs">{w.partyName ?? 'General'}</span> },
    { id: 'cost', header: 'Mano de Obra', align: 'right', cell: (w) => <span className="font-mono tabular-nums">{formatMinorUnits(w.laborCostMinor, 'USD')}</span> },
    { id: 'status', header: 'Estado', cell: (w) => <StatusBadge label={w.status} tone={w.status === 'COMPLETED' ? 'success' : 'warning'} appearance="dot" /> },
  ];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (tab === 'claims') createClaimMutation.mutate();
    else createWoMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="claims-services-view">
      <PageHeader
        title="Reclamos de Garantía (RMA) & Órdenes Técnicas"
        description="Seguimiento paso a paso de garantías, reemplazos anticipados y servicio técnico."
        onRefresh={() => void listQuery.refetch()}
        refreshing={listQuery.isFetching}
        actions={
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs"
          >
            <Plus className="size-3.5" />
            <span>{showForm ? 'Cerrar' : tab === 'claims' ? 'Nuevo Reclamo' : 'Nueva Orden Técnica'}</span>
          </button>
        }
      />

      <div className="flex gap-4 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('claims')}
          className={`inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium ${
            tab === 'claims' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'
          }`}
        >
          <ShieldCheck className="size-3.5" />
          <span>Garantías & RMA ({claims.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('workorders')}
          className={`inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium ${
            tab === 'workorders' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'
          }`}
        >
          <Wrench className="size-3.5" />
          <span>Órdenes de Trabajo ({workOrders.length})</span>
        </button>
      </div>

      {showForm ? (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-4">
          <select value={activePartyId} onChange={(e) => setPartyId(e.target.value)} className={INPUT_CLS}>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
          {tab === 'claims' ? (
            <>
              <input value={claimNum} onChange={(e) => setClaimNum(e.target.value)} placeholder="WTY-000001" className={`${INPUT_CLS} font-mono text-xs`} />
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU equipo" className={`${INPUT_CLS} font-mono text-xs`} />
              <div className="flex gap-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" className={`${INPUT_CLS} w-full`} />
                <button type="submit" disabled={!activePartyId || createClaimMutation.isPending} className="h-9 shrink-0 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Guardar</button>
              </div>
            </>
          ) : (
            <>
              <input value={woTicket} onChange={(e) => setWoTicket(e.target.value)} placeholder="WO-2026-101" className={`${INPUT_CLS} font-mono text-xs`} />
              <input value={woDiag} onChange={(e) => setWoDiag(e.target.value)} placeholder="Diagnóstico inicial" className={INPUT_CLS} />
              <div className="flex gap-2">
                <input value={woLaborMinor} onChange={(e) => setWoLaborMinor(e.target.value)} placeholder="Labor minor" className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
                <button type="submit" disabled={createWoMutation.isPending} className="h-9 shrink-0 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Guardar</button>
              </div>
            </>
          )}
        </form>
      ) : null}

      {tab === 'claims' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <DataTable
              columns={claimCols}
              data={claims}
              getRowId={(c) => c.id}
              loading={listQuery.isLoading}
              selectedRowId={selectedClaim?.id ?? null}
              onRowClick={(c) => setSelectedClaimId(c.id)}
              emptyTitle="Sin reclamos de garantía"
              emptyDescription="Registra el primer RMA para activar la línea de tiempo de seguimiento."
              emptyActionLabel="Nuevo Reclamo"
              onEmptyAction={() => setShowForm(true)}
            />
          </div>
          <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4 lg:col-span-2">
            <div className="space-y-1">
              <StatusBadge label={selectedClaim ? `Warranty ${selectedClaim.claimNumber}` : 'Warranty WTY-000001'} tone="neutral" />
              <h2 className="pt-1 text-base font-semibold tracking-tight">
                {selectedClaim ? `${selectedClaim.partyName ?? selectedClaim.partyId} · Garantía` : 'Seguimiento de Garantía'}
              </h2>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-status-info-border bg-status-info-bg px-3 py-2 text-xs text-status-info-text">
              <Info className="mt-0.5 size-3.5 shrink-0 text-status-info-icon" />
              <span>Estamos revisando el reclamo. No se requiere acción adicional en este momento.</span>
            </div>
            <ol className="space-y-3.5 pt-1">
              {CLAIM_STEPS.map((s) => {
                const done = s.step === 1;
                const current = s.step === 2;
                return (
                  <li key={s.step} className={`flex items-start justify-between gap-2 ${s.step > 2 ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs ${
                          done
                            ? 'bg-status-success-icon text-white'
                            : current
                              ? 'bg-primary font-semibold text-primary-foreground'
                              : 'border border-border text-muted-foreground'
                        }`}
                      >
                        {done ? <Check className="size-3.5" /> : s.step}
                      </span>
                      <div>
                        <p className="text-xs font-medium">{s.title}</p>
                        <p className="text-[11px] text-muted-foreground">{s.desc}</p>
                      </div>
                    </div>
                    {current ? <span className="text-[11px] text-muted-foreground">Ahora</span> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      ) : (
        <DataTable
          columns={woCols}
          data={workOrders}
          getRowId={(w) => w.id}
          loading={listQuery.isLoading}
          emptyTitle="Sin órdenes técnicas"
          emptyDescription="Crea una orden de servicio o mantenimiento preventivo."
          emptyActionLabel="Nueva Orden Técnica"
          onEmptyAction={() => setShowForm(true)}
        />
      )}
    </section>
  );
}
