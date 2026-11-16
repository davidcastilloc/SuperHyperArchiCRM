import type { ReactNode } from 'react';
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
    <div data-slot="filter-bar" className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-1 items-center gap-2 min-w-56">
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {searchValue ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="h-9 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted"
            >
              Limpiar
            </button>
          ) : null}
        </div>
        {trailingItems ? <div className="flex items-center gap-2">{trailingItems}</div> : null}
      </div>

      {chips.length > 0 && onSelectChip ? (
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Filtros rápidos">
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
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-muted',
                )}
              >
                <span>{chip.label}</span>
                {chip.count !== undefined ? (
                  <span className={cn('font-mono text-[11px] tabular-nums', active ? 'opacity-90' : 'text-muted-foreground')}>
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
