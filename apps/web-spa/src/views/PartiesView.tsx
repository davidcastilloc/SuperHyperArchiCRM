import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, Copy, CreditCard, FileText, Plus, ShieldCheck } from 'lucide-react';
import { DataTable, FilterBar, KpiCard, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { useMarketProfile } from '../lib/marketProfile';
import { CrmDealsAndConflictsPanel, type CrmPanelTab } from './CrmDealsAndConflictsPanel';
import { CustomFieldsSection } from './CustomFieldsSection';
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

const ROLE_LABELS_ES: Record<PartyRoleOption, string> = {
  customer: 'Cliente',
  vendor: 'Proveedor',
  patient: 'Paciente',
  guest: 'Huésped',
  tenant_resident: 'Residente',
  legal_client: 'Representado',
  carrier: 'Transportista',
};

function defaultRoleForPreset(presetId: string): PartyRoleOption {
  if (presetId === 'clinic-practice') return 'patient';
  if (presetId === 'hospitality-pms') return 'guest';
  if (presetId === 'property-condo') return 'tenant_resident';
  if (presetId === 'legal-psa') return 'legal_client';
  return 'customer';
}

/** Open Mercato DS v3 CRM Workbench: KPI strip, 360° Company Header, FilterBar, CustomFields & DataTable. */
export function PartiesView({ vocabulary, rpc }: Phase2ViewProps) {
  const profile = useMarketProfile();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeRoleChip, setActiveRoleChip] = useState<string>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CrmPanelTab>('deals');
  const [displayName, setDisplayName] = useState('');
  const [taxIdNumber, setTaxIdNumber] = useState('');
  const [creditLimitMajor, setCreditLimitMajor] = useState('0.00');
  const [role, setRole] = useState<PartyRoleOption>(() => defaultRoleForPreset(profile.editionPreset));
  const [customFields, setCustomFields] = useState<Record<string, string | number | boolean>>({});
  const [copiedId, setCopiedId] = useState(false);
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
          customFields,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (created) => {
      setDisplayName('');
      setTaxIdNumber('');
      setCreditLimitMajor('0.00');
      setCustomFields({});
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
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{p.displayName}</p>
          <p className="font-mono text-xs text-muted-foreground">{p.taxIdNumber ?? 'Sin ID fiscal'}</p>
        </div>
      ),
    },
    {
      id: 'roles',
      header: 'Estado & Roles',
      cell: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge label="Activo" tone="success" appearance="dot" />
          {p.rolesMask.map((r) => (
            <StatusBadge key={r} label={r} tone="neutral" appearance="pill" />
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
        <span className="font-mono font-medium tabular-nums">
          {formatMinorUnits(p.creditLimitMinor, p.preferredCurrency)}
        </span>
      ),
    },
  ];

  return (
    <section className="space-y-5" data-slot="parties-view">
      <PageHeader
        title={vocabulary.partyPlural}
        description={`Directorio 360°, oportunidades comerciales, relaciones y verificación de conflictos en ${vocabulary.branchSingular}.`}
        onRefresh={() => void listQuery.refetch()}
        refreshing={listQuery.isFetching}
        actions={
          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
          >
            <Plus className="size-3.5" />
            <span>{showCreateForm ? 'Cerrar formulario' : `Crear ${vocabulary.partySingular}`}</span>
          </button>
        }
      />

      {selectedParty ? (
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-muted/60 text-muted-foreground">
              <Building2 className="size-5" />
            </div>
            <div className="space-y-2">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{selectedParty.displayName}</h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <FileText className="size-3.5" />
                    <span className="font-mono">{selectedParty.taxIdNumber ?? 'Sin RIF registrado'}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CreditCard className="size-3.5" />
                    <span>Límite {formatMinorUnits(selectedParty.creditLimitMinor, selectedParty.preferredCurrency)}</span>
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge label="Activo" tone="success" icon={<CheckCircle2 className="size-3" />} />
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard?.writeText(selectedParty.id); setCopiedId(true); setTimeout(() => setCopiedId(false), 1500); }}
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted"
                >
                  <Copy className="size-2.5" /><span>{copiedId ? 'Copiado' : selectedParty.id.slice(0, 8)}</span>
                </button>
                {selectedParty.rolesMask.map((r) => (
                  <StatusBadge key={r} label={ROLE_LABELS_ES[r as PartyRoleOption] ?? r} tone="info" />
                ))}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('conflicts')}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground"
          >
            <ShieldCheck className="size-3.5" />
            <span>Auditar Conflictos</span>
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title={`${vocabulary.partyPlural} Activos`} value={listQuery.data?.total ?? items.length} loading={listQuery.isLoading} />
        <KpiCard title="Pipeline Abierto" value={formatMinorUnits(summary?.openValueMinor ?? 0, 'USD')} loading={dealsSummaryQuery.isLoading} />
        <KpiCard title="Valor Ponderado" value={formatMinorUnits(summary?.weightedValueMinor ?? 0, 'USD')} loading={dealsSummaryQuery.isLoading} />
        <KpiCard title="Crédito Asignado" value={formatMinorUnits(totalCreditMinor, 'USD')} loading={listQuery.isLoading} />
      </div>

      {showCreateForm ? (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 shadow-xs md:grid-cols-5">
          <label className="space-y-1 text-xs md:col-span-2">
            <span className="font-medium text-muted-foreground">Nombre / Razón Social</span>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={`Ej. Comercial ${vocabulary.partySingular}`} className={`${INPUT_CLS} w-full`} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Rol principal</span>
            <select value={role} onChange={(e) => setRole(e.target.value as PartyRoleOption)} className={`${INPUT_CLS} w-full`}>
              {PARTY_ROLE_OPTIONS.map((opt) => <option key={opt} value={opt}>{ROLE_LABELS_ES[opt]}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Documento / ID Fiscal</span>
            <input type="text" value={taxIdNumber} onChange={(e) => setTaxIdNumber(e.target.value)} placeholder="V-12345678 / J-12345678-9" className={`${INPUT_CLS} w-full`} />
          </label>
          <div className="flex items-end gap-2">
            <label className="flex-1 space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Crédito ($)</span>
              <input type="text" value={creditLimitMajor} onChange={(e) => setCreditLimitMajor(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} />
            </label>
            <button type="submit" disabled={upsertMutation.isPending || !displayName.trim()} className="h-9 shrink-0 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs disabled:opacity-50">
              Guardar
            </button>
          </div>
          <div className="md:col-span-5">
            <CustomFieldsSection rpc={rpc} targetEntity="crm_parties" values={customFields} onChange={setCustomFields} />
          </div>
        </form>
      ) : null}

      {feedback ? (
        <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <FilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={`Buscar ${vocabulary.partySingular.toLowerCase()} por nombre o RIF...`}
            activeChipId={activeRoleChip}
            onSelectChip={setActiveRoleChip}
            chips={[
              { id: 'all', label: 'Todos' },
              ...PARTY_ROLE_OPTIONS.map((r) => ({ id: r, label: ROLE_LABELS_ES[r] })),
            ]}
          />
          <DataTable
            columns={columns}
            data={items}
            getRowId={(p) => p.id}
            loading={listQuery.isLoading}
            selectedRowId={selectedParty?.id ?? null}
            onRowClick={(p) => setSelectedPartyId(p.id)}
            emptyTitle={`Sin ${vocabulary.partyPlural.toLowerCase()}`}
            emptyDescription="Crea el primer registro o ajusta los filtros de búsqueda."
            emptyActionLabel={`Crear ${vocabulary.partySingular}`}
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
