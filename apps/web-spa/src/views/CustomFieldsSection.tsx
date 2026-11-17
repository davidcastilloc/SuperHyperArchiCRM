import { useQuery } from '@tanstack/react-query';
import { INPUT_CLS, type Phase2ViewProps } from './phase2-format';

interface CustomFieldsSectionProps {
  rpc: Phase2ViewProps['rpc'];
  targetEntity: 'crm_parties' | 'cat_products' | 'com_orders' | 'spc_units' | 'leg_matters';
  values: Record<string, string | number | boolean>;
  onChange: (next: Record<string, string | number | boolean>) => void;
}

/** Dynamically renders labeled inputs for tenant custom fields (v_cf_*) on any targetEntity. */
export function CustomFieldsSection({ rpc, targetEntity, values, onChange }: CustomFieldsSectionProps) {
  const fieldsQuery = useQuery({
    queryKey: ['system', 'custom-fields', targetEntity],
    queryFn: async () => {
      const res = await rpc.api.system['custom-fields'].$get({ query: { entityType: targetEntity } });
      if (!res.ok) return { items: [] as Array<{ id: string; fieldKey: string; label: string; dataType: string; isRequired: boolean }> };
      return res.json();
    },
    staleTime: 60_000,
  });

  const defs = fieldsQuery.data?.items ?? [];
  if (defs.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-2.5 rounded-lg border border-border/80 bg-muted/20 p-3 sm:grid-cols-2">
      {defs.map((f) => {
        const val = values[f.fieldKey];
        if (f.dataType === 'boolean') {
          return (
            <label key={f.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={Boolean(val)}
                onChange={(e) => onChange({ ...values, [f.fieldKey]: e.target.checked })}
              />
              <span className="font-medium">{f.label}</span>
            </label>
          );
        }
        return (
          <label key={f.id} className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">
              {f.label} {f.isRequired ? '*' : ''}
            </span>
            <input
              type={f.dataType === 'number' ? 'number' : f.dataType === 'date' ? 'date' : 'text'}
              required={f.isRequired}
              value={val === undefined ? '' : String(val)}
              onChange={(e) =>
                onChange({
                  ...values,
                  [f.fieldKey]: f.dataType === 'number' ? Number(e.target.value) : e.target.value,
                })
              }
              className={`${INPUT_CLS} w-full`}
            />
          </label>
        );
      })}
    </div>
  );
}
