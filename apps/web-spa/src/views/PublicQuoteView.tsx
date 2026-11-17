import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Receipt, XCircle } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '@shac/ui';
import { formatMinorUnits } from './phase2-format';

function getQueryTenantId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const val = new URLSearchParams(window.location.search).get('tenantId')?.trim();
  return val || undefined;
}

/** Public unauthenticated quote approval portal at /quote/$orderNumber. */
export function PublicQuoteView({ orderNumber }: { orderNumber: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);
  const [decisionStatus, setDecisionStatus] = useState<string | null>(null);
  const queryTenantId = getQueryTenantId();

  const quoteQuery = useQuery({
    queryKey: ['public', 'quote', orderNumber, queryTenantId ?? 'default'],
    queryFn: async () => {
      const qs = queryTenantId ? `?tenantId=${encodeURIComponent(queryTenantId)}` : '';
      const res = await fetch(`/api/public/quotes/${encodeURIComponent(orderNumber)}${qs}`);
      if (!res.ok) throw new Error(`Cotización no encontrada (${res.status})`);
      return res.json() as Promise<{ orderNumber: string; currency: string; grandTotalMinor: number; status: string }>;
    },
  });

  const decisionMutation = useMutation({
    mutationFn: async (decision: 'ACCEPTED' | 'REJECTED') => {
      const payload: Record<string, unknown> = {
        decision,
        acceptedByName: name.trim() || 'Cliente Portal',
        acceptedByEmail: email.trim() || undefined,
        comment: comment.trim() || undefined,
      };
      if (queryTenantId) payload.tenantId = queryTenantId;
      const res = await fetch(`/api/public/quotes/${encodeURIComponent(orderNumber)}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ ok: boolean; status: string }>;
    },
    onSuccess: (data) => {
      setDecisionStatus(data.status);
      setConfirmReject(false);
    },
  });

  const q = quoteQuery.data;
  const effectiveStatus = decisionStatus ?? q?.status;
  const isAlreadyDecided = effectiveStatus === 'fulfilled' || effectiveStatus === 'cancelled';

  return (
    <div className="mx-auto max-w-xl py-8">
      <div className="rounded-lg border border-border bg-card p-6 shadow-xs">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Receipt className="size-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Cotización {orderNumber}</h1>
              <p className="text-xs text-muted-foreground">Aprobación pública de presupuesto</p>
            </div>
          </div>
          {q ? <StatusBadge label={effectiveStatus ?? q.status} /> : null}
        </div>

        {quoteQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando cotización...</p>
        ) : quoteQuery.isError ? (
          <p className="text-sm text-destructive">{(quoteQuery.error as Error).message}</p>
        ) : q ? (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">Total Neto Presupuestado</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-foreground tabular-nums">
                {formatMinorUnits(q.grandTotalMinor, q.currency)}
              </p>
            </div>
            {isAlreadyDecided ? (
              <p className="rounded-md border border-border bg-muted/30 p-3 text-sm font-medium text-foreground">
                Decisión registrada y bloqueada con estado: <span className="font-mono">{effectiveStatus}</span>
              </p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="quote-name" className="block text-xs font-medium text-foreground">Nombre completo</label>
                  <input id="quote-name" type="text" placeholder="Tu nombre completo" value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="quote-email" className="block text-xs font-medium text-foreground">Correo corporativo (opcional)</label>
                  <input id="quote-email" type="email" placeholder="nombre@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="quote-comment" className="block text-xs font-medium text-foreground">Comentarios / Observaciones (opcional)</label>
                  <textarea id="quote-comment" rows={2} placeholder="Notas sobre entrega, condiciones o motivo..." value={comment} onChange={(e) => setComment(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                </div>
                {decisionMutation.isError ? (
                  <p className="text-xs text-destructive">{(decisionMutation.error as Error).message}</p>
                ) : null}
                {confirmReject ? (
                  <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <p className="text-xs font-medium text-destructive">¿Confirmas rechazar definitivamente esta cotización?</p>
                    <div className="flex gap-2">
                      <button type="button" disabled={decisionMutation.isPending} onClick={() => decisionMutation.mutate('REJECTED')} className="inline-flex h-8 items-center rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground">Sí, rechazar</button>
                      <button type="button" onClick={() => setConfirmReject(false)} className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button type="button" disabled={decisionMutation.isPending} onClick={() => decisionMutation.mutate('ACCEPTED')} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
                      <CheckCircle2 className="size-4" />Aprobar Cotización
                    </button>
                    <button type="button" disabled={decisionMutation.isPending} onClick={() => setConfirmReject(true)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-muted-foreground hover:bg-muted">
                      <XCircle className="size-4" />Rechazar
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
