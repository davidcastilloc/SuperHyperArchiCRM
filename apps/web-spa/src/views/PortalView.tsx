import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Info, MessageSquare, Send, ShieldCheck } from 'lucide-react';
import { PageHeader, StatusBadge } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Client Portal view enforcing SQL is_confidential = 0 filtering. */
export function PortalView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [partyFilter, setPartyFilter] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const partiesQuery = useQuery({
    queryKey: ['customers', 'parties', 'portal-select'],
    queryFn: async () => {
      const res = await rpc.api.customers.parties.$get({ query: { limit: '50' } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const portalQuery = useQuery({
    queryKey: ['portal', 'records', partyFilter],
    queryFn: async () => {
      const res = await rpc.api.portal.records.$get({
        query: partyFilter.trim() ? { partyId: partyFilter.trim() } : {},
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      const targetParty = partyFilter || partiesQuery.data?.items[0]?.id || '';
      if (!targetParty) throw new Error(`Selecciona un ${vocabulary.partySingular.toLowerCase()} primero.`);
      const res = await rpc.api.customers.interactions.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          partyId: targetParty,
          kind: 'note',
          title: subject.trim() || 'Mensaje de Portal',
          body: bodyText.trim(),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      setSubject('');
      setBodyText('');
      void queryClient.invalidateQueries({ queryKey: ['portal', 'records'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const parties = partiesQuery.data?.items ?? [];
  const attachments = portalQuery.data?.attachments ?? [];
  const messages = portalQuery.data?.messages ?? [];

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!bodyText.trim()) return;
    sendMessageMutation.mutate();
  }

  return (
    <section className="mx-auto max-w-4xl space-y-5" data-slot="portal-view">
      <PageHeader
        title={`Portal ${vocabulary.partySingular}`}
        description="Seguimiento externo con aislamiento SQL estricto sobre notas y adjuntos."
        onRefresh={() => void portalQuery.refetch()}
        refreshing={portalQuery.isFetching}
        actions={
          <select
            aria-label={`Filtrar por ${vocabulary.partySingular.toLowerCase()}`}
            className={`${INPUT_CLS} min-w-52`}
            value={partyFilter}
            onChange={(e) => setPartyFilter(e.target.value)}
          >
            <option value="">Todos los {vocabulary.partyPlural.toLowerCase()}</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </select>
        }
      />

      {errorMsg ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}

      <div className="divide-y divide-border rounded-xl border border-border bg-card shadow-xs">
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge label="Portal Externo · Zero-Trust" tone="neutral" icon={<ShieldCheck className="size-3.5" />} />
            <StatusBadge label={`${attachments.length} adjuntos · ${messages.length} mensajes`} tone="success" appearance="dot" />
          </div>
          <div className="flex items-start gap-2.5 rounded-lg border border-status-info-border bg-status-info-bg px-3.5 py-2.5 text-xs text-status-info-text">
            <Info className="mt-0.5 size-4 shrink-0 text-status-info-icon" />
            <span>Filtro SQL obligatorio <code>is_confidential = 0</code>: ningún registro interno o confidencial sale del borde.</span>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
          <div className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
                <FileText className="size-4 text-muted-foreground" /><span>Adjuntos Públicos</span>
              </h2>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{attachments.length}</span>
            </div>
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin adjuntos no confidenciales.</p>
            ) : (
              <ul className="divide-y divide-border/70 rounded-lg border border-border">
                {attachments.map((att) => (
                  <li key={att.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="truncate font-medium">{att.fileName}</span>
                    <a
                      href={`/api/media/${encodeURIComponent((att as { r2Key?: string }).r2Key ?? att.fileName)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <Download className="size-3" /><span>Abrir</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
                <MessageSquare className="size-4 text-muted-foreground" /><span>Mensajes Visibles</span>
              </h2>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{messages.length}</span>
            </div>
            {messages.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin mensajes no confidenciales.</p>
            ) : (
              <ul className="divide-y divide-border/70 rounded-lg border border-border">
                {messages.map((msg) => (
                  <li key={msg.id} className="space-y-0.5 px-3 py-2 text-xs">
                    <p className="font-medium">{msg.subject ?? msg.threadKind}</p>
                    <p className="text-muted-foreground">{msg.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={handleSend} className="space-y-2 border-t border-border pt-3">
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Asunto del mensaje público" className={`${INPUT_CLS} w-full`} />
              <div className="flex gap-2">
                <input value={bodyText} onChange={(e) => setBodyText(e.target.value)} placeholder="Escribe un mensaje visible en portal..." className={`${INPUT_CLS} flex-1`} required />
                <button type="submit" disabled={sendMessageMutation.isPending} className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
                  <Send className="size-3" /><span>Enviar</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
