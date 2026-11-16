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
import { LogOut, UserRound } from 'lucide-react';
import { ShacAppShell } from '@shac/ui';
import { clearAuthSession, useAuthSession } from './lib/authSession';
import { listOfflineQueue } from './lib/offlineQueue';
import { createShacQueryClient } from './lib/queryClient';
import { createRpcClient } from './lib/rpc';
import { DEFAULT_BRANCHES, DEFAULT_PROFILE, NAV_ITEMS } from './nav';
import { AppStoreView } from './views/AppStoreView';
import { AuthPage } from './views/AuthPage';
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
          <div className="flex items-center gap-1.5">
            <span className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground sm:inline-flex">
              <UserRound className="size-3.5" />
              <span className="max-w-28 truncate">{session.actor.fullName}</span>
            </span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-3.5" />
              <span>Salir</span>
            </button>
          </div>
        ) : null
      }
    >
      {session || pathname === '/auth' ? (
        <Outlet />
      ) : (
        <AuthPage rpc={rpcClient} onAuthenticated={() => void navigate({ to: '/' })} />
      )}
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

function LoginPage() {
  const navigate = useNavigate();
  return <AuthPage rpc={rpcClient} onAuthenticated={() => void navigate({ to: '/' })} />;
}

const voc = DEFAULT_PROFILE.vocabulary;
const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });
const authRoute = createRoute({ getParentRoute: () => rootRoute, path: '/auth', component: LoginPage });
const partiesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/parties', component: () => <PartiesView vocabulary={voc} rpc={rpcClient} /> });
const catalogRoute = createRoute({ getParentRoute: () => rootRoute, path: '/catalog', component: () => <CatalogView vocabulary={voc} rpc={rpcClient} /> });
const posRoute = createRoute({ getParentRoute: () => rootRoute, path: '/pos', component: () => <PosView vocabulary={voc} rpc={rpcClient} /> });
const kioskRoute = createRoute({ getParentRoute: () => rootRoute, path: '/kiosk/price-check', component: () => <SmartCheckKioskView vocabulary={voc} rpc={rpcClient} /> });
const wmsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/wms', component: () => <WmsView vocabulary={voc} rpc={rpcClient} /> });
const spacesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/spaces', component: () => <SpacesView vocabulary={voc} rpc={rpcClient} /> });
const leasesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/leases', component: () => <LeasesView vocabulary={voc} rpc={rpcClient} /> });
const casesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/cases', component: () => <CasesView vocabulary={voc} rpc={rpcClient} /> });
const financeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/finance', component: () => <FinanceView vocabulary={voc} rpc={rpcClient} /> });
const portalRoute = createRoute({ getParentRoute: () => rootRoute, path: '/portal', component: () => <PortalView vocabulary={voc} rpc={rpcClient} /> });
const automationRoute = createRoute({ getParentRoute: () => rootRoute, path: '/automation', component: () => <AutomationView vocabulary={voc} rpc={rpcClient} /> });
const physicalRoute = createRoute({ getParentRoute: () => rootRoute, path: '/physical', component: () => <PhysicalView vocabulary={voc} rpc={rpcClient} /> });
const appStoreRoute = createRoute({ getParentRoute: () => rootRoute, path: '/app-store', component: () => <AppStoreView fallbackProfile={DEFAULT_PROFILE} rpc={rpcClient} /> });

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
