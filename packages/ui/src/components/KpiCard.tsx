import type { ReactNode, Ref } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface KpiTrend {
  value: number;
  direction: 'up' | 'down' | 'unchanged';
}

export interface KpiCardProps {
  title?: string;
  value: number | string | null;
  trend?: KpiTrend;
  comparisonLabel?: string;
  loading?: boolean;
  error?: string | null;
  formatValue?: (value: number) => string;
  prefix?: string;
  suffix?: string;
  className?: string;
  headerAction?: ReactNode;
  footer?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

function defaultFormatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const TREND_STYLE: Record<KpiTrend['direction'], string> = {
  up: 'bg-status-success-bg text-status-success-text border-status-success-border',
  down: 'bg-status-error-bg text-status-error-text border-status-error-border',
  unchanged: 'bg-status-neutral-bg text-status-neutral-text border-status-neutral-border',
};

/** KPI summary card ported from @open-mercato/ui DS v3 for React 19 + Tailwind v4. */
export function KpiCard({
  title,
  value,
  trend,
  comparisonLabel,
  loading,
  error,
  formatValue = defaultFormatValue,
  prefix = '',
  suffix = '',
  className,
  headerAction,
  footer,
  ref,
}: KpiCardProps) {
  const formatted =
    value === null
      ? '—'
      : typeof value === 'string'
        ? `${prefix}${value}${suffix}`
        : `${prefix}${formatValue(value)}${suffix}`;

  return (
    <div
      ref={ref}
      data-slot="kpi-card"
      className={cn('rounded-xl border border-border bg-card p-4 text-card-foreground shadow-xs', className)}
    >
      {title || headerAction ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title ? (
            <p className="text-overline font-medium uppercase text-muted-foreground">{title}</p>
          ) : null}
          {headerAction}
        </div>
      ) : null}

      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : loading ? (
        <div className="h-7 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <div className="flex items-baseline gap-2.5">
          <p className="text-2xl font-semibold tracking-tight tabular-nums">{formatted}</p>
          {trend ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums',
                TREND_STYLE[trend.direction],
              )}
            >
              {trend.direction === 'up' ? (
                <TrendingUp className="size-3" />
              ) : trend.direction === 'down' ? (
                <TrendingDown className="size-3" />
              ) : (
                <Minus className="size-3" />
              )}
              <span>{Math.abs(trend.value)}%</span>
            </span>
          ) : null}
        </div>
      )}

      {comparisonLabel ? <p className="mt-1 text-xs text-muted-foreground">{comparisonLabel}</p> : null}
      {footer ? <div className="mt-2 border-t border-border pt-2">{footer}</div> : null}
    </div>
  );
}
