import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '../lib/cn.js';

export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
  appearance?: 'pill' | 'dot';
  icon?: ReactNode;
  className?: string;
}

const PILL_STYLES: Record<StatusTone, string> = {
  success: 'border-status-success-border bg-status-success-bg text-status-success-text',
  warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
  error: 'border-status-error-border bg-status-error-bg text-status-error-text',
  info: 'border-status-info-border bg-status-info-bg text-status-info-text',
  neutral: 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-text',
};

const DOT_STYLES: Record<StatusTone, string> = {
  success: 'bg-status-success-icon',
  warning: 'bg-status-warning-icon',
  error: 'bg-status-error-icon',
  info: 'bg-status-info-icon',
  neutral: 'bg-status-neutral-icon',
};

/** Open Mercato DS v3 semantic status indicator (pastel pill or inline status dot). */
export function StatusBadge({
  label,
  tone = 'neutral',
  appearance = 'pill',
  icon,
  className,
}: StatusBadgeProps) {
  if (appearance === 'dot') {
    return (
      <span
        data-slot="status-badge"
        data-tone={tone}
        data-appearance="dot"
        className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}
      >
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span>{label}</span>
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT_STYLES[tone])} />
      </span>
    );
  }

  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      data-appearance="pill"
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-4',
        PILL_STYLES[tone],
        className,
      )}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span>{label}</span>
    </span>
  );
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  actions?: ReactNode;
  className?: string;
}

/** Open Mercato DS v3 standard page header with optional refresh trigger and action bar. */
export function PageHeader({
  title,
  description,
  onRefresh,
  refreshing = false,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn('flex flex-wrap items-start justify-between gap-3', className)}
    >
      <div className="space-y-0.5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {onRefresh || actions ? (
        <div className="flex flex-wrap items-center gap-2">
          {onRefresh ? (
            <button
              type="button"
              aria-label="Actualizar"
              onClick={onRefresh}
              className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            </button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}
