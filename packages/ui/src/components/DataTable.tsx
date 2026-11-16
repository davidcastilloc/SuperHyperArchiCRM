import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { EmptyState } from './EmptyState.js';
import { RowActions, type RowActionItem } from './SectionHeader.js';

export interface DataTableColumn<TRow> {
  id: string;
  header: string;
  cell: (row: TRow) => ReactNode;
  sortValue?: (row: TRow) => string | number;
  align?: 'left' | 'right';
  className?: string;
}

export interface DataTableProps<TRow> {
  columns: DataTableColumn<TRow>[];
  data: TRow[];
  getRowId: (row: TRow) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  onRowClick?: (row: TRow) => void;
  selectedRowId?: string | null;
  rowActions?: (row: TRow) => RowActionItem[];
  className?: string;
}

/** Sortable enterprise DataTable with EmptyState & RowActions ported from @open-mercato/ui. */
export function DataTable<TRow>({
  columns,
  data,
  getRowId,
  loading = false,
  emptyTitle = 'Sin registros',
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  onRowClick,
  selectedRowId,
  rowActions,
  className,
}: DataTableProps<TRow>) {
  const [sortColId, setSortColId] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function toggleSort(colId: string) {
    if (sortColId === colId) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColId(colId);
    setSortDir('asc');
  }

  const sortedData = useMemo(() => {
    if (!sortColId) return data;
    const col = columns.find((c) => c.id === sortColId);
    if (!col?.sortValue) return data;
    const getVal = col.sortValue;
    return [...data].sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, columns, sortColId, sortDir]);

  if (loading) {
    return (
      <div data-slot="data-table-loading" className={cn('space-y-2 rounded-lg border border-border bg-card p-4', className)}>
        <div className="h-8 animate-pulse rounded bg-muted" />
        <div className="h-8 animate-pulse rounded bg-muted" />
        <div className="h-8 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (sortedData.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
        className={className}
      />
    );
  }

  return (
    <div data-slot="data-table" className={cn('overflow-x-auto rounded-lg border border-border bg-card', className)}>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
          <tr>
            {columns.map((col) => {
              const isSorted = sortColId === col.id;
              return (
                <th
                  key={col.id}
                  className={cn('px-3 py-2 font-medium', col.align === 'right' && 'text-right', col.className)}
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.id)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      <span>{col.header}</span>
                      <span className="font-mono text-[10px]">
                        {isSorted ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
            {rowActions ? <th className="w-12 px-3 py-2 text-right">Acciones</th> : null}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row) => {
            const rowId = getRowId(row);
            const selected = selectedRowId === rowId;
            return (
              <tr
                key={rowId}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                data-selected={selected ? 'true' : 'false'}
                className={cn(
                  'border-b border-border last:border-b-0 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-muted/40',
                  selected && 'bg-primary/5',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn('px-3 py-2', col.align === 'right' && 'text-right', col.className)}
                  >
                    {col.cell(row)}
                  </td>
                ))}
                {rowActions ? (
                  <td className="px-3 py-2 text-right">
                    <RowActions items={rowActions(row)} />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
