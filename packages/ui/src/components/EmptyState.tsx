import type { ReactNode, Ref } from 'react';
import { cn } from '../lib/cn.js';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actions?: ReactNode;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

const SIZE_CLS: Record<NonNullable<EmptyStateProps['size']>, string> = {
  sm: 'gap-2 px-4 py-6',
  default: 'gap-3 px-6 py-10',
  lg: 'gap-4 px-8 py-14',
};

/** Empty state placeholder ported from @open-mercato/ui. */
export function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  actions,
  size = 'default',
  className,
  ref,
}: EmptyStateProps) {
  return (
    <div
      ref={ref}
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-center',
        SIZE_CLS[size],
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="mt-1 flex items-center gap-2">{actions}</div>
      ) : actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 h-8 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
