import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSearch, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { DataTable, StatusBadge } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

interface LegalEdiscoveryAndEthicsPanelProps {
  rpc: Phase2ViewProps['rpc'];
  tab: 'ediscovery' | 'briefs' | 'ethics';
  onStatus: (msg: string) => void;
}

/** Sub-panel for Legal e-Discovery (Bates), AI Briefs Generator, Citations & Bar/CLE Ethics. */
export function LegalEdiscoveryAndEthicsPanel({ rpc, tab, onStatus }: LegalEdiscoveryAndEthicsPanelProps) {
  const queryClient = useQueryClient();
  const [holdTitle, setHoldTitle] = useState('');
  const [custodian, setCustodian] = useState('Dirección Financiera');
  const [privTag, setPrivTag] = useState<'PRIVILEGED' | 'RESPONSIVE' | 'HOT_DOC' | 'REDACTED'>('RESPONSIVE');
  const [snippet, setSnippet] = useState('');
  const [briefTitle, setBriefTitle] = useState('');
  const [courtName, setCourtName] = useState('Juzgado Superior Mercantil');
  const [keyArgs, setKeyArgs] = useState('');
  const [ethKind, setEthKind] = useState<'ethics_license' | 'legal_citation'>('ethics_license');
  const [ethTitle, setEthTitle] = useState('');
  const [ethJuris, setEthJuris] = useState('Nacional / Colegio');
  const [cleDone, setCleDone] = useState('24');

  const query = useQuery({
    queryKey: ['legal', 'ediscovery-ethics'],
    queryFn: async () => {
      const res = await rpc.api.legal['ediscovery-ethics'].$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const holdMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.legal['ediscovery-hold'].$post({
        json: { matterId: 'EXP-2026-01', title: holdTitle.trim(), custodian, privilegeTag: privTag, snippetText: snippet.trim() || holdTitle.trim() },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ['legal', 'ediscovery-ethics'] });
      setHoldTitle('');
      setSnippet('');
      onStatus(`Evidencia sellada con Bates ${d.batesNumber}`);
    },
  });

  const briefMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.legal['ai-brief'].$post({
        json: { matterId: 'EXP-2026-01', title: briefTitle.trim(), courtName, keyArguments: keyArgs.trim() },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['legal', 'ediscovery-ethics'] });
      setBriefTitle('');
      setKeyArgs('');
      onStatus('Escrito judicial generado con IA y guardado.');
    },
  });

  const ethMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.legal['citations-and-ethics'].$post({
        json: { recordKind: ethKind, title: ethTitle.trim(), jurisdiction: ethJuris, statusTag: 'COMPLIANT', cleCompletedHours: Number(cleDone) || 0, cleRequiredHours: 20 },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['legal', 'ediscovery-ethics'] });
      setEthTitle('');
      onStatus('Registro de citación / ética CLE guardado.');
    },
  });

  const holds = (query.data?.ediscoveryHolds ?? []) as Array<{ id: string; title: string; meta: { batesNumber?: string; custodian?: string; privilegeTag?: string; sha256Hash?: string } }>;
  const briefs = (query.data?.briefs ?? []) as Array<{ id: string; title: string; content: string; meta: { courtName?: string } }>;
  const ethics = (query.data?.ethicsAndCitations ?? []) as Array<{ id: string; folderId: string; title: string; meta: { jurisdiction?: string; statusTag?: string; cleCompletedHours?: number; cleRequiredHours?: number } }>;

  if (tab === 'ediscovery') {
    return (
      <div className="space-y-4">
        <form className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); holdMutation.mutate(); }}>
          <input placeholder="Documento / Evidencia" value={holdTitle} onChange={(e) => setHoldTitle(e.target.value)} className={INPUT_CLS} required />
          <input placeholder="Custodio" value={custodian} onChange={(e) => setCustodian(e.target.value)} className={INPUT_CLS} required />
          <select value={privTag} onChange={(e) => setPrivTag(e.target.value as typeof privTag)} className={INPUT_CLS}>
            <option value="RESPONSIVE">RESPONSIVE</option><option value="PRIVILEGED">PRIVILEGED</option><option value="HOT_DOC">HOT_DOC</option><option value="REDACTED">REDACTED</option>
          </select>
          <button type="submit" className="inline-flex h-9 items-center justify-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
            <FileSearch className="size-3.5" /><span>Asignar Bates</span>
          </button>
          <input placeholder="Extracto o descripción probatoria..." value={snippet} onChange={(e) => setSnippet(e.target.value)} className={`${INPUT_CLS} sm:col-span-4`} />
        </form>
        <DataTable
          columns={[
            { id: 'bates', header: 'Bates Stamp', cell: (r) => <span className="font-mono text-xs font-semibold">{r.meta.batesNumber ?? '—'}</span> },
            { id: 'tit', header: 'Evidencia', cell: (r) => r.title },
            { id: 'cust', header: 'Custodio', cell: (r) => r.meta.custodian ?? '—' },
            { id: 'tag', header: 'Privilegio', cell: (r) => <StatusBadge label={r.meta.privilegeTag ?? 'RESPONSIVE'} tone={r.meta.privilegeTag === 'PRIVILEGED' ? 'warning' : 'info'} /> },
          ]}
          data={holds}
          getRowId={(r) => r.id}
          emptyTitle="Sin evidencias en e-Discovery"
        />
      </div>
    );
  }

  if (tab === 'briefs') {
    return (
      <div className="space-y-4">
        <form className="space-y-2 rounded-xl border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); briefMutation.mutate(); }}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input placeholder="Título del Escrito / Moción" value={briefTitle} onChange={(e) => setBriefTitle(e.target.value)} className={INPUT_CLS} required />
            <input placeholder="Tribunal" value={courtName} onChange={(e) => setCourtName(e.target.value)} className={INPUT_CLS} required />
          </div>
          <textarea rows={3} placeholder="Hechos clave y fundamentos jurídicos..." value={keyArgs} onChange={(e) => setKeyArgs(e.target.value)} className="w-full rounded-md border border-input bg-background p-2.5 text-xs" required />
          <button type="submit" disabled={briefMutation.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground">
            <Sparkles className="size-3.5" /><span>{briefMutation.isPending ? 'Redactando...' : 'Generar Escrito con IA'}</span>
          </button>
        </form>
        <div className="space-y-2.5">
          {briefs.map((b) => (
            <div key={b.id} className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <div className="mb-1 flex items-center justify-between">
                <h4 className="text-sm font-semibold">{b.title}</h4>
                <StatusBadge label={b.meta.courtName ?? 'Tribunal'} tone="info" />
              </div>
              <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground">{b.content}</pre>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-card p-4 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); ethMutation.mutate(); }}>
        <select value={ethKind} onChange={(e) => setEthKind(e.target.value as typeof ethKind)} className={INPUT_CLS}>
          <option value="ethics_license">Licencia / Ética CLE</option>
          <option value="legal_citation">Citación Jurisprudencial</option>
        </select>
        <input placeholder="Abogado / N° Sentencia" value={ethTitle} onChange={(e) => setEthTitle(e.target.value)} className={INPUT_CLS} required />
        <input placeholder="Jurisdicción" value={ethJuris} onChange={(e) => setEthJuris(e.target.value)} className={INPUT_CLS} required />
        <input type="number" placeholder="Horas CLE" value={cleDone} onChange={(e) => setCleDone(e.target.value)} className={`${INPUT_CLS} font-mono`} />
        <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Registrar</button>
      </form>
      <DataTable
        columns={[
          { id: 'tit', header: 'Registro', cell: (r) => <span className="font-medium">{r.title}</span> },
          { id: 'jur', header: 'Jurisdicción', cell: (r) => r.meta.jurisdiction ?? '—' },
          { id: 'cle', header: 'CLE / Tipo', cell: (r) => r.folderId === 'ethics_license' ? <span className="font-mono text-xs tabular-nums">{r.meta.cleCompletedHours ?? 0}/{r.meta.cleRequiredHours ?? 20}h CLE</span> : 'Jurisprudencia' },
          { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.meta.statusTag ?? 'COMPLIANT'} tone="success" /> },
        ]}
        data={ethics}
        getRowId={(r) => r.id}
        emptyTitle="Sin citaciones ni licencias registradas"
      />
    </div>
  );
}
