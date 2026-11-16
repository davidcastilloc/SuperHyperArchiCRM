import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatMinorUnits,
  INPUT_CLS,
  parseNonNegInt,
  readApiError,
  type Phase2ViewProps,
} from './phase2-format';

const PARTY_ROLE_OPTIONS = [
  'customer',
  'vendor',
  'patient',
  'guest',
  'tenant_resident',
  'legal_client',
  'carrier',
] as const;

type PartyRoleOption = (typeof PARTY_ROLE_OPTIONS)[number];

/** Dynamic-vocabulary Parties directory and quick-upsert view. */
export function PartiesView({ vocabulary, rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [taxIdNumber, setTaxIdNumber] = useState('');
  const [creditLimitMinor, setCreditLimitMinor] = useState('0');
  const [role, setRole] = useState<PartyRoleOption>('customer');

  const listQuery = useQuery({
    queryKey: ['customers', 'parties', search],
    queryFn: async () => {
      const trimmed = search.trim();
      const res = await rpc.api.customers.parties.$get({
        query: trimmed ? { limit: '50', search: trimmed } : { limit: '50' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.customers.parties.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          rolesMask: [role],
          displayName: displayName.trim(),
          taxIdNumber: taxIdNumber.trim() || undefined,
          creditLimitMinor: parseNonNegInt(creditLimitMinor, 0),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setDisplayName('');
      setTaxIdNumber('');
      setCreditLimitMinor('0');
      void queryClient.invalidateQueries({ queryKey: ['customers', 'parties'] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim() || upsertMutation.isPending) return;
    upsertMutation.mutate();
  }

  const items = listQuery.data?.items ?? [];

  return (
    <section className="space-y-4 p-4" data-slot="parties-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{vocabulary.partyPlural}</h1>
          <p className="text-sm text-muted-foreground">
            Directorio multi-rol de {vocabulary.partyPlural.toLowerCase()} en {vocabulary.branchSingular}.
          </p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Buscar ${vocabulary.partySingular.toLowerCase()}...`}
          className={INPUT_CLS}
        />
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-5">
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={`Nombre ${vocabulary.partySingular.toLowerCase()}`}
          className={`${INPUT_CLS} md:col-span-2`}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as PartyRoleOption)}
          className={INPUT_CLS}
        >
          {PARTY_ROLE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        <input
          type="text"
          value={taxIdNumber}
          onChange={(e) => setTaxIdNumber(e.target.value)}
          placeholder="RIF / ID fiscal"
          className={INPUT_CLS}
        />
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            step={1}
            value={creditLimitMinor}
            onChange={(e) => setCreditLimitMinor(e.target.value)}
            placeholder="Crédito (minor)"
            className={`${INPUT_CLS} w-full font-mono tabular-nums`}
          />
          <button
            type="submit"
            disabled={upsertMutation.isPending || !displayName.trim()}
            className="h-9 shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </form>

      {listQuery.isError ? (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          Inicia sesión en {vocabulary.branchSingular} para sincronizar {vocabulary.partyPlural.toLowerCase()}.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{vocabulary.partySingular}</th>
              <th className="px-3 py-2">Roles</th>
              <th className="px-3 py-2">ID Fiscal</th>
              <th className="px-3 py-2">Límite Crédito</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Sin registros visibles.
                </td>
              </tr>
            ) : (
              items.map((party) => (
                <tr key={party.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{party.displayName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{party.rolesMask.join(', ')}</td>
                  <td className="px-3 py-2 font-mono text-xs">{party.taxIdNumber ?? '—'}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {formatMinorUnits(party.creditLimitMinor, party.preferredCurrency)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
