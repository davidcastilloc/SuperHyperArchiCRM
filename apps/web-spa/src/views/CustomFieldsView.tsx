import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Plus } from 'lucide-react';
import { DataTable, PageHeader, StatusBadge, type DataTableColumn } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

type TargetEntity = 'crm_parties' | 'cat_products' | 'iam_organizations';
type FieldDataType = 'text' | 'number' | 'boolean' | 'date' | 'select';

/** Open Mercato DS v3 Custom Fields & Entities schema builder (v_cf_* virtual columns). */
export function CustomFieldsView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [entityType, setEntityType] = useState<TargetEntity>('crm_parties');
  const [fieldKey, setFieldKey] = useState('segmento_comercial');
  const [label, setLabel] = useState('Segmento Comercial');
  const [dataType, setDataType] = useState<FieldDataType>('text');
  const [isRequired, setIsRequired] = useState(false);
  const [isIndexed, setIsIndexed] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fieldsQuery = useQuery({
    queryKey: ['system', 'custom-fields'],
    queryFn: async () => {
      const res = await rpc.api.system['custom-fields'].$get({ query: {} });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.system['custom-fields'].$post({
        json: {
          entityType,
          fieldKey: fieldKey.trim(),
          label: label.trim(),
          dataType,
          isRequired,
          isIndexed,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (created) => {
      setFeedback(
        created.virtualColumnName
          ? `Campo ${created.fieldKey} guardado · Columna indexada ${created.virtualColumnName}`
          : `Campo ${created.fieldKey} guardado`,
      );
      void queryClient.invalidateQueries({ queryKey: ['system', 'custom-fields'] });
    },
    onError: (err) => setFeedback(err.message),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!fieldKey.trim() || !label.trim() || createMutation.isPending) return;
    createMutation.mutate();
  }

  const items = fieldsQuery.data?.items ?? [];
  type FieldRow = (typeof items)[number];
  const columns: DataTableColumn<FieldRow>[] = [
    { id: 'entity', header: 'Tabla Troncal', cell: (f) => <span className="font-mono text-xs">{f.entityType}</span> },
    {
      id: 'key',
      header: 'Campo Personalizado',
      sortValue: (f) => f.fieldKey,
      cell: (f) => (
        <div className="space-y-0.5">
          <p className="font-medium">{f.label}</p>
          <p className="font-mono text-[11px] text-muted-foreground">$.{f.fieldKey}</p>
        </div>
      ),
    },
    { id: 'type', header: 'Tipo', cell: (f) => <StatusBadge label={f.dataType} tone="neutral" /> },
    {
      id: 'index',
      header: 'Índice B-Tree (D1)',
      cell: (f) =>
        f.isIndexed && f.virtualColumnName ? (
          <StatusBadge label={f.virtualColumnName} tone="success" appearance="dot" />
        ) : (
          <StatusBadge label="JSON puro" tone="neutral" appearance="dot" />
        ),
    },
    {
      id: 'ddl',
      header: 'DDL Aditivo',
      cell: (f) => (
        <span className="block max-w-xs truncate font-mono text-[11px] text-muted-foreground">
          {f.indexSql ?? 'Sin índice secundario'}
        </span>
      ),
    },
  ];

  return (
    <section className="space-y-5" data-slot="custom-fields-view">
      <PageHeader
        title="Campos Personalizados & Entidades (`v_cf_*`)"
        description="Extiende tablas troncales sin migraciones destructivas usando columnas virtuales indexadas en SQLite/D1."
        onRefresh={() => void fieldsQuery.refetch()}
        refreshing={fieldsQuery.isFetching}
        actions={<StatusBadge label="Expand-Only DDL" tone="info" icon={<Database className="size-3" />} />}
      />

      <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
        <h2 className="text-sm font-semibold">Definir Nuevo Campo Personalizado</h2>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-5">
          <select value={entityType} onChange={(e) => setEntityType(e.target.value as TargetEntity)} className={INPUT_CLS}>
            <option value="crm_parties">crm_parties (Clientes)</option>
            <option value="cat_products">cat_products (Catálogo)</option>
            <option value="iam_organizations">iam_organizations (Sucursales)</option>
          </select>
          <input value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} placeholder="clave_snake_case" className={`${INPUT_CLS} font-mono text-xs`} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Etiqueta visible" className={INPUT_CLS} />
          <select value={dataType} onChange={(e) => setDataType(e.target.value as FieldDataType)} className={INPUT_CLS}>
            <option value="text">Texto (text)</option>
            <option value="number">Número (number)</option>
            <option value="boolean">Booleano (boolean)</option>
            <option value="date">Fecha (date)</option>
            <option value="select">Selector (select)</option>
          </select>
          <button type="submit" disabled={createMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs">
            <Plus className="size-3.5" />
            <span>Guardar Campo</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-5 pt-1 text-xs text-muted-foreground">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={isIndexed} onChange={(e) => setIsIndexed(e.target.checked)} />
            <span>Generar columna virtual indexada (`v_cf_{fieldKey || 'campo'}`)</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
            <span>Obligatorio en formularios</span>
          </label>
        </div>
      </form>

      {feedback ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p> : null}

      <DataTable
        columns={columns}
        data={items}
        getRowId={(f) => f.id}
        loading={fieldsQuery.isLoading}
        emptyTitle="Sin campos personalizados definidos"
        emptyDescription="Agrega atributos dinámicos a Clientes, Productos o Sucursales."
      />
    </section>
  );
}
