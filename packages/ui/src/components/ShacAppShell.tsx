import { useMemo, useState, type ReactNode, type Ref } from 'react';
import type { MarketVocabulary, TenantMarketProfile } from '@shac/kernel';
import { cn } from '../lib/cn.js';

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'error';

export interface SyncState {
  status: SyncStatus;
  pendingMutations?: number;
}

export interface ShacNavItem {
  id: string;
  label: string;
  href: string;
  group?: string;
  moduleId?: string;
  shortcut?: string;
}

export interface SyncStatusPillProps {
  syncState: SyncState;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

const SYNC_STYLES: Record<SyncStatus, string> = {
  online: 'border-ok/30 bg-ok/10 text-ok',
  offline: 'border-warn/30 bg-warn/10 text-warn',
  syncing: 'border-primary/30 bg-primary/10 text-primary',
  error: 'border-danger/30 bg-danger/10 text-danger',
};

const SYNC_DOT_STYLES: Record<SyncStatus, string> = {
  online: 'bg-ok',
  offline: 'bg-warn',
  syncing: 'bg-primary animate-pulse',
  error: 'bg-danger',
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
        'inline-flex items-center gap-2 rounded-sm border px-2.5 py-1 text-xs font-medium tabular-nums',
        SYNC_STYLES[syncState.status],
        className,
      )}
    >
      <span
        data-slot="sync-status-dot"
        className={cn('size-2 rounded-full', SYNC_DOT_STYLES[syncState.status])}
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

/** Open Mercato-style bimodal application shell with searchable collapsible sidebar. */
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
  const vocab: MarketVocabulary = profile.vocabulary;
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
        <aside
          data-slot="app-shell-sidebar"
          className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-border bg-card flex flex-col"
        >
          <div
            data-slot="app-shell-brand"
            className="h-14 px-4 border-b border-border flex items-center gap-2.5"
          >
            <div className="size-7 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              SH
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{branchName}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {vocab.branchSingular} · {profile.editionPreset}
              </p>
            </div>
          </div>

          <div className="p-2.5 border-b border-border">
            <input
              type="search"
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              placeholder="Buscar menú..."
              className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <nav data-slot="app-shell-nav" aria-label="Navegación principal" className="p-2.5 flex-1 space-y-3 overflow-y-auto">
            {loading ? (
              <div data-slot="app-shell-nav-skeleton" className="space-y-2 p-2">
                <div className="h-7 rounded-md bg-muted animate-pulse" />
                <div className="h-7 rounded-md bg-muted animate-pulse" />
                <div className="h-7 rounded-md bg-muted animate-pulse" />
              </div>
            ) : visibleNav.length === 0 ? (
              <p data-slot="app-shell-nav-empty" className="px-3 py-2 text-xs text-muted-foreground">
                Sin módulos activos
              </p>
            ) : (
              groupedNav.map(([groupName, items]) => {
                const isCollapsed = !navSearch.trim() && Boolean(collapsedGroups[groupName]);
                return (
                  <div key={groupName} className="space-y-1">
                    {groupName !== 'GENERAL' ? (
                      <button
                        type="button"
                        onClick={() => toggleGroup(groupName)}
                        className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                      >
                        <span>{groupName}</span>
                        <span className="font-mono text-[10px]">{isCollapsed ? '▸' : '▾'}</span>
                      </button>
                    ) : null}
                    {!isCollapsed
                      ? items.map((item) => {
                          const isActive = activeHref === item.href;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-slot="app-shell-nav-item"
                              data-active={isActive ? 'true' : 'false'}
                              onClick={() => onNavigate?.(item.href)}
                              className={cn(
                                'w-full flex items-center justify-between rounded-md px-2.5 text-left text-sm font-medium transition-colors',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                density === 'touch' ? 'min-h-12 py-2.5 text-base' : 'h-8 py-1',
                                isActive
                                  ? 'bg-primary text-primary-foreground'
                                  : 'text-foreground hover:bg-muted',
                              )}
                            >
                              <span className="truncate">{item.label}</span>
                              {item.shortcut ? (
                                <span className="ml-2 font-mono text-[11px] opacity-75">{item.shortcut}</span>
                              ) : null}
                            </button>
                          );
                        })
                      : null}
                  </div>
                );
              })
            )}
          </nav>
        </aside>
      ) : null}

      <div className="flex-1 min-w-0 flex flex-col">
        <header
          data-slot="app-shell-header"
          className="h-14 px-4 border-b border-border bg-card flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              aria-label="Alternar barra lateral"
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="h-8 rounded-md border border-border px-2 text-xs hover:bg-muted"
            >
              ☰
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('/')}
              className="h-8 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Inicio
            </button>
            <span className="text-xs font-mono text-muted-foreground truncate">
              · {profile.tenantId}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {headerActions}
            <SyncStatusPill syncState={syncState} />
            {onToggleTheme ? (
              <button
                type="button"
                data-slot="theme-toggle"
                onClick={onToggleTheme}
                className={cn(
                  'rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  density === 'touch' ? 'min-h-12 px-3' : 'h-8',
                )}
              >
                {theme === 'dark' ? 'Claro' : 'Oscuro'}
              </button>
            ) : null}
          </div>
        </header>

        <main data-slot="app-shell-main" className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
