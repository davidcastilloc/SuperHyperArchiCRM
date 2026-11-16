import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Handshake, Link2, Plus, ShieldAlert } from 'lucide-react';
import { DataTable, StatusBadge, type DataTableColumn } from '@shac/ui';
import {
  formatMinorUnits, INPUT_CLS, parseMajorToMinor, parseNonNegInt, readApiError, type Phase2ViewProps,
} from './phase2-format';

export type CrmPanelTab = 'deals' | 'links' | 'conflicts';

interface PartySummary {
  id: string; displayName: string; rolesMask: string[];
  taxIdNumber: string | null; creditLimitMinor: number; preferredCurrency: string;
}

interface CrmDealsAndConflictsPanelProps extends Phase2ViewProps {
  selectedParty: PartySummary | null; parties: PartySummary[];
  activeTab: CrmPanelTab; onTabChange: (tab: CrmPanelTab) => void;
}

const LINK_TYPE_OPTIONS = [
  'company_contact', 'parent_guardian', 'roommate_occupant',
  'emergency_contact', 'co_applicant', 'distributor_store',
] as const;

const STAGE_OPTIONS = [
  { id: 'stage_qualified', label: 'Calificación (25%)', probBps: 2500 },
  { id: 'stage_proposal', label: 'Propuesta (50%)', probBps: 5000 },
  { id: 'stage_negotiation', label: 'Negociación (75%)', probBps: 7500 },
  { id: 'stage_commit', label: 'Cierre (90%)', probBps: 9000 },
] as const;

