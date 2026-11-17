import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Copy, ExternalLink, Plus, Send } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';
import { normalizeFormFields } from './PublicFormAndQuoteView';

/** Open Mercato DS v3 Forms Builder & Public Form Submissions view. */
export function FormsBuilderView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [formSlug, setFormSlug] = useState('contacto-b2b');
  const [fieldsSpec, setFieldsSpec] = useState('Nombre Completo, Correo Electrónico, Teléfono, Mensaje');
  const [answerName, setAnswerName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const formsQuery = useQuery({
    queryKey: ['portal', 'forms'],
    queryFn: async () => {
      const res = await rpc.api.portal.forms.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const createDefMutation = useMutation({
    mutationFn: async () => {
      const rawLabels = fieldsSpec.split(',').map((f) => f.trim()).filter(Boolean);
      const fields = normalizeFormFields(JSON.stringify({ fields: rawLabels }));
      const res = await rpc.api.portal.forms.$post({
        json: {
          recordKind: 'form_definition',
          formSlug: formSlug.trim(),
          schemaJson: JSON.stringify({ title: `Formulario ${formSlug.trim()}`, fields }),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['portal', 'forms'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.portal.forms.$post({
        json: {
          recordKind: 'form_submission',
          formSlug: formSlug.trim(),
          answersJson: JSON.stringify({ nombre_completo: answerName.trim() }),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setErrorMsg(null);
      setAnswerName('');
      void queryClient.invalidateQueries({ queryKey: ['portal', 'forms'] });
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const items = formsQuery.data?.items ?? [];
  const definitions = items.filter((f) => f.recordKind === 'form_definition');
  const submissions = items.filter((f) => f.recordKind === 'form_submission');
  type FormRow = (typeof items)[number];

  function copyPublicUrl(slug: string) {
    const url = `${window.location.origin}/f/${slug}`;
    void navigator.clipboard?.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  }

  const defColumns: DataTableColumn<FormRow>[] = [
    { id: 'slug', header: 'Slug / URL Pública', cell: (f) => <span className="font-mono text-xs font-medium">/f/{f.formSlug}</span> },
    { id: 'schema', header: 'Campos Definidos', cell: (f) => <span className="block max-w-md truncate font-mono text-[11px] text-muted-foreground">{f.schemaJson}</span> },
    { id: 'st', header: 'Estado', cell: (f) => <StatusBadge label={f.status} tone="success" appearance="dot" /> },
    {
      id: 'actions',
      header: 'Enlace Público',
      cell: (f) => (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => copyPublicUrl(f.formSlug)}
            className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] font-medium hover:bg-muted"
          >
            <Copy className="size-3" />
            <span>{copiedSlug === f.formSlug ? 'Copiado' : 'Copiar'}</span>
          </button>
          <a
            href={`/f/${f.formSlug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] font-medium hover:bg-muted"
          >
            <ExternalLink className="size-3" />
            <span>Abrir</span>
          </a>
        </div>
      ),
    },
  ];

  const subColumns: DataTableColumn<FormRow>[] = [
    { id: 'slug', header: 'Formulario', cell: (f) => <span className="font-mono text-xs font-medium">/f/{f.formSlug}</span> },
    { id: 'answers', header: 'Respuestas Recibidas', cell: (f) => <span className="block max-w-lg truncate font-mono text-[11px] text-muted-foreground">{f.answersJson}</span> },
    { id: 'st', header: 'Estado', cell: (f) => <StatusBadge label={f.status} tone="info" appearance="dot" /> },
  ];

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!formSlug.trim()) return;
    createDefMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="forms-builder-view">
      <PageHeader
        title="Constructor de Formularios & Envíos Públicos"
        description="Diseña formularios embebibles (/f/[slug]) y captura respuestas firmadas en D1."
        actions={<StatusBadge label="Embeddable Forms" tone="info" icon={<ClipboardList className="size-3" />} />}
      />

      {errorMsg ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={handleCreate} className="space-y-2.5 rounded-xl border border-border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold">1. Definir Formulario</h2>
          <div className="space-y-1">
            <label htmlFor="fb-slug" className="block text-xs font-medium">Slug público (/f/...)</label>
            <input id="fb-slug" value={formSlug} onChange={(e) => setFormSlug(e.target.value)} placeholder="slug-formulario" className={`${INPUT_CLS} w-full font-mono text-xs`} />
          </div>
          <div className="space-y-1">
            <label htmlFor="fb-fields" className="block text-xs font-medium">Campos (separados por coma)</label>
            <input id="fb-fields" value={fieldsSpec} onChange={(e) => setFieldsSpec(e.target.value)} placeholder="Nombre Completo, Correo, Teléfono, Mensaje" className={`${INPUT_CLS} w-full`} />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="submit" disabled={createDefMutation.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
              <Plus className="size-3.5" />
              <span>Publicar Formulario</span>
            </button>
            <button type="button" onClick={() => copyPublicUrl(formSlug.trim() || 'contacto-b2b')} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted">
              <Copy className="size-3.5 text-muted-foreground" />
              <span>Copiar / Abrir enlace público (/f/{formSlug.trim() || 'contacto-b2b'})</span>
            </button>
          </div>
        </form>

        <div className="space-y-2.5 rounded-xl border border-border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold">2. Probar Envío Público (/f/{formSlug})</h2>
          <div className="space-y-1">
            <label htmlFor="fb-answer" className="block text-xs font-medium">Nombre del solicitante</label>
            <input id="fb-answer" value={answerName} onChange={(e) => setAnswerName(e.target.value)} placeholder="Nombre del solicitante" className={`${INPUT_CLS} w-full`} />
          </div>
          <button
            type="button"
            disabled={!answerName.trim() || submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted"
          >
            <Send className="size-3.5 text-muted-foreground" />
            <span>Enviar Respuesta</span>
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Definiciones Publicadas</h3>
        <DataTable columns={defColumns} data={definitions} getRowId={(f) => f.id} loading={formsQuery.isLoading} emptyTitle="Sin formularios publicados" />
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Respuestas Capturadas</h3>
        <DataTable columns={subColumns} data={submissions} getRowId={(f) => f.id} loading={formsQuery.isLoading} emptyTitle="Sin respuestas registradas" />
      </div>
    </section>
  );
}
