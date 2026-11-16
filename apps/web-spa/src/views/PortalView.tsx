import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, FileText, Info, MessageSquare, ShieldCheck } from 'lucide-react';
import { PageHeader, StatusBadge } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Client Portal view enforcing SQL is_confidential = 0 filtering. */
export function PortalView({ vocabulary, rpc }: Phase2ViewProps) {
  const [partyFilter, setPartyFilter] = useState('');

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

  const parties = partiesQuery.data?.items ?? [];
  const attachments = portalQuery.data?.attachments ?? [];
  const messages = portalQuery.data?.messages ?? [];

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
            <option value="">Todos los clientes</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </select>
        }
      />

      <div className="rounded-xl border border-border bg-card shadow-xs divide-y divide-border">
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge
              label="Portal Externo · Zero-Trust"
              tone="neutral"
              icon={<ShieldCheck className="size-3.5" />}
            />
            <StatusBadge label="En revisión activa" tone="success" appearance="dot" />
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-status-info-border bg-status-info-bg px-3.5 py-2.5 text-xs text-status-info-text">
            <Info className="mt-0.5 size-4 shrink-0 text-status-info-icon" />
            <span>
              Filtro SQL obligatorio <code>is_confidential = 0</code>: ningún registro interno o confidencial sale del borde.
            </span>
          </div>

          <ol className="space-y-4 pt-1">
            <li className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-status-success-icon text-white">
                <Check className="size-3.5" />
              </span>
              <div>
                <p className="text-sm font-medium">Identidad de portal validada</p>
                <p className="text-xs text-muted-foreground">Alcance restringido a registros autorizados de {vocabulary.branchSingular}.</p>
              </div>
            </li>
            <li className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-xs font-semibold text-primary-foreground">
                  2
                </span>
                <div>
                  <p className="text-sm font-medium">Sincronización de documentos y mensajes públicos</p>
                  <p className="text-xs text-muted-foreground">
                    {attachments.length} adjuntos visibles · {messages.length} comunicaciones compartidas.
                  </p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">Ahora</span>
            </li>
            <li className="flex items-start gap-3 opacity-65">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs text-muted-foreground">
                3
              </span>
              <div>
                <p className="text-sm font-medium">Conformidad o cierre de solicitud</p>
                <p className="text-xs text-muted-foreground">Notificación automática al titular al actualizar el expediente.</p>
              </div>
            </li>
          </ol>
        </div>

        <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
                <FileText className="size-4 text-muted-foreground" />
                <span>Adjuntos Públicos</span>
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
                    <StatusBadge label={att.entityType} tone="neutral" appearance="dot" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
                <MessageSquare className="size-4 text-muted-foreground" />
                <span>Mensajes Visibles</span>
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
          </div>
        </div>
      </div>
    </section>
  );
}
