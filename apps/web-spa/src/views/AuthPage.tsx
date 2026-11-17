import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthBranchGate } from '@shac/ui';
import { setAuthSession, type AuthSession } from '../lib/authSession';
import type { createRpcClient } from '../lib/rpc';
import { DEFAULT_BRANCHES, DEFAULT_PROFILE } from '../nav';
import { SetupOnboardingCard } from './SetupOnboardingCard';

interface AuthPageProps {
  rpc: ReturnType<typeof createRpcClient>;
  onAuthenticated: () => void;
}

/** Branch authentication gate page wired to /api/auth/{bootstrap,login,pin}. */
export function AuthPage({ rpc, onAuthenticated }: AuthPageProps) {
  const queryClient = useQueryClient();
  const bootstrapQuery = useQuery({
    queryKey: ['auth', 'bootstrap'],
    queryFn: async () => {
      const res = await rpc.api.auth.bootstrap.$get();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  const branches = bootstrapQuery.data?.branches ?? DEFAULT_BRANCHES;
  const vocabulary = bootstrapQuery.data?.vocabulary ?? DEFAULT_PROFILE.vocabulary;
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effectiveBranchId = selectedBranchId || branches[0]?.id || '';

  async function handleCredentialsSubmit(credentials: {
    email: string;
    password: string;
    branchId: string;
  }) {
    setLoading(true);
    setError(null);
    try {
      const res = await rpc.api.auth.login.$post({ json: credentials });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const session = (await res.json()) as AuthSession;
      setAuthSession(session);
      void queryClient.invalidateQueries();
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  async function handlePinSubmit(payload: {
    pin: string;
    branchId: string;
    mode: 'cashier' | 'delegation';
  }) {
    setLoading(true);
    setError(null);
    try {
      const res = await rpc.api.auth.pin.$post({ json: payload });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const session = (await res.json()) as AuthSession;
      setAuthSession(session);
      void queryClient.invalidateQueries();
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN inválido');
    } finally {
      setLoading(false);
    }
  }

  if (bootstrapQuery.data && 'needsSetup' in bootstrapQuery.data && bootstrapQuery.data.needsSetup) {
    return (
      <div className="py-2">
        <SetupOnboardingCard
          rpc={rpc}
          hasProvisionedProfile={Boolean(bootstrapQuery.data.hasProvisionedProfile)}
          initialPreset={bootstrapQuery.data.editionPreset}
          onInitialized={() => {
            void queryClient.invalidateQueries();
            onAuthenticated();
          }}
        />
      </div>
    );
  }

  return (
    <div className="py-2">
      <AuthBranchGate
        vocabulary={vocabulary}
        branches={branches}
        selectedBranchId={effectiveBranchId}
        onSelectBranch={setSelectedBranchId}
        onCredentialsSubmit={(creds) => void handleCredentialsSubmit(creds)}
        onPinSubmit={(payload) => void handlePinSubmit(payload)}
        loading={loading}
        error={error}
      />
    </div>
  );
}
