import '@shac/ui/globals.css';

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  Outlet, RouterProvider, createRootRoute, createRoute, createRouter,
  useNavigate, useParams, useRouterState,
} from '@tanstack/react-router';
import { Bot, LogOut, UserRound } from 'lucide-react';
import { ShacAppShell } from '@shac/ui';
import { clearAuthSession, useAuthSession } from './lib/authSession';
import { listOfflineQueue } from './lib/offlineQueue';
import { createShacQueryClient } from './lib/queryClient';
import { createRpcClient } from './lib/rpc';
import { useBranchRealtimeSync } from './lib/useBranchRealtimeSync';
import { DEFAULT_BRANCHES, DEFAULT_PROFILE, NAV_ITEMS } from './nav';
import { AiAssistantDrawer } from './views/AiAssistantDrawer';
import { AppStoreView } from './views/AppStoreView';
import { AuditLogsView } from './views/AuditLogsView';
import { AuthPage } from './views/AuthPage';
import { AutomationView } from './views/AutomationView';
import { CasesView } from './views/CasesView';
import { CatalogStructureView } from './views/CatalogStructureView';
import { ClaimsAndServicesView } from './views/ClaimsAndServicesView';
import { CustomerTasksView } from './views/CustomerTasksView';
import { CustomFieldsView } from './views/CustomFieldsView';
import { DashboardView } from './views/DashboardView';
import { DealsKanbanView } from './views/DealsKanbanView';
import { EudrComplianceView } from './views/EudrComplianceView';
import { FinanceView } from './views/FinanceView';
import { FormsBuilderView } from './views/FormsBuilderView';
import { IamAdminView } from './views/IamAdminView';
import { IntegrationsHubView } from './views/IntegrationsHubView';
import { CatalogView, PartiesView } from './views/Phase2Views';
import { PhysicalView } from './views/PhysicalView';
import { PortalView } from './views/PortalView';
import { PosView, SmartCheckKioskView, WmsView } from './views/PosWmsViews';
import { ProjectsBoardView } from './views/ProjectsBoardView';
import { PromotionsView } from './views/PromotionsView';
import { PublicFormView, PublicQuoteView } from './views/PublicFormAndQuoteView';
import { QuotesView } from './views/QuotesView';
import { SalesOrdersView } from './views/SalesOrdersView';
import { LeasesView, SpacesView } from './views/SpacesLeasesViews';
import { StaffHubView } from './views/StaffHubView';
import { WmsLocationsView } from './views/WmsLocationsView';
import { WorkflowsVisualView } from './views/WorkflowsVisualView';

const queryClient = createShacQueryClient();
export const rpcClient = createRpcClient(
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8787',
);

function RootLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [aiOpen, setAiOpen] = useState(false);
  const session = useAuthSession();
  const bootstrapQuery = useQuery({
    queryKey: ['auth', 'bootstrap'],
    queryFn: async () => {
      const res = await rpcClient.api.auth.bootstrap.$get();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  useBranchRealtimeSync(bootstrapQuery.data?.branches[0]?.id, session?.actor.tenantId);
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
    session?.actor.branchName ?? bootstrapQuery.data?.branches[0]?.name ?? DEFAULT_BRANCHES[0]?.name ?? 'Casa Matriz';

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
      syncState={{ status: pendingMutations > 0 ? 'offline' : 'online', pendingMutations }}
      theme={theme}
      onToggleTheme={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
      headerActions={
        session ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Abrir AI Chat"
              onClick={() => setAiOpen((prev) => !prev)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground"
            >
              <Bot className="size-3.5" />
              <span className="hidden lg:inline">Chat IA</span>
            </button>
            <span className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground sm:inline-flex">
              <UserRound className="size-3.5" />
              <span className="max-w-28 truncate">{session.actor.fullName}</span>
            </span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-3.5" />
              <span>Salir</span>
            </button>
          </div>
        ) : null
      }
    >
      {session || pathname === '/auth' || pathname.startsWith('/f/') || pathname.startsWith('/quote/') ? (
        <Outlet />
      ) : (
        <AuthPage rpc={rpcClient} onAuthenticated={() => void navigate({ to: '/' })} />
      )}
      {session ? <AiAssistantDrawer open={aiOpen} onClose={() => setAiOpen(false)} rpc={rpcClient} /> : null}
    </ShacAppShell>
  );
}

const voc = DEFAULT_PROFILE.vocabulary;

function HomePage() {
  const navigate = useNavigate();
  return <DashboardView vocabulary={voc} rpc={rpcClient} onNavigate={(href) => void navigate({ to: href })} />;
}

function OrdersPage() {
  const navigate = useNavigate();
  return <SalesOrdersView vocabulary={voc} rpc={rpcClient} onNavigate={(href) => void navigate({ to: href })} />;
}

function LoginPage() {
  const navigate = useNavigate();
  return <AuthPage rpc={rpcClient} onAuthenticated={() => void navigate({ to: '/' })} />;
}

const rootRoute = createRootRoute({ component: RootLayout });
const routeSpecs: Array<[string, () => ReturnType<typeof HomePage>]> = [
  ['/', HomePage],
  ['/auth', LoginPage],
  ['/tasks', () => <CustomerTasksView vocabulary={voc} rpc={rpcClient} />],
  ['/parties', () => <PartiesView vocabulary={voc} rpc={rpcClient} />],
  ['/deals', () => <DealsKanbanView vocabulary={voc} rpc={rpcClient} />],
  ['/catalog', () => <CatalogView vocabulary={voc} rpc={rpcClient} />],
  ['/categories', () => <CatalogStructureView vocabulary={voc} rpc={rpcClient} />],
  ['/promotions', () => <PromotionsView vocabulary={voc} rpc={rpcClient} />],
  ['/pos', () => <PosView vocabulary={voc} rpc={rpcClient} />],
  ['/orders', OrdersPage],
  ['/quotes', () => <QuotesView vocabulary={voc} rpc={rpcClient} />],
  ['/kiosk/price-check', () => <SmartCheckKioskView vocabulary={voc} rpc={rpcClient} />],
  ['/wms', () => <WmsView vocabulary={voc} rpc={rpcClient} />],
  ['/wms-locations', () => <WmsLocationsView vocabulary={voc} rpc={rpcClient} />],
  ['/eudr', () => <EudrComplianceView vocabulary={voc} rpc={rpcClient} />],
  ['/claims', () => <ClaimsAndServicesView vocabulary={voc} rpc={rpcClient} />],
  ['/spaces', () => <SpacesView vocabulary={voc} rpc={rpcClient} />],
  ['/leases', () => <LeasesView vocabulary={voc} rpc={rpcClient} />],
  ['/cases', () => <CasesView vocabulary={voc} rpc={rpcClient} />],
  ['/staff', () => <StaffHubView vocabulary={voc} rpc={rpcClient} />],
  ['/projects', () => <ProjectsBoardView vocabulary={voc} rpc={rpcClient} />],
  ['/finance', () => <FinanceView vocabulary={voc} rpc={rpcClient} />],
  ['/portal', () => <PortalView vocabulary={voc} rpc={rpcClient} />],
  ['/forms', () => <FormsBuilderView vocabulary={voc} rpc={rpcClient} />],
  ['/iam-admin', () => <IamAdminView vocabulary={voc} rpc={rpcClient} />],
  ['/audit-logs', () => <AuditLogsView vocabulary={voc} rpc={rpcClient} />],
  ['/custom-fields', () => <CustomFieldsView vocabulary={voc} rpc={rpcClient} />],
  ['/workflows', () => <WorkflowsVisualView vocabulary={voc} rpc={rpcClient} />],
  ['/automation', () => <AutomationView vocabulary={voc} rpc={rpcClient} />],
  ['/integrations', () => <IntegrationsHubView vocabulary={voc} rpc={rpcClient} />],
  ['/physical', () => <PhysicalView vocabulary={voc} rpc={rpcClient} />],
  ['/app-store', () => <AppStoreView fallbackProfile={DEFAULT_PROFILE} rpc={rpcClient} />],
  ['/f/$slug', () => <PublicFormRoutePage />],
  ['/quote/$orderNumber', () => <PublicQuoteRoutePage />],
];

function PublicFormRoutePage() {
  const { slug = '' } = useParams({ strict: false }) as { slug?: string };
  return <PublicFormView slug={slug} />;
}

function PublicQuoteRoutePage() {
  const { orderNumber = '' } = useParams({ strict: false }) as { orderNumber?: string };
  return <PublicQuoteView orderNumber={orderNumber} />;
}

const routeTree = rootRoute.addChildren(
  routeSpecs.map(([path, component]) => createRoute({ getParentRoute: () => rootRoute, path, component })),
);
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
