import { useMemo, useState, type ReactNode, type Ref } from 'react';
import type { TenantMarketProfile } from '@shac/kernel';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Home,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Sparkles,
  Sun,
} from 'lucide-react';
import { cn } from '../lib/cn.js';
import { ShacSidebar, type ShacNavItem } from './ShacSidebar.js';

export type { ShacNavItem } from './ShacSidebar.js';

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  pendingMutations?: number;
}

export interface SyncStatusPillProps {
  syncState: SyncState;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

const SYNC_STYLES: Record<SyncStatus, string> = {
  online: 'border-status-success-border bg-status-success-bg text-status-success-text',
  offline: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
  syncing: 'border-status-info-border bg-status-info-bg text-status-info-text',
  error: 'border-status-error-border bg-status-error-bg text-status-error-text',
};

const SYNC_DOT_STYLES: Record<SyncStatus, string> = {
  online: 'bg-status-success-icon',
  offline: 'bg-status-warning-icon',
  syncing: 'bg-status-info-icon animate-pulse',
  error: 'bg-status-error-icon',
};

function formatSyncLabel(syncState: SyncState): string {
  switch (syncState.status) {
    case 'online':
      return 'En línea · Tiempo real';
    case 'offline':
      return `Offline · ${syncState.pendingMutations ?? 0} mutaciones en cola`;
    case 'syncing':
      return 'Sincronizando...';
    case 'error':
      return 'Revisión pendiente';
  }
}

/** Displays real-time / offline-first TanStack Query sync status in the header. */
export function SyncStatusPill({ syncState, className, ref }: SyncStatusPillProps) {
  return (
    <div
      ref={ref}
      data-slot="sync-status-pill"
      data-status={syncState.status}
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium tabular-nums',
        SYNC_STYLES[syncState.status],
        className,
      )}
    >
      <span
        data-slot="sync-status-dot"
        className={cn('size-1.5 rounded-full', SYNC_DOT_STYLES[syncState.status])}
        aria-hidden="true"
      />
      <span>{formatSyncLabel(syncState)}</span>
    </div>
  );
}

export interface ShacAppShellProps {
  profile: Pick<TenantMarketProfile, 'tenantId' | 'editionPreset' | 'activeModules' | 'vocabulary'>;
  branchName: string;
  navItems: ShacNavItem[];
  activeHref?: string;
  onNavigate?: (href: string) => void;
  syncState: SyncState;
  density?: 'touch' | 'compact';
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  loading?: boolean;
  headerActions?: ReactNode;
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** Open Mercato DS v3 bimodal application shell with searchable collapsible sidebar and topbar chrome. */
export function ShacAppShell({
  profile,
  branchName,
  navItems,
  activeHref,
  onNavigate,
  syncState,
  density = 'compact',
  theme = 'light',
  onToggleTheme,
  loading = false,
  headerActions,
  children,
  className,
  ref,
}: ShacAppShellProps) {
  const [navSearch, setNavSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const visibleNav = useMemo(() => {
    const term = navSearch.trim().toLowerCase();
    return navItems.filter((item) => {
      if (item.moduleId && !profile.activeModules.includes(item.moduleId)) return false;
      if (term && !item.label.toLowerCase().includes(term) && !(item.group ?? '').toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [navItems, profile.activeModules, navSearch]);

  const groupedNav = useMemo(() => {
    const map = new Map<string, ShacNavItem[]>();
    for (const item of visibleNav) {
      const key = item.group ?? 'GENERAL';
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [visibleNav]);

  const activeNavItem = useMemo(
    () => navItems.find((item) => item.href === activeHref),
    [navItems, activeHref],
  );

  function toggleGroup(groupName: string) {
    setCollapsedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  }

  return (
    <div
      ref={ref}
      data-slot="app-shell"
      data-density={density}
      data-theme={theme}
      className={cn(
        'min-h-screen bg-background text-foreground flex flex-col lg:flex-row',
        theme === 'dark' && 'dark',
        className,
      )}
    >
      {sidebarOpen ? (
        <ShacSidebar
          profile={profile}
          groupedNav={groupedNav}
          visibleCount={visibleNav.length}
          loading={loading}
          navSearch={navSearch}
          onNavSearchChange={setNavSearch}
          collapsedGroups={collapsedGroups}
          onToggleGroup={toggleGroup}
          activeHref={activeHref}
          onNavigate={onNavigate}
          density={density}
        />
      ) : null}

      <div className="flex-1 min-w-0 flex flex-col bg-background">
        <header
          data-slot="app-shell-header"
          className="h-14 px-4 border-b border-border bg-background flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              aria-label="Alternar barra lateral"
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground"
            >
              {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </button>
            <button
              type="button"
              aria-label="Inicio"
              onClick={() => onNavigate?.('/')}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Home className="size-4" />
            </button>
            {activeNavItem && activeNavItem.href !== '/' ? (
              <>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
                <span className="truncate text-xs font-medium text-foreground">{activeNavItem.label}</span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate?.('/automation')}
              className="hidden md:inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Sparkles className="size-3.5 text-foreground" />
              <span>AI</span>
              <kbd className="rounded border border-border bg-muted/60 px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
            </button>

            <button
              type="button"
              onClick={() => onNavigate?.('/auth')}
              title={`Cambiar ${profile.vocabulary.branchSingular.toLowerCase()}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted"
            >
              <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="max-w-32 truncate">{branchName}</span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            </button>

            <button
              type="button"
              aria-label="Módulos"
              onClick={() => onNavigate?.('/app-store')}
              className="hidden sm:inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plug className="size-4" />
            </button>

            <SyncStatusPill syncState={syncState} />

            {onToggleTheme ? (
              <button
                type="button"
                data-slot="theme-toggle"
                onClick={onToggleTheme}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  density === 'touch' ? 'min-h-11 px-3' : 'h-8',
                )}
              >
                {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                <span className="hidden sm:inline">{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
              </button>
            ) : null}

            {headerActions}
          </div>
        </header>

        <main data-slot="app-shell-main" className="flex-1 p-5 lg:p-7 overflow-auto">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
