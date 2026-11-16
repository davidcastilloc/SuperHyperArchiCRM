import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TenantMarketProfile } from '@shac/kernel';
import type { createRpcClient } from '../lib/rpc';
import { INPUT_CLS, readApiError } from './phase2-format';

interface AppStoreViewProps {
  fallbackProfile: Pick<
    TenantMarketProfile,
    'tenantId' | 'editionPreset' | 'activeModules' | 'vocabulary'
  >;
  rpc: ReturnType<typeof createRpcClient>;
}

/** App Store live market preset switcher & 0 ms KV module toggle view. */
export function AppStoreView({ fallbackProfile, rpc }: AppStoreViewProps) {
  const queryClient = useQueryClient();
  const [partyPlural, setPartyPlural] = useState(fallbackProfile.vocabulary.partyPlural);
  const [orderSingular, setOrderSingular] = useState(fallbackProfile.vocabulary.orderSingular);
  const [feedback, setFeedback] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ['system', 'profile'],
    queryFn: async () => {
      const res = await rpc.api.system.profile.$get({ query: {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (payload: {
      enableModules?: string[];
      disableModules?: string[];
      switchPreset?: string;
      vocabularyOverride?: { partyPlural?: string; orderSingular?: string };
    }) => {
      const res = await rpc.api.system['app-store'].toggle.$post({
        json: payload as Parameters<typeof rpc.api.system['app-store']['toggle']['$post']>[0]['json'],
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setFeedback(
        `App Store KV 0 ms actualizado · preset=${data.profile.editionPreset} (${data.profile.activeModules.length} módulos)`,
      );
      void queryClient.invalidateQueries({ queryKey: ['system', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['auth', 'bootstrap'] });
    },
    onError: (err) => {
      setFeedback(`Error al actualizar App Store: ${err instanceof Error ? err.message : 'unknown'}`);
    },
  });

  const activeProfile = profileQuery.data?.profile ?? fallbackProfile;
  const presets = profileQuery.data?.catalog.presets ?? [];
  const protectedSet = new Set(profileQuery.data?.catalog.protectedModules ?? ['core', 'iam']);
  const allModuleIds = Array.from(
    new Set([
      ...activeProfile.activeModules,
      ...presets.flatMap((p) => p.activeModules),
      'spaces',
      'cases',
      'finance',
      'portal',
      'automation',
    ]),
  );

  function handleVocabularySubmit(e: FormEvent) {
    e.preventDefault();
    toggleMutation.mutate({
      vocabularyOverride: {
        partyPlural: partyPlural.trim() || activeProfile.vocabulary.partyPlural,
        orderSingular: orderSingular.trim() || activeProfile.vocabulary.orderSingular,
      },
    });
  }

  return (
    <section className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">SHAC App Store · KV 0 ms</h1>
          <p className="text-sm text-muted-foreground">
            Preset activo: <strong>{activeProfile.editionPreset}</strong> ·{' '}
            {activeProfile.activeModules.length} módulos activos
          </p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs font-medium">
          Hot-Switch · Sin Reinicio
        </span>
      </header>

      {feedback && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">{feedback}</div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">9 Presets de Industria</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((preset) => {
            const isCurrent = preset.id === activeProfile.editionPreset;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={toggleMutation.isPending}
                onClick={() => toggleMutation.mutate({ switchPreset: preset.id })}
                className={`rounded-lg border p-3 text-left transition ${
                  isCurrent ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{preset.label}</span>
                  {isCurrent && <span className="text-xs font-semibold">Activo</span>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{preset.targetMarket}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {preset.activeModules.length} módulos
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Módulos en Vivo (CONFIG_KV)</h2>
        <div className="flex flex-wrap gap-2">
          {allModuleIds.map((modId) => {
            const enabled = activeProfile.activeModules.includes(modId);
            const isProtected = protectedSet.has(modId);
            return (
              <button
                key={modId}
                type="button"
                disabled={isProtected || toggleMutation.isPending}
                onClick={() =>
                  toggleMutation.mutate(
                    enabled ? { disableModules: [modId] } : { enableModules: [modId] },
                  )
                }
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  enabled ? 'border-primary bg-primary/10' : 'opacity-60'
                }`}
              >
                {modId} {isProtected ? '· fijo' : enabled ? '· ON' : '· OFF'}
              </button>
            );
          })}
        </div>
      </div>

      <form onSubmit={handleVocabularySubmit} className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs">
          <span>Vocabulario Clientes (plural)</span>
          <input
            className={INPUT_CLS}
            value={partyPlural}
            onChange={(e) => setPartyPlural(e.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span>Vocabulario Pedido (singular)</span>
          <input
            className={INPUT_CLS}
            value={orderSingular}
            onChange={(e) => setOrderSingular(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={toggleMutation.isPending}
          className="rounded-md border px-3 py-2 text-xs font-medium"
        >
          Aplicar Vocabulario
        </button>
      </form>
    </section>
  );
}
