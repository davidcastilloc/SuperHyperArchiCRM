import type { ReactNode } from 'react';
import { ListFilter, Search, X } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface FilterChipOption {
  id: string;
  label: string;
  count?: number;
}

export interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  chips?: FilterChipOption[];
  activeChipId?: string;
  onSelectChip?: (id: string) => void;
  trailingItems?: ReactNode;
  className?: string;
}

/** Search + quick filter chips toolbar ported from @open-mercato/ui FilterBar. */
export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Buscar...',
  chips = [],
  activeChipId,
  onSelectChip,
  trailingItems,
  className,
}: FilterBarProps) {
  return (
    <div data-slot="filter-bar" className={cn('space-y-2.5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="relative flex-1 min-w-56 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-8 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          {searchValue ? (
            <button
              type="button"
              aria-label="Limpiar filtro"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        {trailingItems ? <div className="flex flex-wrap items-center gap-2">{trailingItems}</div> : null}
      </div>

      {chips.length > 0 && onSelectChip ? (
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filtros rápidos">
          <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <ListFilter className="size-3.5" />
            <span>Filtros</span>
          </span>
          {chips.map((chip) => {
            const active = chip.id === activeChipId;
            return (
              <button
                key={chip.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectChip(chip.id)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span>{chip.label}</span>
                {chip.count !== undefined ? (
                  <span
                    className={cn(
                      'font-mono text-[11px] tabular-nums',
                      active ? 'text-primary-foreground/85' : 'text-muted-foreground',
                    )}
                  >
                    {chip.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
