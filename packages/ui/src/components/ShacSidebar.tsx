import type { ReactNode } from 'react';
import type { TenantMarketProfile } from '@shac/kernel';
import { Boxes, ChevronUp, CircleDot, Search, X } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface ShacNavItem {
  id: string;
  label: string;
  href: string;
  group?: string;
  moduleId?: string;
  allowedPresets?: readonly string[];
  shortcut?: string;
  icon?: ReactNode;
}

interface ShacSidebarProps {
  profile: Pick<TenantMarketProfile, 'tenantId' | 'editionPreset' | 'activeModules' | 'vocabulary'>;
  groupedNav: Array<[string, ShacNavItem[]]>;
  visibleCount: number;
  loading: boolean;
  navSearch: string;
  onNavSearchChange: (value: string) => void;
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (groupName: string) => void;
  activeHref?: string;
  onNavigate?: (href: string) => void;
  density: 'touch' | 'compact';
  collapsed?: boolean;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

/** DESIGN.md v2.2 bimodal sidebar: off-canvas drawer on <1024px, collapsible 240px/64px rail on desktop. */
export function ShacSidebar({
  profile,
  groupedNav,
  visibleCount,
  loading,
  navSearch,
  onNavSearchChange,
  collapsedGroups,
  onToggleGroup,
  activeHref,
  onNavigate,
  density,
  collapsed = false,
  mobileOpen = false,
  onCloseMobile,
}: ShacSidebarProps) {
  return (
    <>
      {mobileOpen ? (
        <div
          aria-hidden="true"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      ) : null}
      <aside
        data-slot="app-shell-sidebar"
        data-collapsed={collapsed ? 'true' : 'false'}
        className={cn(
          'shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex-col transition-all duration-150',
          mobileOpen
            ? 'fixed inset-y-0 left-0 z-50 flex w-72 shadow-lg lg:static lg:z-auto lg:shadow-none'
            : 'hidden lg:flex',
          collapsed ? 'lg:w-16' : 'lg:w-60',
        )}
      >
        <div
          data-slot="app-shell-brand"
          className={cn('h-14 flex items-center justify-between gap-2', collapsed ? 'lg:justify-center px-2' : 'px-4')}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              aria-hidden="true"
              className="size-8 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center shadow-xs"
            >
              <Boxes className="size-4" strokeWidth={2.2} />
            </div>
            {!collapsed ? (
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight truncate">SuperHyperArchi</p>
                <p className="text-xs text-muted-foreground truncate">
                  {profile.vocabulary.branchSingular} · {profile.editionPreset}
                </p>
              </div>
            ) : null}
          </div>
          {mobileOpen ? (
            <button
              type="button"
              aria-label="Cerrar menú"
              onClick={onCloseMobile}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted lg:hidden"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {!collapsed ? (
          <div className="px-3 pb-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="search"
                value={navSearch}
                onChange={(e) => onNavSearchChange(e.target.value)}
                placeholder="Buscar menú..."
                className="h-8 w-full rounded-md border border-sidebar-border bg-background pl-8 pr-7 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              {navSearch ? (
                <button
                  type="button"
                  aria-label="Limpiar búsqueda"
                  onClick={() => onNavSearchChange('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <nav
          data-slot="app-shell-nav"
          aria-label="Navegación principal"
          className={cn('pb-4 flex-1 space-y-3 overflow-y-auto', collapsed ? 'px-2' : 'px-3')}
        >
          {loading ? (
            <div data-slot="app-shell-nav-skeleton" className="space-y-2 p-1">
              <div className="h-7 rounded-md bg-muted animate-pulse" />
              <div className="h-7 rounded-md bg-muted animate-pulse" />
              <div className="h-7 rounded-md bg-muted animate-pulse" />
            </div>
          ) : visibleCount === 0 ? (
            <p data-slot="app-shell-nav-empty" className="px-2 py-2 text-xs text-muted-foreground">
              Sin módulos activos
            </p>
          ) : (
            groupedNav.map(([groupName, items], groupIdx) => {
              const isGroupCollapsed = !collapsed && !navSearch.trim() && Boolean(collapsedGroups[groupName]);
              return (
                <div
                  key={groupName}
                  className={cn('space-y-0.5', groupIdx > 0 && 'border-t border-sidebar-border pt-3')}
                >
                  {!collapsed && groupName !== 'GENERAL' ? (
                    <button
                      type="button"
                      onClick={() => onToggleGroup(groupName)}
                      className="mb-1 w-full flex items-center justify-between px-2 py-1 text-overline font-medium uppercase text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span className="truncate">{groupName}</span>
                      <ChevronUp
                        className={cn(
                          'size-3.5 shrink-0 text-muted-foreground/80 transition-transform duration-150',
                          isGroupCollapsed && 'rotate-180',
                        )}
                      />
                    </button>
                  ) : null}
                  {!isGroupCollapsed
                    ? items.map((item) => {
                        const isActive = activeHref === item.href;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            title={item.label}
                            data-slot="app-shell-nav-item"
                            data-active={isActive ? 'true' : 'false'}
                            onClick={() => {
                              onNavigate?.(item.href);
                              onCloseMobile?.();
                            }}
                            className={cn(
                              'relative w-full flex items-center rounded-md text-left text-[13px] transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                              collapsed ? 'justify-center px-0 py-2' : 'justify-between gap-2 px-2.5',
                              density === 'touch' ? 'min-h-11 py-2 text-sm' : 'h-8 py-1.5',
                              isActive
                                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                                : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
                            )}
                          >
                            {isActive && !collapsed ? (
                              <span aria-hidden="true" className="absolute -left-3 top-1.5 h-5 w-1 rounded-r bg-primary" />
                            ) : null}
                            <span className={cn('flex items-center min-w-0', !collapsed && 'gap-2.5')}>
                              <span className={cn('shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')}>
                                {item.icon ?? <CircleDot className="size-4" />}
                              </span>
                              {!collapsed ? <span className="truncate">{item.label}</span> : null}
                            </span>
                            {!collapsed && item.shortcut ? (
                              <kbd className="ml-1 shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {item.shortcut}
                              </kbd>
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
    </>
  );
}
