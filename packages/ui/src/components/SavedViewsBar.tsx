import { Download, Layers } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface SavedViewOption {
  id: string;
  label: string;
}

export interface SavedViewsBarProps {
  views: SavedViewOption[];
  activeViewId: string;
  onSelectView: (id: string) => void;
  onExport?: () => void;
  exportLabel?: string;
  className?: string;
}

/** Escapes and serializes headers + tabular rows into RFC-4180 CSV content. */
export function toCsvString(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const escapeCell = (val: string | number | null | undefined): string => {
    const raw = val === null || val === undefined ? '' : String(val);
    if (/[",\n\r]/.test(raw)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ];
  return lines.join('\n');
}

/** Triggers a browser CSV file download in client environments. */
export function downloadCsvFile(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const csv = toCsvString(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Open Mercato DS v3 Saved Perspectives selector ("Views: All views") + CSV Export button. */
export function SavedViewsBar({
  views,
  activeViewId,
  onSelectView,
  onExport,
  exportLabel = 'Exportar',
  className,
}: SavedViewsBarProps) {
  return (
    <div data-slot="saved-views-bar" className={cn('inline-flex flex-wrap items-center gap-2', className)}>
      <label className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs shadow-xs">
        <Layers className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">Vista</span>
        <select
          aria-label="Seleccionar vista"
          value={activeViewId}
          onChange={(e) => onSelectView(e.target.value)}
          className="bg-transparent pr-5 font-medium text-foreground focus:outline-none"
        >
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      {onExport ? (
        <button
          type="button"
          onClick={onExport}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted"
        >
          <Download className="size-3.5 text-muted-foreground" />
          <span>{exportLabel}</span>
        </button>
      ) : null}
    </div>
  );
}
