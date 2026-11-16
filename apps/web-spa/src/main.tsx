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
import type { TenantMarketProfile } from '@shac/kernel';
import { AuthBranchGate, ShacAppShell, type BranchOption, type ShacNavItem } from '@shac/ui';
import { listOfflineQueue } from './lib/offlineQueue';
import { createShacQueryClient } from './lib/queryClient';
import { createRpcClient } from './lib/rpc';
import { CatalogView, PartiesView } from './views/Phase2Views';
import { PosView, SmartCheckKioskView, WmsView } from './views/PosWmsViews';

const DEFAULT_PROFILE: Pick<
  TenantMarketProfile,
  'tenantId' | 'editionPreset' | 'activeModules' | 'vocabulary'
> = {
  tenantId: 'tenant-demo',
  editionPreset: 'omni-enterprise',
  activeModules: ['core', 'iam', 'customers', 'catalog', 'pos', 'wms', 'crm'],
  vocabulary: {
    partySingular: 'Cliente',
    partyPlural: 'Clientes',
    orderSingular: 'Pedido',
    branchSingular: 'Sucursal',
    spaceSingular: 'Espacio',
    caseSingular: 'Expediente',
  },
};

const DEFAULT_BRANCHES: BranchOption[] = [
  { id: 'branch-hq', name: 'Casa Matriz', orgPath: '/hq' },
];

const NAV_ITEMS: ShacNavItem[] = [
  { id: 'home', label: 'Inicio', href: '/' },
  { id: 'auth', label: 'Acceso Sucursal', href: '/auth' },
  {
    id: 'parties',
    label: DEFAULT_PROFILE.vocabulary.partyPlural,
    href: '/parties',
    moduleId: 'customers',
  },
  {
    id: 'catalog',
    label: 'Catálogo',
    href: '/catalog',
    moduleId: 'catalog',
  },
  {
    id: 'pos',
    label: `POS · ${DEFAULT_PROFILE.vocabulary.orderSingular}`,
    href: '/pos',
    moduleId: 'pos',
    shortcut: 'F2',
  },
  {
    id: 'kiosk',
    label: 'SmartCheck 10s',
    href: '/kiosk/price-check',
    moduleId: 'pos',
    shortcut: 'F4',
  },
  {
    id: 'wms',
    label: `WMS · ${DEFAULT_PROFILE.vocabulary.branchSingular}`,
    href: '/wms',
    moduleId: 'wms',
    shortcut: 'F6',
  },
];

const queryClient = createShacQueryClient();
export const rpcClient = createRpcClient(
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8787',
);

function RootLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const queueQuery = useQuery({
    queryKey: ['pos', 'offlineQueue'],
    queryFn: () => listOfflineQueue(),
  });
  const pendingMutations = queueQuery.data?.length ?? 0;

  return (
    <ShacAppShell
      profile={DEFAULT_PROFILE}
      branchName={DEFAULT_BRANCHES[0]?.name ?? 'Casa Matriz'}
      navItems={NAV_ITEMS}
      activeHref={pathname}
      onNavigate={(href) => void navigate({ to: href })}
      syncState={{
        status: pendingMutations > 0 ? 'offline' : 'online',
        pendingMutations,
      }}
      theme={theme}
      onToggleTheme={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
    >
      <Outlet />
    </ShacAppShell>
  );
}

function HomePage() {
  return (
    <section className="space-y-2 p-6">
      <h1 className="text-xl font-semibold tracking-tight">SuperHyperArchiCRM</h1>
      <p className="text-sm text-muted-foreground">
        Motor Único All-in-One listo para operar en modo offline-first.
      </p>
    </section>
  );
}

function AuthPage() {
  const [selectedBranchId, setSelectedBranchId] = useState(DEFAULT_BRANCHES[0]?.id ?? '');

  return (
    <div className="p-6">
      <AuthBranchGate
        vocabulary={DEFAULT_PROFILE.vocabulary}
        branches={DEFAULT_BRANCHES}
        selectedBranchId={selectedBranchId}
        onSelectBranch={setSelectedBranchId}
        onPinSubmit={() => undefined}
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

const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth',
  component: AuthPage,
});
const partiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/parties',
  component: PartiesPage,
});
const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog',
  component: CatalogPage,
});
const posRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pos',
  component: PosPage,
});
const kioskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/kiosk/price-check',
  component: KioskPriceCheckPage,
});
const wmsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wms',
  component: WmsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute,
  partiesRoute,
  catalogRoute,
  posRoute,
  kioskRoute,
  wmsRoute,
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
