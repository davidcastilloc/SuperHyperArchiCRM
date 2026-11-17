import { TrendingUp } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface TimeSeriesPoint {
  label: string;
  value: number;
  secondaryValue?: number;
}

export interface TimeSeriesChartProps {
  title: string;
  subtitle?: string;
  series: readonly TimeSeriesPoint[];
  valuePrefix?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  className?: string;
}

/** Deterministic SVG bar + comparison chart styled with Open Mercato DS v3 tokens. */
export function TimeSeriesChart({
  title,
  subtitle,
  series,
  valuePrefix = '',
  primaryLabel = 'Actual',
  secondaryLabel = 'Objetivo',
  className,
}: TimeSeriesChartProps) {
  const maxVal = Math.max(
    1,
    ...series.flatMap((pt) => [pt.value, pt.secondaryValue ?? 0]),
  );
  const totalPrimary = series.reduce((sum, pt) => sum + pt.value, 0);
  const chartHeight = 132;
  const slotWidth = 48;
  const svgWidth = Math.max(240, series.length * slotWidth);

  return (
    <div
      data-slot="time-series-chart"
      className={cn(
        'rounded-lg border border-border bg-card p-4 shadow-xs',
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle ? (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <TrendingUp className="size-3" />
          <span className="font-mono">
            {valuePrefix}
            {totalPrimary.toLocaleString('en-US')}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${chartHeight + 24}`}
          className="h-40 w-full min-w-[240px]"
          role="img"
          aria-label={title}
        >
          <line
            x1="0"
            y1={chartHeight}
            x2={svgWidth}
            y2={chartHeight}
            stroke="currentColor"
            className="text-border"
            strokeWidth="1"
          />
          {series.map((pt, idx) => {
            const xBase = idx * slotWidth + 10;
            const h1 = Math.max(4, Math.round((pt.value / maxVal) * (chartHeight - 16)));
            const h2 =
              pt.secondaryValue !== undefined
                ? Math.max(4, Math.round((pt.secondaryValue / maxVal) * (chartHeight - 16)))
                : 0;
            return (
              <g key={pt.label}>
                <rect
                  x={xBase}
                  y={chartHeight - h1}
                  width={pt.secondaryValue !== undefined ? 13 : 24}
                  height={h1}
                  rx="3"
                  className="fill-primary/85"
                >
                  <title>{`${pt.label} · ${primaryLabel}: ${valuePrefix}${pt.value}`}</title>
                </rect>
                {pt.secondaryValue !== undefined ? (
                  <rect
                    x={xBase + 16}
                    y={chartHeight - h2}
                    width={13}
                    height={h2}
                    rx="3"
                    className="fill-muted-foreground/30"
                  >
                    <title>{`${pt.label} · ${secondaryLabel}: ${valuePrefix}${pt.secondaryValue}`}</title>
                  </rect>
                ) : null}
                <text
                  x={xBase + (pt.secondaryValue !== undefined ? 14 : 12)}
                  y={chartHeight + 16}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {pt.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
