import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileText, Receipt, XCircle } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '@shac/ui';

interface FormFieldSpec {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
}

/** Public unauthenticated form renderer at /f/$slug. */
export function PublicFormView({ slug }: { slug: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const formQuery = useQuery({
    queryKey: ['public', 'form', slug],
    queryFn: async () => {
      const res = await fetch(`/api/public/forms/${encodeURIComponent(slug)}?tenantId=ten_1`);
      if (!res.ok) throw new Error(`Formulario no encontrado (${res.status})`);
      return res.json() as Promise<{
        formSlug: string;
        schema: { title?: string; description?: string; fields?: FormFieldSpec[] };
      }>;
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/public/forms/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: 'ten_1', answers }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ ok: boolean; submissionId: string }>;
    },
    onSuccess: (data) => setSubmittedId(data.submissionId),
  });

  const fields = formQuery.data?.schema?.fields ?? [
    { name: 'fullName', label: 'Nombre completo o Empresa', type: 'text', required: true },
    { name: 'email', label: 'Correo electrónico', type: 'email', required: true },
    { name: 'notes', label: 'Comentarios', type: 'text', required: false },
  ];

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
                <label className="block text-xs font-medium text-foreground">
                  {f.label ?? f.name} {f.required ? <span className="text-destructive">*</span> : null}
                </label>
                <input
                  type={f.type ?? 'text'}
                  required={Boolean(f.required)}
                  value={answers[f.name] ?? ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [f.name]: e.target.value }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            ))}
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
  const [decisionStatus, setDecisionStatus] = useState<string | null>(null);

  const quoteQuery = useQuery({
    queryKey: ['public', 'quote', orderNumber],
    queryFn: async () => {
      const res = await fetch(`/api/public/quotes/${encodeURIComponent(orderNumber)}?tenantId=ten_1`);
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
      const res = await fetch(`/api/public/quotes/${encodeURIComponent(orderNumber)}/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: 'ten_1',
          decision,
          acceptedByName: name.trim() || 'Cliente Portal',
          acceptedByEmail: email.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ ok: boolean; status: string }>;
    },
    onSuccess: (data) => setDecisionStatus(data.status),
  });

  const q = quoteQuery.data;
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
          {q ? <StatusBadge label={decisionStatus ?? q.status} /> : null}
        </div>

        {quoteQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando cotización...</p>
        ) : quoteQuery.isError ? (
          <p className="text-sm text-destructive">{(quoteQuery.error as Error).message}</p>
        ) : q ? (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">Total Neto Presupuestado</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-foreground">
                {q.currency} {(q.grandTotalMinor / 100).toFixed(2)}
              </p>
            </div>
            {decisionStatus ? (
              <p className="text-sm font-medium text-foreground">
                Decisión registrada con estado: <span className="font-mono">{decisionStatus}</span>
              </p>
            ) : (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Tu nombre completo"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <input
                  type="email"
                  placeholder="Correo corporativo (opcional)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
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
                    onClick={() => decisionMutation.mutate('REJECTED')}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-muted-foreground hover:bg-muted"
                  >
                    <XCircle className="size-4" />
                    Rechazar
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
