import '@shac/ui/globals.css';

import { StrictMode, Suspense, useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Outlet, RouterProvider, createRootRoute, createRoute, createRouter,
  useNavigate, useParams, useRouterState,
} from '@tanstack/react-router';
import { Bot, LogOut, UserRound } from 'lucide-react';
import { ExternalPortalShell, ShacAppShell, ViewErrorBoundary } from '@shac/ui';
import { clearAuthSession, setAuthSession, useAuthSession, type AuthSession } from './lib/authSession';
import {
  MarketProfileProvider, resolveRouteDensity, useMarketVocabulary,
  useNetworkOnline, usePersistedTheme,
} from './lib/marketProfile';
import { listOfflineQueue } from './lib/offlineQueue';
import { createShacQueryClient } from './lib/queryClient';
import { createRpcClient } from './lib/rpc';
import { useBranchRealtimeSync } from './lib/useBranchRealtimeSync';
import { buildNavItems, DEFAULT_BRANCHES, DEFAULT_PROFILE, getDefaultCollapsedGroups } from './nav';
import { AiAssistantDrawer } from './views/AiAssistantDrawer';
import { AuthPage } from './views/AuthPage';
import { PublicFormView } from './views/PublicFormAndQuoteView';
import { PublicQuoteView } from './views/PublicQuoteView';
import type { Phase2ViewProps } from './views/phase2-format';
import {
  AppStoreView, AuditLogsView, AutomationView, CatalogStructureView, CatalogView,
  ClaimsAndServicesView, ClinicalEhrView, CondoResidentHubView, CustomFieldsView,
  CustomerTasksView, DashboardView, DealsKanbanView, DemoAndSopCenterView,
  EudrComplianceView, FinanceView, FormsBuilderView, HeliosSecurityView,
  HospitalityPmsView, IamAdminView, IntegrationsHubView, LabelsAndFleetView,
  LegalPracticeView, PartiesView, PortalView, PosView, ProjectsBoardView,
  PromotionsView, QuotesView, SalesOrdersView, SmartCheckKioskView, StaffHubView,
  WmsLocationsView, WmsView, WorkflowsVisualView,
} from './lazyViews';

const queryClient = createShacQueryClient();
export const rpcClient = createRpcClient(
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8787',
);

const ROUTE_FALLBACK = <div className="p-6 text-xs text-muted-foreground">Cargando módulo...</div>;

function RootLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [theme, toggleTheme] = usePersistedTheme(pathname);
  const [aiOpen, setAiOpen] = useState(false);
  const isOnline = useNetworkOnline();
  const session = useAuthSession();

  const isPublicPortalRoute = pathname.startsWith('/f/') || pathname.startsWith('/quote/');
  const isExternalShell = isPublicPortalRoute || pathname === '/kiosk/price-check' || !session;

  const bootstrapQuery = useQuery({
    queryKey: ['auth', 'bootstrap'],
    enabled: !isPublicPortalRoute,
    queryFn: async () => {
      const res = await rpcClient.api.auth.bootstrap.$get();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const activeBranchId = session?.actor.orgId ?? bootstrapQuery.data?.branches[0]?.id;
  useBranchRealtimeSync(session && !isPublicPortalRoute ? activeBranchId : undefined, session?.actor.tenantId);

  const queueQuery = useQuery({
    queryKey: ['pos', 'offlineQueue'],
    enabled: Boolean(session),
    queryFn: () => listOfflineQueue(),
  });

  const activeProfile = bootstrapQuery.data
    ? {
        tenantId: bootstrapQuery.data.tenantId,
        editionPreset: bootstrapQuery.data.editionPreset,
        activeModules: bootstrapQuery.data.activeModules,
        vocabulary: bootstrapQuery.data.vocabulary,
      }
    : DEFAULT_PROFILE;

  useEffect(() => {
    if (!session) return undefined;
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || pathname === '/pos') return;
      if (e.key === 'F2' && activeProfile.activeModules.includes('pos')) {
        e.preventDefault();
        void navigate({ to: '/pos' });
      } else if (e.key === 'F4' && activeProfile.activeModules.includes('pos')) {
        e.preventDefault();
        void navigate({ to: '/kiosk/price-check' });
      } else if (e.key === 'F6' && activeProfile.activeModules.includes('wms')) {
        e.preventDefault();
        void navigate({ to: '/wms' });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, pathname, activeProfile.activeModules, navigate]);

  const pendingMutations = queueQuery.data?.length ?? 0;
  const syncStatus = !isOnline || pendingMutations > 0 ? 'offline' : 'online';
  const branches = bootstrapQuery.data?.branches ?? DEFAULT_BRANCHES;
  const activeBranchName = session?.actor.branchName ?? branches[0]?.name ?? 'Casa Matriz';
  const density = resolveRouteDensity(pathname);

  async function handleSwitchBranch(branchId: string) {
    const res = await rpcClient.api.auth['switch-branch'].$post({ json: { branchId } });
    if (!res.ok) return;
    const nextSession = (await res.json()) as AuthSession;
    setAuthSession(nextSession);
    void qc.invalidateQueries();
  }

  async function handleLogout() {
    await rpcClient.api.auth.logout.$post().catch(() => undefined);
    clearAuthSession();
    void navigate({ to: '/auth' });
  }

  const content = (
    <MarketProfileProvider profile={activeProfile}>
      <Suspense fallback={ROUTE_FALLBACK}>
        {session || pathname === '/auth' || isPublicPortalRoute ? (
          <Outlet />
        ) : (
          <AuthPage rpc={rpcClient} onAuthenticated={() => void navigate({ to: '/' })} />
        )}
      </Suspense>
    </MarketProfileProvider>
  );

  if (isExternalShell) {
    return (
      <ExternalPortalShell
        title={isPublicPortalRoute ? 'Portal de Atención' : 'SuperHyperArchi'}
        subtitle={activeBranchName}
        theme={theme}
        onToggleTheme={toggleTheme}
        density={density}
      >
        {content}
      </ExternalPortalShell>
    );
  }

  return (
    <ShacAppShell
      profile={activeProfile}
      branchName={activeBranchName}
      activeBranchId={activeBranchId}
      branches={branches}
      onSwitchBranch={(id) => void handleSwitchBranch(id)}
      navItems={buildNavItems(activeProfile)}
      defaultCollapsedGroups={getDefaultCollapsedGroups(activeProfile.editionPreset)}
      activeHref={pathname}
      onNavigate={(href) => void navigate({ to: href })}
      syncState={{ status: syncStatus, pendingMutations }}
      density={density}
      theme={theme}
      onToggleTheme={toggleTheme}
      headerActions={
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
          <span className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground xl:inline-flex">
            <UserRound className="size-3.5" />
            <span className="max-w-28 truncate">{session.actor.fullName}</span>
          </span>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      }
    >
      <ViewErrorBoundary viewId={pathname} key={pathname}>
        {content}
      </ViewErrorBoundary>
      <AiAssistantDrawer open={aiOpen} onClose={() => setAiOpen(false)} rpc={rpcClient} />
    </ShacAppShell>
  );
}

function ViewWrap({ Component }: { Component: ComponentType<Phase2ViewProps> }) {
  const voc = useMarketVocabulary();
  return <Component vocabulary={voc} rpc={rpcClient} />;
}

function HomePage() {
  const navigate = useNavigate();
  const voc = useMarketVocabulary();
  return <DashboardView vocabulary={voc} rpc={rpcClient} onNavigate={(href) => void navigate({ to: href })} />;
}

function OrdersPage() {
  const navigate = useNavigate();
  const voc = useMarketVocabulary();
  return <SalesOrdersView vocabulary={voc} rpc={rpcClient} onNavigate={(href) => void navigate({ to: href })} />;
}

function DemoSopPage() {
  const navigate = useNavigate();
  const voc = useMarketVocabulary();
  return <DemoAndSopCenterView vocabulary={voc} rpc={rpcClient} onNavigate={(href) => void navigate({ to: href })} />;
}

function CasesRedirectPage() {
  const navigate = useNavigate();
  const voc = useMarketVocabulary();
  return <ClinicalEhrView vocabulary={voc} rpc={rpcClient} />;
  void navigate;
}

const rootRoute = createRootRoute({ component: RootLayout });
const routeSpecs: Array<[string, () => ReturnType<typeof HomePage>]> = [
  ['/', HomePage],
  ['/auth', () => <AuthPage rpc={rpcClient} onAuthenticated={() => void router.navigate({ to: '/' })} />],
  ['/demo-sop', DemoSopPage],
  ['/tasks', () => <ViewWrap Component={CustomerTasksView} />],
  ['/parties', () => <ViewWrap Component={PartiesView} />],
  ['/deals', () => <ViewWrap Component={DealsKanbanView} />],
  ['/catalog', () => <ViewWrap Component={CatalogView} />],
  ['/categories', () => <ViewWrap Component={CatalogStructureView} />],
  ['/promotions', () => <ViewWrap Component={PromotionsView} />],
  ['/pos', () => <ViewWrap Component={PosView} />],
  ['/orders', OrdersPage],
  ['/quotes', () => <ViewWrap Component={QuotesView} />],
  ['/kiosk/price-check', () => <ViewWrap Component={SmartCheckKioskView} />],
  ['/wms', () => <ViewWrap Component={WmsView} />],
  ['/wms-locations', () => <ViewWrap Component={WmsLocationsView} />],
  ['/labels-fleet', () => <ViewWrap Component={LabelsAndFleetView} />],
  ['/eudr', () => <ViewWrap Component={EudrComplianceView} />],
  ['/claims', () => <ViewWrap Component={ClaimsAndServicesView} />],
  ['/spaces', () => <ViewWrap Component={HospitalityPmsView} />],
  ['/leases', () => <ViewWrap Component={CondoResidentHubView} />],
  ['/clinical-ehr', () => <ViewWrap Component={ClinicalEhrView} />],
  ['/legal-hub', () => <ViewWrap Component={LegalPracticeView} />],
  ['/cases', CasesRedirectPage],
  ['/staff', () => <ViewWrap Component={StaffHubView} />],
  ['/projects', () => <ViewWrap Component={ProjectsBoardView} />],
  ['/finance', () => <ViewWrap Component={FinanceView} />],
  ['/portal', () => <ViewWrap Component={PortalView} />],
  ['/forms', () => <ViewWrap Component={FormsBuilderView} />],
  ['/iam-admin', () => <ViewWrap Component={IamAdminView} />],
  ['/audit-logs', () => <ViewWrap Component={AuditLogsView} />],
  ['/custom-fields', () => <ViewWrap Component={CustomFieldsView} />],
  ['/workflows', () => <ViewWrap Component={WorkflowsVisualView} />],
  ['/automation', () => <ViewWrap Component={AutomationView} />],
  ['/integrations', () => <ViewWrap Component={IntegrationsHubView} />],
  ['/physical', () => <ViewWrap Component={HeliosSecurityView} />],
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
