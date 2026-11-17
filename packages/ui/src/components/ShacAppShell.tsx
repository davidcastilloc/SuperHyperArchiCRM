import { useEffect, useMemo, useState, type ReactNode, type Ref } from 'react';
import type { TenantMarketProfile } from '@shac/kernel';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Home,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Sun,
} from 'lucide-react';
import { cn } from '../lib/cn.js';
import type { BranchOption } from './AuthBranchGate.js';
import { CommandPalette, NotificationBell } from './CommandPalette.js';
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
        'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium tabular-nums',
        SYNC_STYLES[syncState.status],
        className,
      )}
    >
      <span
        data-slot="sync-status-dot"
        className={cn('size-1.5 shrink-0 rounded-full', SYNC_DOT_STYLES[syncState.status])}
        aria-hidden="true"
      />
      <span>{formatSyncLabel(syncState)}</span>
    </div>
  );
}

export interface ShacAppShellProps {
  profile: Pick<TenantMarketProfile, 'tenantId' | 'editionPreset' | 'activeModules' | 'vocabulary'>;
  branchName: string;
  activeBranchId?: string;
  branches?: readonly BranchOption[];
  onSwitchBranch?: (branchId: string) => void;
  navItems: ShacNavItem[];
  activeHref?: string;
  onNavigate?: (href: string) => void;
  syncState: SyncState;
  density?: 'touch' | 'compact';
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  loading?: boolean;
  defaultCollapsedGroups?: Record<string, boolean>;
  headerActions?: ReactNode;
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** DESIGN.md v2.2 bimodal application shell with mobile drawer, 64px rail, Ctrl+K palette, and inline branch switcher. */
export function ShacAppShell({
  profile,
  branchName,
  activeBranchId,
  branches,
  onSwitchBranch,
  navItems,
  activeHref,
  onNavigate,
  syncState,
  density = 'compact',
  theme = 'light',
  onToggleTheme,
  loading = false,
  defaultCollapsedGroups,
  headerActions,
  children,
  className,
  ref,
}: ShacAppShellProps) {
  const [navSearch, setNavSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    () => defaultCollapsedGroups ?? {},
  );
  const [desktopRailCollapsed, setDesktopRailCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        setBranchMenuOpen(false);
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const enabledNav = useMemo(
    () =>
      navItems.filter(
        (item) =>
          (!item.moduleId || profile.activeModules.includes(item.moduleId)) &&
          (!item.allowedPresets || item.allowedPresets.includes(profile.editionPreset)),
      ),
    [navItems, profile.activeModules, profile.editionPreset],
  );

  const visibleNav = useMemo(() => {
    const term = navSearch.trim().toLowerCase();
    if (!term) return enabledNav;
    return enabledNav.filter(
      (item) => item.label.toLowerCase().includes(term) || (item.group ?? '').toLowerCase().includes(term),
    );
  }, [enabledNav, navSearch]);

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
    () => enabledNav.find((item) => item.href === activeHref) ?? navItems.find((item) => item.href === activeHref),
    [enabledNav, navItems, activeHref],
  );

  return (
    <div
      ref={ref}
      data-slot="app-shell"
      data-density={density}
      data-theme={theme}
      className={cn(
        'min-h-screen lg:h-screen lg:overflow-hidden bg-background text-foreground flex flex-col lg:flex-row',
        theme === 'dark' && 'dark',
        className,
      )}
    >
      <ShacSidebar
        profile={profile}
        groupedNav={groupedNav}
        visibleCount={visibleNav.length}
        loading={loading}
        navSearch={navSearch}
        onNavSearchChange={setNavSearch}
        collapsedGroups={collapsedGroups}
        onToggleGroup={(g) => setCollapsedGroups((prev) => ({ ...prev, [g]: !prev[g] }))}
        activeHref={activeHref}
        onNavigate={onNavigate}
        density={density}
        collapsed={desktopRailCollapsed}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col bg-background">
        <header data-slot="app-shell-header" className="h-14 shrink-0 px-3 sm:px-4 border-b border-border bg-card flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <button type="button" aria-label="Abrir menú" onClick={() => setMobileMenuOpen(true)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground lg:hidden">
              <Menu className="size-4" />
            </button>
            <button type="button" aria-label="Alternar barra lateral" onClick={() => setDesktopRailCollapsed((prev) => !prev)} className="hidden lg:inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground">
              {desktopRailCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
            <button type="button" aria-label="Inicio" onClick={() => onNavigate?.('/')} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <Home className="size-4" />
            </button>
            {activeNavItem && activeNavItem.href !== '/' ? (
              <><ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" /><span className="truncate text-xs font-medium text-foreground">{activeNavItem.label}</span></>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" onClick={() => setPaletteOpen(true)} className="hidden md:inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <Search className="size-3.5" /><span className="hidden xl:inline">Buscar</span>
              <kbd className="rounded border border-border bg-muted/60 px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
            </button>

            <div className="relative">
              <button type="button" onClick={() => (branches && onSwitchBranch ? setBranchMenuOpen((v) => !v) : onNavigate?.('/auth'))} title={`Cambiar ${profile.vocabulary.branchSingular.toLowerCase()}`} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 text-xs font-medium text-foreground shadow-xs hover:bg-muted">
                <Building2 className="size-3.5 shrink-0 text-muted-foreground" /><span className="max-w-28 truncate">{branchName}</span><ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              </button>
              {branchMenuOpen && branches && onSwitchBranch ? (
                <div className="absolute right-0 top-10 z-50 w-56 rounded-lg border border-border bg-popover p-1 shadow-md">
                  {branches.map((br) => (
                    <button key={br.id} type="button" onClick={() => { setBranchMenuOpen(false); onSwitchBranch(br.id); }} className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-muted">
                      <span className="truncate">{br.name}</span>
                      {br.id === activeBranchId ? <Check className="size-3.5 text-primary" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button type="button" aria-label="Módulos" onClick={() => onNavigate?.('/app-store')} className="hidden xl:inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <Plug className="size-4" />
            </button>

            <NotificationBell syncState={syncState} editionPreset={profile.editionPreset} branchName={branchName} onNavigate={onNavigate} />
            <SyncStatusPill syncState={syncState} className="hidden sm:inline-flex" />

            {onToggleTheme ? (
              <button type="button" data-slot="theme-toggle" onClick={onToggleTheme} className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50', density === 'touch' ? 'min-h-11 px-3' : 'h-8')}>
                {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                <span className="hidden xl:inline">{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
              </button>
            ) : null}

            {headerActions}
          </div>
        </header>

        <main data-slot="app-shell-main" className="flex-1 p-4 sm:p-5 lg:p-6 overflow-auto">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={enabledNav} onSelect={(href) => onNavigate?.(href)} />
    </div>
  );
}
