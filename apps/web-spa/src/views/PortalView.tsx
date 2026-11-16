import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** Client Portal view enforcing SQL is_confidential = 0 filtering. */
export function PortalView({ rpc }: Phase2ViewProps) {
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
    <section className="space-y-4 p-4" data-slot="portal-view">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Portal Cliente · Documentos & Mensajes</h1>
          <p className="text-sm text-muted-foreground">
            Filtro SQL obligatorio <code>is_confidential = 0</code>: los registros confidenciales nunca se exponen.
          </p>
        </div>
        <button type="button" onClick={() => void portalQuery.refetch()} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium">
          Actualizar
        </button>
      </div>

      <div className="max-w-xs">
        <select
          className={INPUT_CLS}
          value={partyFilter}
          onChange={(e) => setPartyFilter(e.target.value)}
        >
          <option value="">Todos los clientes</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">Adjuntos Públicos ({attachments.length})</h2>
          {attachments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin adjuntos no confidenciales.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {attachments.map((att) => (
                <li key={att.id} className="flex justify-between rounded border border-border/60 px-2 py-1">
                  <span>{att.fileName}</span>
                  <span className="text-muted-foreground">{att.entityType}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">Mensajes Visibles ({messages.length})</h2>
          {messages.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin mensajes no confidenciales.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {messages.map((msg) => (
                <li key={msg.id} className="rounded border border-border/60 px-2 py-1">
                  <p className="font-medium">{msg.subject ?? msg.threadKind}</p>
                  <p className="text-muted-foreground">{msg.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
