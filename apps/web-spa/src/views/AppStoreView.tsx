import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TenantMarketProfile } from '@shac/kernel';
import { Blocks, Check, Languages, Zap } from 'lucide-react';
import { PageHeader, StatusBadge } from '@shac/ui';
import type { createRpcClient } from '../lib/rpc';
import { INPUT_CLS, readApiError } from './phase2-format';

interface AppStoreViewProps {
  fallbackProfile: Pick<
    TenantMarketProfile,
    'tenantId' | 'editionPreset' | 'activeModules' | 'vocabulary'
  >;
  rpc: ReturnType<typeof createRpcClient>;
}

/** Open Mercato DS v3 App Store live market preset switcher & 0 ms KV module toggle view. */
export function AppStoreView({ fallbackProfile, rpc }: AppStoreViewProps) {
  const queryClient = useQueryClient();
  const [partyPlural, setPartyPlural] = useState(fallbackProfile.vocabulary.partyPlural);
  const [orderSingular, setOrderSingular] = useState(fallbackProfile.vocabulary.orderSingular);
  const [isolatePreset, setIsolatePreset] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ['system', 'profile'],
    queryFn: async () => {
      const res = await rpc.api.system.profile.$get({ query: {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  useEffect(() => {
    const v = profileQuery.data?.profile.vocabulary;
    if (v) {
      setPartyPlural(v.partyPlural);
      setOrderSingular(v.orderSingular);
    }
  }, [profileQuery.data?.profile.vocabulary]);

  const toggleMutation = useMutation({
    mutationFn: async (payload: {
      enableModules?: string[];
      disableModules?: string[];
      switchPreset?: string;
      presetMode?: 'merge' | 'replace';
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
        `Perfil actualizado en CONFIG_KV (0 ms) · preset=${data.profile.editionPreset} (${data.profile.activeModules.length} módulos)`,
      );
      void queryClient.invalidateQueries({ queryKey: ['system', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['auth', 'bootstrap'] });
    },
    onError: (err) => setFeedback(err instanceof Error ? err.message : 'Error al actualizar App Store'),
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
      'services',
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
    <section className="space-y-6" data-slot="app-store-view">
      <PageHeader
        title="App Store & Perspectivas de Industria"
        description={`Preset activo: ${activeProfile.editionPreset} · ${activeProfile.activeModules.length} dominios encendidos en CONFIG_KV sin recompilación.`}
        onRefresh={() => void profileQuery.refetch()}
        refreshing={profileQuery.isFetching}
        actions={<StatusBadge label="Hot-Switch 0 ms" tone="success" icon={<Zap className="size-3" />} />}
      />

      {feedback ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p> : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <Blocks className="size-4 text-muted-foreground" />
            <span>9 Presets Verticales Canónicos</span>
          </h2>
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isolatePreset}
              onChange={(e) => setIsolatePreset(e.target.checked)}
              className="size-4 rounded border-border"
            />
            <span>Aislar vertical (apagar módulos de otras industrias)</span>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((preset) => {
            const isCurrent = preset.id === activeProfile.editionPreset;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={toggleMutation.isPending}
                onClick={() =>
                  toggleMutation.mutate({
                    switchPreset: preset.id,
                    presetMode: isolatePreset ? 'replace' : 'merge',
                  })
                }
                className={`rounded-xl border p-4 text-left shadow-xs transition-colors ${
                  isCurrent ? 'border-foreground bg-muted/40' : 'border-border bg-card hover:bg-muted/35'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{preset.label}</span>
                  {isCurrent ? <StatusBadge label="Activo" tone="success" icon={<Check className="size-3" />} /> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{preset.targetMarket}</p>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">{preset.activeModules.length} módulos</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-xs divide-y divide-border">
        <div className="p-5 space-y-3">
          <h2 className="text-sm font-semibold">Interruptores de Dominio (`CONFIG_KV`)</h2>
          <div className="flex flex-wrap gap-2">
            {allModuleIds.map((modId) => {
              const enabled = activeProfile.activeModules.includes(modId);
              const isProtected = protectedSet.has(modId);
              return (
                <button
                  key={modId}
                  type="button"
                  disabled={isProtected || toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(enabled ? { disableModules: [modId] } : { enableModules: [modId] })}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${
                    enabled ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span className="font-mono">{modId}</span>
                  <span className="text-[10px] opacity-80">{isProtected ? 'fijo' : enabled ? 'ON' : 'OFF'}</span>
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={handleVocabularySubmit} className="flex flex-wrap items-end gap-3 p-5">
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Vocabulario Clientes (plural)</span>
            <input className={INPUT_CLS} value={partyPlural} onChange={(e) => setPartyPlural(e.target.value)} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Vocabulario Pedido (singular)</span>
            <input className={INPUT_CLS} value={orderSingular} onChange={(e) => setOrderSingular(e.target.value)} />
          </label>
          <button type="submit" disabled={toggleMutation.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3.5 text-xs font-medium shadow-xs hover:bg-muted">
            <Languages className="size-3.5 text-muted-foreground" />
            <span>Aplicar Vocabulario</span>
          </button>
        </form>
      </div>
    </section>
  );
}
