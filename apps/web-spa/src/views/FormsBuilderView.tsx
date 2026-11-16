import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus, Send } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Forms Builder & Public Form Submissions view. */
export function FormsBuilderView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [formSlug, setFormSlug] = useState('contacto-b2b');
  const [fieldsSpec, setFieldsSpec] = useState('nombre,correo,telefono,mensaje');
  const [answerName, setAnswerName] = useState('');

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
      const fields = fieldsSpec.split(',').map((f) => f.trim()).filter(Boolean);
      const res = await rpc.api.portal.forms.$post({
        json: { recordKind: 'form_definition', formSlug: formSlug.trim(), schemaJson: JSON.stringify({ fields }) },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['portal', 'forms'] }),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.portal.forms.$post({
        json: { recordKind: 'form_submission', formSlug: formSlug.trim(), answersJson: JSON.stringify({ nombre: answerName.trim() }) },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setAnswerName('');
      void queryClient.invalidateQueries({ queryKey: ['portal', 'forms'] });
    },
  });

  const items = formsQuery.data?.items ?? [];
  type FormRow = (typeof items)[number];
  const columns: DataTableColumn<FormRow>[] = [
    { id: 'slug', header: 'Slug / URL Pública', cell: (f) => <span className="font-mono text-xs font-medium">/f/{f.formSlug}</span> },
    { id: 'kind', header: 'Tipo', cell: (f) => <StatusBadge label={f.recordKind === 'form_definition' ? 'Definición' : 'Respuesta'} tone={f.recordKind === 'form_definition' ? 'info' : 'success'} /> },
    { id: 'payload', header: 'Esquema / Respuestas', cell: (f) => <span className="block max-w-md truncate font-mono text-[11px] text-muted-foreground">{f.recordKind === 'form_definition' ? f.schemaJson : f.answersJson}</span> },
    { id: 'st', header: 'Estado', cell: (f) => <StatusBadge label={f.status} tone="success" appearance="dot" /> },
  ];

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!formSlug.trim()) return;
    createDefMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="forms-builder-view">
      <PageHeader title="Constructor de Formularios & Envíos Públicos" description="Diseña formularios embebibles (/f/[slug]) y captura respuestas firmadas en D1." actions={<StatusBadge label="Embeddable Forms" tone="info" icon={<ClipboardList className="size-3" />} />} />

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={handleCreate} className="space-y-2.5 rounded-xl border border-border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold">1. Definir Formulario</h2>
          <input value={formSlug} onChange={(e) => setFormSlug(e.target.value)} placeholder="slug-formulario" className={`${INPUT_CLS} w-full font-mono text-xs`} />
          <input value={fieldsSpec} onChange={(e) => setFieldsSpec(e.target.value)} placeholder="Campos separados por coma" className={`${INPUT_CLS} w-full`} />
          <button type="submit" disabled={createDefMutation.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" /><span>Publicar Formulario</span></button>
        </form>

        <div className="space-y-2.5 rounded-xl border border-border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold">2. Probar Envío Público (/f/{formSlug})</h2>
          <input value={answerName} onChange={(e) => setAnswerName(e.target.value)} placeholder="Nombre del solicitante" className={`${INPUT_CLS} w-full`} />
          <button type="button" disabled={!answerName.trim() || submitMutation.isPending} onClick={() => submitMutation.mutate()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted"><Send className="size-3.5 text-muted-foreground" /><span>Enviar Respuesta</span></button>
        </div>
      </div>

      <DataTable columns={columns} data={items} getRowId={(f) => f.id} loading={formsQuery.isLoading} emptyTitle="Sin formularios publicados" />
    </section>
  );
}
