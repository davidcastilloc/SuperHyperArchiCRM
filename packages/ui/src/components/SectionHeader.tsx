import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface SectionHeaderProps {
  title: string;
  count?: number;
  action?: ReactNode;
  className?: string;
}

/** Section header with optional numeric badge and right action slot. */
export function SectionHeader({ title, count, action, className }: SectionHeaderProps) {
  return (
    <div data-slot="section-header" className={cn('flex items-center justify-between gap-2', className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {count !== undefined ? (
          <span className="rounded-full bg-status-info-bg px-2 py-0.5 font-mono text-[11px] font-medium text-status-info-text tabular-nums">
            {count}
          </span>
        ) : null}
      </div>
      {action ? <div className="flex items-center gap-1.5">{action}</div> : null}
    </div>
  );
}

export interface RowActionItem {
  id: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

/** Contextual row action menu ported from @open-mercato/ui RowActions. */
export function RowActions({
  items,
  label = 'Acciones',
}: {
  items: RowActionItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={rootRef} data-slot="row-actions" className="relative inline-block text-left">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-44 rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'block w-full rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors hover:bg-muted',
                item.destructive && 'text-danger',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
