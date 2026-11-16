import '@shac/ui/globals.css';

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { AuthBranchGate, ShacAppShell } from '@shac/ui';
import {
  clearAuthSession,
  setAuthSession,
  useAuthSession,
  type AuthSession,
} from './lib/authSession';
import { listOfflineQueue } from './lib/offlineQueue';
import { createShacQueryClient } from './lib/queryClient';
import { createRpcClient } from './lib/rpc';
import { DEFAULT_BRANCHES, DEFAULT_PROFILE, NAV_ITEMS } from './nav';
import { AppStoreView } from './views/AppStoreView';
import { AutomationView } from './views/AutomationView';
import { CasesView } from './views/CasesView';
import { DashboardView } from './views/DashboardView';
import { FinanceView } from './views/FinanceView';
import { CatalogView, PartiesView } from './views/Phase2Views';
import { PhysicalView } from './views/PhysicalView';
import { PortalView } from './views/PortalView';
import { PosView, SmartCheckKioskView, WmsView } from './views/PosWmsViews';
import { LeasesView, SpacesView } from './views/SpacesLeasesViews';

const queryClient = createShacQueryClient();
export const rpcClient = createRpcClient(
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8787',
);

function RootLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const session = useAuthSession();
  const bootstrapQuery = useQuery({
    queryKey: ['auth', 'bootstrap'],
    queryFn: async () => {
      const res = await rpcClient.api.auth.bootstrap.$get();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  const queueQuery = useQuery({
    queryKey: ['pos', 'offlineQueue'],
    queryFn: () => listOfflineQueue(),
  });
  const pendingMutations = queueQuery.data?.length ?? 0;
  const activeProfile = bootstrapQuery.data
    ? {
        tenantId: bootstrapQuery.data.tenantId,
        editionPreset: bootstrapQuery.data.editionPreset,
        activeModules: bootstrapQuery.data.activeModules,
        vocabulary: bootstrapQuery.data.vocabulary,
      }
    : DEFAULT_PROFILE;
  const activeBranchName =
    session?.actor.branchName ??
    bootstrapQuery.data?.branches[0]?.name ??
    DEFAULT_BRANCHES[0]?.name ??
    'Casa Matriz';

  async function handleLogout() {
    await rpcClient.api.auth.logout.$post().catch(() => undefined);
    clearAuthSession();
    void navigate({ to: '/auth' });
  }

  return (
    <ShacAppShell
      profile={activeProfile}
      branchName={activeBranchName}
      navItems={NAV_ITEMS}
      activeHref={pathname}
      onNavigate={(href) => void navigate({ to: href })}
      syncState={{
        status: pendingMutations > 0 ? 'offline' : 'online',
        pendingMutations,
      }}
      theme={theme}
      onToggleTheme={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
      headerActions={
        session ? (
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {session.actor.fullName}
            </span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted"
            >
              Salir
            </button>
          </div>
        ) : null
      }
    >
      {session || pathname === '/auth' ? <Outlet /> : <AuthPage />}
    </ShacAppShell>
  );
}

function HomePage() {
  const navigate = useNavigate();
  return (
    <DashboardView
      vocabulary={DEFAULT_PROFILE.vocabulary}
      rpc={rpcClient}
      onNavigate={(href) => void navigate({ to: href })}
    />
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const bootstrapQuery = useQuery({
    queryKey: ['auth', 'bootstrap'],
    queryFn: async () => {
      const res = await rpcClient.api.auth.bootstrap.$get();
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
      const res = await rpcClient.api.auth.login.$post({ json: credentials });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const session = (await res.json()) as AuthSession;
      setAuthSession(session);
      void queryClient.invalidateQueries();
      void navigate({ to: '/' });
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
      const res = await rpcClient.api.auth.pin.$post({ json: payload });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const session = (await res.json()) as AuthSession;
      setAuthSession(session);
      void queryClient.invalidateQueries();
      void navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN inválido');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
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

function PartiesPage() {
  return <PartiesView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function CatalogPage() {
  return <CatalogView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function PosPage() {
  return <PosView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function KioskPriceCheckPage() {
  return <SmartCheckKioskView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function WmsPage() {
  return <WmsView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function SpacesPage() {
  return <SpacesView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function LeasesPage() {
  return <LeasesView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function CasesPage() {
  return <CasesView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function FinancePage() {
  return <FinanceView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function PortalPage() {
  return <PortalView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function AutomationPage() {
  return <AutomationView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function PhysicalPage() {
  return <PhysicalView vocabulary={DEFAULT_PROFILE.vocabulary} rpc={rpcClient} />;
}

function AppStorePage() {
  return <AppStoreView fallbackProfile={DEFAULT_PROFILE} rpc={rpcClient} />;
}

const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });
const authRoute = createRoute({ getParentRoute: () => rootRoute, path: '/auth', component: AuthPage });
const partiesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/parties', component: PartiesPage });
const catalogRoute = createRoute({ getParentRoute: () => rootRoute, path: '/catalog', component: CatalogPage });
const posRoute = createRoute({ getParentRoute: () => rootRoute, path: '/pos', component: PosPage });
const kioskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/kiosk/price-check',
  component: KioskPriceCheckPage,
});
const wmsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/wms', component: WmsPage });
const spacesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/spaces', component: SpacesPage });
const leasesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/leases', component: LeasesPage });
const casesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/cases', component: CasesPage });
const financeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/finance', component: FinancePage });
const portalRoute = createRoute({ getParentRoute: () => rootRoute, path: '/portal', component: PortalPage });
const automationRoute = createRoute({ getParentRoute: () => rootRoute, path: '/automation', component: AutomationPage });
const physicalRoute = createRoute({ getParentRoute: () => rootRoute, path: '/physical', component: PhysicalPage });
const appStoreRoute = createRoute({ getParentRoute: () => rootRoute, path: '/app-store', component: AppStorePage });

const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute,
  partiesRoute,
  catalogRoute,
  posRoute,
  kioskRoute,
  wmsRoute,
  spacesRoute,
  leasesRoute,
  casesRoute,
  financeRoute,
  portalRoute,
  automationRoute,
  physicalRoute,
  appStoreRoute,
]);
const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = typeof document !== 'undefined' ? document.getElementById('root') : null;

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
