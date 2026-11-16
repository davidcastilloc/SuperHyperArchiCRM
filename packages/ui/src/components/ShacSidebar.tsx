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
}

/** Open Mercato DS v3 sidebar with brand emblem, search input, collapsible sections, and left active bar. */
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
}: ShacSidebarProps) {
  return (
    <aside
      data-slot="app-shell-sidebar"
      className="w-full lg:w-60 shrink-0 border-b lg:border-b-0 lg:border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col"
    >
      <div
        data-slot="app-shell-brand"
        className="h-14 px-4 flex items-center gap-2.5"
      >
        <div
          aria-hidden="true"
          className="size-8 shrink-0 rounded-full bg-[linear-gradient(135deg,var(--brand-lime),var(--brand-yellow),var(--brand-violet))] flex items-center justify-center shadow-xs"
        >
          <Boxes className="size-4 text-[#171717]" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight truncate">SuperHyperArchi</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {profile.vocabulary.branchSingular} · {profile.editionPreset}
          </p>
        </div>
      </div>

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

      <nav
        data-slot="app-shell-nav"
        aria-label="Navegación principal"
        className="px-3 pb-4 flex-1 space-y-3 overflow-y-auto"
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
            const isCollapsed = !navSearch.trim() && Boolean(collapsedGroups[groupName]);
            return (
              <div
                key={groupName}
                className={cn('space-y-0.5', groupIdx > 0 && 'border-t border-sidebar-border pt-3')}
              >
                {groupName !== 'GENERAL' ? (
                  <button
                    type="button"
                    onClick={() => onToggleGroup(groupName)}
                    className="mb-1 w-full flex items-center justify-between px-2 py-1 text-overline font-medium uppercase text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span>{groupName}</span>
                    <ChevronUp
                      className={cn(
                        'size-3.5 text-muted-foreground/80 transition-transform duration-150',
                        isCollapsed && 'rotate-180',
                      )}
                    />
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
                            'relative w-full flex items-center justify-between gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                            density === 'touch' ? 'min-h-11 py-2 text-sm' : 'h-8 py-1.5',
                            isActive
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                              : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
                          )}
                        >
                          {isActive ? (
                            <span
                              aria-hidden="true"
                              className="absolute -left-3 top-1.5 h-5 w-1 rounded-r bg-foreground"
                            />
                          ) : null}
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span className={cn('shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')}>
                              {item.icon ?? <CircleDot className="size-4" />}
                            </span>
                            <span className="truncate">{item.label}</span>
                          </span>
                          {item.shortcut ? (
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
  );
}