/** Open Mercato DS v3 360° CRM detail tabs: Deals, Party links, and Conflict checks. */
export function CrmDealsAndConflictsPanel({
  vocabulary,
  rpc,
  selectedParty,
  parties,
  activeTab,
  onTabChange,
}: CrmDealsAndConflictsPanelProps) {
  const queryClient = useQueryClient();
  const [dealTitle, setDealTitle] = useState('');
  const [dealValueMajor, setDealValueMajor] = useState('250.00');
  const [stageId, setStageId] = useState<string>(STAGE_OPTIONS[0].id);
  const [targetPartyId, setTargetPartyId] = useState('');
  const [linkType, setLinkType] = useState<(typeof LINK_TYPE_OPTIONS)[number]>('company_contact');
  const [matterTitle, setMatterTitle] = useState('Evaluación comercial');
  const [searchTerms, setSearchTerms] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const dealsQuery = useQuery({
    queryKey: ['customers', 'deals', selectedParty?.id ?? 'all'],
    queryFn: async () => {
      const res = await rpc.api.customers.deals.$get({
        query: selectedParty ? { partyId: selectedParty.id, limit: '25' } : { limit: '25' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const createDealMutation = useMutation({
    mutationFn: async () => {
      if (!selectedParty) throw new Error(`Selecciona un ${vocabulary.partySingular.toLowerCase()}`);
      const stage = STAGE_OPTIONS.find((s) => s.id === stageId) ?? STAGE_OPTIONS[0];
      const res = await rpc.api.customers.deals.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          pipelineId: 'pipe_default',
          stageId: stage.id,
          partyId: selectedParty.id,
          title: dealTitle.trim(),
          valueMinor: parseMajorToMinor(dealValueMajor),
          currency: 'USD',
          probabilityBps: stage.probBps,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setDealTitle('');
      setFeedback(`Oportunidad "${data.title}" creada (${formatMinorUnits(data.valueMinor, data.currency)})`);
      void queryClient.invalidateQueries({ queryKey: ['customers', 'deals'] });
    },
    onError: (err) => setFeedback(err.message),
  });

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedParty) throw new Error(`Selecciona un ${vocabulary.partySingular.toLowerCase()}`);
      const otherId = targetPartyId || parties.find((p) => p.id !== selectedParty.id)?.id || '';
      if (!otherId) throw new Error('Necesitas otro registro para vincular');
      const res = await rpc.api.customers.links.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          fromPartyId: selectedParty.id,
          toPartyId: otherId,
          linkType,
          isPrimary: true,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => setFeedback(`Vínculo ${data.linkType} registrado`),
    onError: (err) => setFeedback(err.message),
  });

  const conflictMutation = useMutation({
    mutationFn: async () => {
      const terms = (searchTerms.trim() || selectedParty?.displayName || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await rpc.api.customers['conflict-checks'].$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          candidatePartyId: selectedParty?.id ?? null,
          matterTitle: matterTitle.trim() || 'Verificación CRM',
          searchedTerms: terms.length > 0 ? terms : ['Demo'],
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onError: (err) => setFeedback(err.message),
  });

  const deals = dealsQuery.data?.items ?? [];
  type DealRow = (typeof deals)[number];
  const dealColumns: DataTableColumn<DealRow>[] = [
    {
      id: 'title',
      header: 'Oportunidad',
      sortValue: (d) => d.title,
      cell: (d) => (
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{d.title}</p>
          <StatusBadge
            label={`${d.stageId.replace('stage_', '')} (${parseNonNegInt(String(d.probabilityBps)) / 100}%)`}
            tone="info"
            appearance="dot"
          />
        </div>
      ),
    },
    {
      id: 'val',
      header: 'Valor',
      align: 'right',
      sortValue: (d) => d.valueMinor,
      cell: (d) => <span className="font-mono font-medium tabular-nums">{formatMinorUnits(d.valueMinor, d.currency)}</span>,
    },
  ];

  function handleDealSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dealTitle.trim() || createDealMutation.isPending) return;
    createDealMutation.mutate();
  }

  const otherParties = parties.filter((p) => p.id !== selectedParty?.id);
  const tabs = [
    { id: 'deals' as const, label: 'Deals', Icon: Handshake, count: deals.length },
    { id: 'links' as const, label: 'Relaciones', Icon: Link2 },
    { id: 'conflicts' as const, label: 'Conflictos', Icon: ShieldAlert },
  ];

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-xs" data-slot="crm-detail-panel">
      <div className="flex flex-wrap items-center gap-4 border-b border-border" role="tablist">
        {tabs.map(({ id, label, Icon, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => onTabChange(id)}
            className={`inline-flex items-center gap-1.5 border-b-2 pb-2.5 text-xs font-medium transition-colors ${
              activeTab === id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="size-3.5" />
            <span>{label}</span>
            {count !== undefined ? (
              <span className="rounded-full bg-status-info-bg px-1.5 py-0.5 font-mono text-[10px] text-status-info-text tabular-nums">{count}</span>
            ) : null}
          </button>
        ))}
      </div>

      {feedback ? (
        <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p>
      ) : null}

      {activeTab === 'deals' ? (
        <div className="space-y-3">
          <form onSubmit={handleDealSubmit} className="space-y-2.5 border-b border-border pb-3">
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Nueva oportunidad comercial</span>
              <input className={`${INPUT_CLS} w-full`} value={dealTitle} onChange={(e) => setDealTitle(e.target.value)} placeholder="Ej. Contrato Suministro 2026" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Monto USD ($)</span>
                <input className={`${INPUT_CLS} w-full font-mono tabular-nums`} value={dealValueMajor} onChange={(e) => setDealValueMajor(e.target.value)} />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Etapa Pipeline</span>
                <select className={`${INPUT_CLS} w-full`} value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  {STAGE_OPTIONS.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <button type="submit" disabled={!selectedParty || !dealTitle.trim() || createDealMutation.isPending} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-medium text-primary-foreground shadow-xs disabled:opacity-50">
              <Plus className="size-3.5" />
              <span>{createDealMutation.isPending ? 'Guardando...' : 'Agregar Deal'}</span>
            </button>
          </form>

          <DataTable
            columns={dealColumns}
            data={deals}
            getRowId={(d) => d.id}
            loading={dealsQuery.isLoading}
            emptyTitle="Sin oportunidades aún"
            emptyDescription="Selecciona una cuenta a la izquierda y registra su primera oportunidad."
          />
        </div>
      ) : activeTab === 'links' ? (
        <div className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Vincular con registro</span>
            <select className={`${INPUT_CLS} w-full`} value={targetPartyId || otherParties[0]?.id || ''} onChange={(e) => setTargetPartyId(e.target.value)}>
              {otherParties.length === 0 ? (
                <option value="">Crea otro registro primero</option>
              ) : (
                otherParties.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)
              )}
            </select>
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Rol / Relación</span>
            <select className={`${INPUT_CLS} w-full`} value={linkType} onChange={(e) => setLinkType(e.target.value as (typeof LINK_TYPE_OPTIONS)[number])}>
              {LINK_TYPE_OPTIONS.map((lt) => <option key={lt} value={lt}>{lt}</option>)}
            </select>
          </label>
          <button type="button" disabled={!selectedParty || otherParties.length === 0 || linkMutation.isPending} onClick={() => linkMutation.mutate()} className="h-8 w-full rounded-md bg-primary text-xs font-medium text-primary-foreground shadow-xs disabled:opacity-50">
            Vincular Persona / Entidad
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Asunto / Expediente</span>
            <input className={`${INPUT_CLS} w-full`} value={matterTitle} onChange={(e) => setMatterTitle(e.target.value)} />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Términos a verificar (separados por coma)</span>
            <input className={`${INPUT_CLS} w-full`} value={searchTerms} onChange={(e) => setSearchTerms(e.target.value)} placeholder={selectedParty?.displayName ?? 'Nombre, RIF...'} />
          </label>
          <button type="button" disabled={conflictMutation.isPending} onClick={() => conflictMutation.mutate()} className="h-8 w-full rounded-md bg-primary text-xs font-medium text-primary-foreground shadow-xs disabled:opacity-50">
            Ejecutar Verificación de Conflictos
          </button>
          {conflictMutation.data ? (
            <div className="space-y-1.5 border-t border-border pt-3 text-xs">
              <StatusBadge
                label={`Resultado: ${conflictMutation.data.riskStatus.toUpperCase()} (${conflictMutation.data.matchedParties.length})`}
                tone={conflictMutation.data.riskStatus === 'clear' ? 'success' : 'error'}
              />
              {conflictMutation.data.matchedParties.map((m) => (
                <p key={m.partyId} className="text-muted-foreground">
                  {m.displayName} ({m.taxIdNumber ?? 'sin RIF'})
                </p>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
