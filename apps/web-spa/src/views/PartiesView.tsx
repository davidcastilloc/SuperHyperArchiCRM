import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable, FilterBar, KpiCard, type DataTableColumn } from '@shac/ui';
import { CrmDealsAndConflictsPanel, type CrmPanelTab } from './CrmDealsAndConflictsPanel';
import {
  formatMinorUnits,
  INPUT_CLS,
  parseMajorToMinor,
  readApiError,
  type Phase2ViewProps,
} from './phase2-format';

const PARTY_ROLE_OPTIONS = [
  'customer',
  'vendor',
  'patient',
  'guest',
  'tenant_resident',
  'legal_client',
  'carrier',
] as const;

type PartyRoleOption = (typeof PARTY_ROLE_OPTIONS)[number];

/** Open Mercato-style CRM Workbench: KPI strip, FilterBar, sortable DataTable, and 360° panel. */
export function PartiesView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeRoleChip, setActiveRoleChip] = useState<string>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CrmPanelTab>('deals');
  const [displayName, setDisplayName] = useState('');
  const [taxIdNumber, setTaxIdNumber] = useState('');
  const [creditLimitMajor, setCreditLimitMajor] = useState('0.00');
  const [role, setRole] = useState<PartyRoleOption>('customer');
  const [feedback, setFeedback] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['customers', 'parties', search, activeRoleChip],
    queryFn: async () => {
      const trimmed = search.trim();
      const res = await rpc.api.customers.parties.$get({
        query: {
          limit: '50',
          ...(trimmed ? { search: trimmed } : {}),
          ...(activeRoleChip !== 'all' ? { role: activeRoleChip as PartyRoleOption } : {}),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const dealsSummaryQuery = useQuery({
    queryKey: ['customers', 'deals', 'kpi-strip'],
    queryFn: async () => {
      const res = await rpc.api.customers.deals.$get({ query: { limit: '1' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.customers.parties.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          rolesMask: [role],
          displayName: displayName.trim(),
          taxIdNumber: taxIdNumber.trim() || undefined,
          creditLimitMinor: parseMajorToMinor(creditLimitMajor),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (created) => {
      setDisplayName('');
      setTaxIdNumber('');
      setCreditLimitMajor('0.00');
      setShowCreateForm(false);
      setSelectedPartyId(created.id);
      setFeedback(`${vocabulary.partySingular} "${created.displayName}" guardado`);
      void queryClient.invalidateQueries({ queryKey: ['customers', 'parties'] });
    },
    onError: (err) => setFeedback(err.message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim() || upsertMutation.isPending) return;
    upsertMutation.mutate();
  }

  const items = listQuery.data?.items ?? [];
  type PartyRow = (typeof items)[number];
  const selectedParty = items.find((p) => p.id === selectedPartyId) ?? items[0] ?? null;
  const totalCreditMinor = items.reduce((acc, p) => acc + p.creditLimitMinor, 0);
  const summary = dealsSummaryQuery.data?.summary;

  const columns: DataTableColumn<PartyRow>[] = [
    {
      id: 'name',
      header: vocabulary.partySingular,
      sortValue: (p) => p.displayName,
      cell: (p) => (
        <div>
          <p className="font-medium">{p.displayName}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{p.taxIdNumber ?? 'Sin ID fiscal'}</p>
        </div>
      ),
    },
    {
      id: 'roles',
      header: 'Roles',
      cell: (p) => (
        <div className="flex flex-wrap gap-1">
          {p.rolesMask.map((r) => (
            <span key={r} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{r}</span>
          ))}
        </div>
      ),
    },
    {
      id: 'credit',
      header: 'Crédito',
      align: 'right',
      sortValue: (p) => p.creditLimitMinor,
      cell: (p) => (
        <span className="font-mono tabular-nums">{formatMinorUnits(p.creditLimitMinor, p.preferredCurrency)}</span>
      ),
    },
  ];

  return (
    <section className="space-y-4 p-4" data-slot="parties-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">CRM · {vocabulary.partyPlural} y Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Directorio multi-rol, oportunidades de negocio, relaciones y conflictos en {vocabulary.branchSingular}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm((prev) => !prev)}
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          {showCreateForm ? 'Cerrar formulario' : `+ Nuevo ${vocabulary.partySingular}`}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title={`${vocabulary.partyPlural} visibles`} value={listQuery.data?.total ?? items.length} loading={listQuery.isLoading} />
        <KpiCard title="Pipeline Abierto" value={formatMinorUnits(summary?.openValueMinor ?? 0, 'USD')} loading={dealsSummaryQuery.isLoading} />
        <KpiCard title="Pipeline Ponderado" value={formatMinorUnits(summary?.weightedValueMinor ?? 0, 'USD')} loading={dealsSummaryQuery.isLoading} />
        <KpiCard title="Crédito Asignado" value={formatMinorUnits(totalCreditMinor, 'USD')} loading={listQuery.isLoading} />
      </div>

      {showCreateForm ? (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-5">
          <label className="space-y-1 text-xs md:col-span-2">
            <span>Nombre / Razón Social</span>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={`Ej. Comercial ${vocabulary.partySingular}`} className={`${INPUT_CLS} w-full`} />
          </label>
          <label className="space-y-1 text-xs">
            <span>Rol principal</span>
            <select value={role} onChange={(e) => setRole(e.target.value as PartyRoleOption)} className={`${INPUT_CLS} w-full`}>
              {PARTY_ROLE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span>RIF / ID Fiscal</span>
            <input type="text" value={taxIdNumber} onChange={(e) => setTaxIdNumber(e.target.value)} placeholder="J-12345678-9" className={`${INPUT_CLS} w-full`} />
          </label>
          <div className="flex items-end gap-2">
            <label className="flex-1 space-y-1 text-xs">
              <span>Crédito ($)</span>
              <input type="text" value={creditLimitMajor} onChange={(e) => setCreditLimitMajor(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
            </label>
            <button type="submit" disabled={upsertMutation.isPending || !displayName.trim()} className="h-9 shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Guardar
            </button>
          </div>
        </form>
      ) : null}

      {feedback ? (
        <p className="rounded-md border border-border bg-muted/60 px-3 py-2 text-xs font-mono">{feedback}</p>
      ) : null}

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={`Buscar ${vocabulary.partySingular.toLowerCase()} por nombre o RIF...`}
        activeChipId={activeRoleChip}
        onSelectChip={setActiveRoleChip}
        chips={[
          { id: 'all', label: 'Todos' },
          ...PARTY_ROLE_OPTIONS.map((r) => ({ id: r, label: r })),
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <DataTable
            columns={columns}
            data={items}
            getRowId={(p) => p.id}
            loading={listQuery.isLoading}
            selectedRowId={selectedParty?.id ?? null}
            onRowClick={(p) => setSelectedPartyId(p.id)}
            emptyTitle={`Sin ${vocabulary.partyPlural.toLowerCase()}`}
            emptyDescription="Crea el primer registro o ajusta los filtros de búsqueda."
            emptyActionLabel={`+ Nuevo ${vocabulary.partySingular}`}
            onEmptyAction={() => setShowCreateForm(true)}
            rowActions={(p) => [
              { id: 'deals', label: 'Nueva Oportunidad', onSelect: () => { setSelectedPartyId(p.id); setActiveTab('deals'); } },
              { id: 'links', label: 'Vincular Relación', onSelect: () => { setSelectedPartyId(p.id); setActiveTab('links'); } },
              { id: 'conflict', label: 'Verificar Conflicto', onSelect: () => { setSelectedPartyId(p.id); setActiveTab('conflicts'); } },
            ]}
          />
        </div>
        <div className="lg:col-span-2">
          <CrmDealsAndConflictsPanel
            vocabulary={vocabulary}
            rpc={rpc}
            selectedParty={selectedParty}
            parties={items}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>
      </div>
    </section>
  );
}
