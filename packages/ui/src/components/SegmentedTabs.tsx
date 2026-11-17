import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface SegmentedTabItem {
  id: string;
  label: string;
  count?: number;
  icon?: ReactNode;
}

export interface SegmentedTabsProps {
  tabs: readonly SegmentedTabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
}

/** Accessible horizontal segmented tab bar with tabular count badges (Open Mercato DS v3). */
export function SegmentedTabs({ tabs, activeId, onSelect, className }: SegmentedTabsProps) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      data-slot="segmented-tabs"
      className={cn(
        'inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border bg-muted/50 p-1',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
              active
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.count !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums',
                  active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
