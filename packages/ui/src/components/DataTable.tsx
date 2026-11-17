import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { EmptyState } from './EmptyState.js';
import { RowActions, type RowActionItem } from './SectionHeader.js';

export interface VirtualWindowSlice {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly topSpacerPx: number;
  readonly bottomSpacerPx: number;
}

export function computeVirtualWindowSlice(
  totalRows: number,
  scrollTopPx: number,
  viewportHeightPx: number,
  rowHeightPx = 44,
  overscanRows = 6,
): VirtualWindowSlice {
  if (totalRows <= 0) {
    return { startIndex: 0, endIndex: 0, topSpacerPx: 0, bottomSpacerPx: 0 };
  }
  const visibleCount = Math.ceil(Math.max(1, viewportHeightPx) / rowHeightPx);
  const rawStart = Math.floor(Math.max(0, scrollTopPx) / rowHeightPx);
  const startIndex = Math.max(0, rawStart - overscanRows);
  const endIndex = Math.min(totalRows, rawStart + visibleCount + overscanRows);

  return {
    startIndex,
    endIndex,
    topSpacerPx: startIndex * rowHeightPx,
    bottomSpacerPx: Math.max(0, (totalRows - endIndex) * rowHeightPx),
  };
}

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

/** Sortable enterprise DataTable with hairline header dividers & RowActions ported from @open-mercato/ui. */
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
  const [scrollTop, setScrollTop] = useState(0);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);

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
      <div
        data-slot="data-table-loading"
        className={cn('space-y-2 rounded-lg border border-border bg-card p-4 shadow-xs', className)}
      >
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

  const isVirtualized = sortedData.length > 80;
  const windowSlice = isVirtualized
    ? computeVirtualWindowSlice(sortedData.length, scrollTop, 480)
    : { startIndex: 0, endIndex: sortedData.length, topSpacerPx: 0, bottomSpacerPx: 0 };
  const visibleRows = sortedData.slice(windowSlice.startIndex, windowSlice.endIndex);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (sortedData.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIdx((prev) => Math.min(sortedData.length - 1, prev + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx((prev) => Math.max(0, prev - 1));
    } else if (e.key === 'Enter' && focusedIdx >= 0 && onRowClick) {
      const target = sortedData[focusedIdx];
      if (target) onRowClick(target);
    }
  }

  return (
    <div
      data-slot="data-table"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onScroll={isVirtualized ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
      className={cn(
        'overflow-x-auto rounded-lg border border-border bg-card shadow-xs outline-none',
        isVirtualized && 'max-h-[480px] overflow-y-auto',
        className,
      )}
    >
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
          <tr>
            {columns.map((col) => {
              const isSorted = sortColId === col.id;
              return (
                <th
                  key={col.id}
                  className={cn(
                    'border-r border-border/60 last:border-r-0 px-3.5 py-2.5 font-medium',
                    col.align === 'right' && 'text-right',
                    col.className,
                  )}
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 transition-colors hover:text-foreground',
                        col.align === 'right' && 'ml-auto',
                      )}
                    >
                      <span>{col.header}</span>
                      {isSorted ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="size-3.5 text-foreground" />
                        ) : (
                          <ArrowDown className="size-3.5 text-foreground" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3.5 text-muted-foreground/60" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
            {rowActions ? (
              <th className="w-16 px-3.5 py-2.5 text-right font-medium">Acciones</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {windowSlice.topSpacerPx > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={columns.length + (rowActions ? 1 : 0)} style={{ height: windowSlice.topSpacerPx, padding: 0 }} />
            </tr>
          ) : null}
          {visibleRows.map((row, localIdx) => {
            const absIdx = windowSlice.startIndex + localIdx;
            const rowId = getRowId(row);
            const selected = selectedRowId === rowId || focusedIdx === absIdx;
            return (
              <tr
                key={rowId}
                data-row-id={rowId}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                data-selected={selected ? 'true' : 'false'}
                className={cn(
                  'border-b border-border/80 last:border-b-0 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-muted/45',
                  selected && 'bg-muted/70',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn('px-3.5 py-2.5 align-middle', col.align === 'right' && 'text-right', col.className)}
                  >
                    {col.cell(row)}
                  </td>
                ))}
                {rowActions ? (
                  <td className="px-3.5 py-2.5 text-right align-middle">
                    <RowActions items={rowActions(row)} />
                  </td>
                ) : null}
              </tr>
            );
          })}
          {windowSlice.bottomSpacerPx > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={columns.length + (rowActions ? 1 : 0)} style={{ height: windowSlice.bottomSpacerPx, padding: 0 }} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
