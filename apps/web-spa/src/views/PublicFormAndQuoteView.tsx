import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileText, Receipt, XCircle } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '@shac/ui';
import { formatMinorUnits } from './phase2-format';

export interface FormFieldSpec {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'textarea';
  required: boolean;
}

function toFieldSlug(label: string, idx: number, used: Set<string>): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `campo_${idx + 1}`;
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${n++}`;
  }
  used.add(candidate);
  return candidate;
}

function inferFieldType(labelOrName: string): FormFieldSpec['type'] {
  const lower = labelOrName.toLowerCase();
  if (lower.includes('correo') || lower.includes('email') || lower.includes('mail')) return 'email';
  if (lower.includes('tel') || lower.includes('phone') || lower.includes('cel') || lower.includes('whatsapp')) return 'tel';
  if (lower.includes('mensaje') || lower.includes('nota') || lower.includes('coment') || lower.includes('detalle')) return 'textarea';
  return 'text';
}

export function normalizeFormFields(rawSchema: string | { fields?: unknown[] } | null | undefined): FormFieldSpec[] {
  const fallback: FormFieldSpec[] = [
    { name: 'fullName', label: 'Nombre completo o Empresa', type: 'text', required: true },
    { name: 'email', label: 'Correo electrónico', type: 'email', required: true },
    { name: 'notes', label: 'Comentarios', type: 'textarea', required: false },
  ];
  let parsed: { fields?: unknown[] } | null = null;
  if (typeof rawSchema === 'string') {
    try {
      parsed = JSON.parse(rawSchema || '{}') as { fields?: unknown[] };
    } catch {
      parsed = null;
    }
  } else if (rawSchema && typeof rawSchema === 'object') {
    parsed = rawSchema;
  }
  const rawFields = Array.isArray(parsed?.fields) ? parsed.fields : [];
  if (rawFields.length === 0) return fallback;

  const used = new Set<string>();
  const out: FormFieldSpec[] = [];
  rawFields.forEach((entry, idx) => {
    if (typeof entry === 'string') {
      const label = entry.trim();
      if (!label) return;
      out.push({
        name: toFieldSlug(label, idx, used),
        label,
        type: inferFieldType(label),
        required: true,
      });
      return;
    }
    if (entry && typeof entry === 'object') {
      const rec = entry as Record<string, unknown>;
      const rawName = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : '';
      const rawLabel = typeof rec.label === 'string' && rec.label.trim() ? rec.label.trim() : rawName || `Campo ${idx + 1}`;
      const name = rawName ? (used.has(rawName) ? toFieldSlug(rawName, idx, used) : (used.add(rawName), rawName)) : toFieldSlug(rawLabel, idx, used);
      const t = rec.type;
      const type: FormFieldSpec['type'] = t === 'email' || t === 'tel' || t === 'textarea' || t === 'text' ? t : inferFieldType(rawLabel);
      out.push({
        name,
        label: rawLabel,
        type,
        required: rec.required !== false,
      });
    }
  });
  return out.length > 0 ? out : fallback;
}

function getQueryTenantId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const tid = new URLSearchParams(window.location.search).get('tenantId')?.trim();
  return tid || undefined;
}

/** Public unauthenticated form renderer at /f/$slug. */
export function PublicFormView({ slug }: { slug: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const queryTenantId = getQueryTenantId();

  const formQuery = useQuery({
    queryKey: ['public', 'form', slug, queryTenantId ?? 'default'],
    queryFn: async () => {
      const qs = queryTenantId ? `?tenantId=${encodeURIComponent(queryTenantId)}` : '';
      const res = await fetch(`/api/public/forms/${encodeURIComponent(slug)}${qs}`);
      if (!res.ok) throw new Error(`Formulario no encontrado (${res.status})`);
      return res.json() as Promise<{
        formSlug: string;
        schema: { title?: string; description?: string; fields?: unknown[] };
      }>;
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const payload: { tenantId?: string; answers: Record<string, string> } = { answers };
      if (queryTenantId) payload.tenantId = queryTenantId;
      const res = await fetch(`/api/public/forms/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ ok: boolean; submissionId: string }>;
    },
    onSuccess: (data) => setSubmittedId(data.submissionId),
  });

  const fields = normalizeFormFields(formQuery.data?.schema);

  return (
    <div className="mx-auto max-w-xl py-8">
      <div className="rounded-lg border border-border bg-card p-6 shadow-xs">
        <div className="mb-4 flex items-center gap-2.5 border-b border-border pb-4">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FileText className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {formQuery.data?.schema?.title ?? `Formulario: ${slug}`}
            </h1>
            <p className="text-xs text-muted-foreground">
              {formQuery.data?.schema?.description ?? 'Portal público de envío directo · SuperHyperArchiCRM'}
            </p>
          </div>
        </div>

        {formQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando formulario...</p>
        ) : formQuery.isError ? (
          <p className="text-sm text-destructive">{(formQuery.error as Error).message}</p>
        ) : submittedId ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-10 text-emerald-600" />
            <h2 className="text-base font-semibold text-foreground">¡Respuesta registrada!</h2>
            <p className="text-xs text-muted-foreground">Código de confirmación: {submittedId}</p>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitMutation.mutate();
            }}
          >
            {fields.map((f) => (
              <div key={f.name} className="space-y-1">
                <label htmlFor={`pub-f-${f.name}`} className="block text-xs font-medium text-foreground">
                  {f.label} {f.required ? <span className="text-destructive">*</span> : null}
                </label>
                {f.type === 'textarea' ? (
                  <textarea
                    id={`pub-f-${f.name}`}
                    required={f.required}
                    rows={3}
                    value={answers[f.name] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [f.name]: e.target.value }))}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                ) : (
                  <input
                    id={`pub-f-${f.name}`}
                    type={f.type}
                    required={f.required}
                    value={answers[f.name] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [f.name]: e.target.value }))}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
              </div>
            ))}
            {submitMutation.isError ? (
              <p className="text-xs text-destructive">{(submitMutation.error as Error).message}</p>
            ) : null}
            <button
              type="submit"
              disabled={submitMutation.isPending}
              className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {submitMutation.isPending ? 'Enviando...' : 'Enviar formulario'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
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
      return res.json() as Promise<{
        orderNumber: string;
        currency: string;
        grandTotalMinor: number;
        status: string;
      }>;
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
                  <input
                    id="quote-name"
                    type="text"
                    placeholder="Tu nombre completo"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="quote-email" className="block text-xs font-medium text-foreground">Correo corporativo (opcional)</label>
                  <input
                    id="quote-email"
                    type="email"
                    placeholder="nombre@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="quote-comment" className="block text-xs font-medium text-foreground">Comentarios / Observaciones (opcional)</label>
                  <textarea
                    id="quote-comment"
                    rows={2}
                    placeholder="Notas sobre entrega, condiciones o motivo..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                {decisionMutation.isError ? (
                  <p className="text-xs text-destructive">{(decisionMutation.error as Error).message}</p>
                ) : null}
                {confirmReject ? (
                  <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <p className="text-xs font-medium text-destructive">¿Confirmas rechazar definitivamente esta cotización?</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={decisionMutation.isPending}
                        onClick={() => decisionMutation.mutate('REJECTED')}
                        className="inline-flex h-8 items-center rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground"
                      >
                        Sí, rechazar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmReject(false)}
                        className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={decisionMutation.isPending}
                      onClick={() => decisionMutation.mutate('ACCEPTED')}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                    >
                      <CheckCircle2 className="size-4" />
                      Aprobar Cotización
                    </button>
                    <button
                      type="button"
                      disabled={decisionMutation.isPending}
                      onClick={() => setConfirmReject(true)}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-muted-foreground hover:bg-muted"
                    >
                      <XCircle className="size-4" />
                      Rechazar
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
