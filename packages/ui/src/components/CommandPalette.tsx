import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CircleDot, CornerDownLeft, Search, X } from 'lucide-react';
import { cn } from '../lib/cn.js';
import type { ShacNavItem } from './ShacSidebar.js';
import type { SyncState } from './ShacAppShell.js';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: ShacNavItem[];
  onSelect: (href: string) => void;
}

/** Open Mercato DS v3 global Ctrl+K / Cmd+K command & navigation palette. */
export function CommandPalette({ open, onClose, items, onSelect }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return undefined;
  }, [open]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(term) ||
        (item.group ?? '').toLowerCase().includes(term) ||
        item.href.toLowerCase().includes(term),
    );
  }, [items, query]);

  if (!open) return null;

  function handleSelect(href: string) {
    onClose();
    onSelect(href);
  }

  return (
    <div
      data-slot="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Paleta de comandos"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/25 px-4 pt-20 backdrop-blur-[1px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'ArrowDown' && filtered.length > 0) {
            e.preventDefault();
            setActiveIndex((prev) => (prev + 1) % filtered.length);
          } else if (e.key === 'ArrowUp' && filtered.length > 0) {
            e.preventDefault();
            setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
          } else if (e.key === 'Enter' && filtered[activeIndex]) {
            e.preventDefault();
            handleSelect(filtered[activeIndex].href);
          }
        }}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Ir a pantalla o buscar comando..."
            className="h-7 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="button"
            aria-label="Cerrar paleta"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div role="listbox" aria-label="Resultados de navegación" className="max-h-72 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Sin coincidencias para &ldquo;{query}&rdquo;
            </p>
          ) : (
            filtered.map((item, idx) => {
              const selected = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => handleSelect(item.href)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors',
                    selected ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="shrink-0 text-foreground">{item.icon ?? <CircleDot className="size-4" />}</span>
                    <span className="truncate text-foreground">{item.label}</span>
                    {item.group ? (
                      <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {item.group}
                      </span>
                    ) : null}
                  </span>
                  <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/** Topbar notification center popover showing Edge sync & active preset status. */
export function NotificationBell({
  syncState,
  editionPreset,
  branchName,
  onNavigate,
}: {
  syncState: SyncState;
  editionPreset: string;
  branchName: string;
  onNavigate?: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasPending = (syncState.pendingMutations ?? 0) > 0;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notificaciones"
        onClick={() => setOpen((prev) => !prev)}
        className="relative hidden sm:inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-4" />
        {hasPending ? (
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-status-warning-icon" />
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1.5 w-72 rounded-xl border border-border bg-popover p-3.5 shadow-lg space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Centro Operativo</p>
            <span className="font-mono text-[10px] text-muted-foreground">{editionPreset}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {hasPending
              ? `${syncState.pendingMutations} mutaciones offline pendientes de liquidar en ${branchName}.`
              : `Conectado en tiempo real con ${branchName} (D1 + Durable Object).`}
          </p>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onNavigate?.('/tasks');
            }}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Ver Tareas de Clientes
          </button>
        </div>
      ) : null}
    </div>
  );
}
