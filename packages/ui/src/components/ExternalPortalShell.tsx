import type { ReactNode } from 'react';
import { Boxes, Moon, Sun } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface ExternalPortalShellProps {
  title?: string;
  subtitle?: string;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  headerRight?: ReactNode;
  maxWidthClass?: string;
  density?: 'touch' | 'compact';
  children: ReactNode;
  className?: string;
}

/** Zero-ERP-chrome shell for anonymous public portals, auth gate, and locked kiosk mode. */
export function ExternalPortalShell({
  title = 'SuperHyperArchi',
  subtitle,
  theme = 'light',
  onToggleTheme,
  headerRight,
  maxWidthClass = 'max-w-5xl',
  density = 'compact',
  children,
  className,
}: ExternalPortalShellProps) {
  return (
    <div
      data-slot="external-portal-shell"
      data-density={density}
      data-theme={theme}
      className={cn(
        'min-h-screen bg-background text-foreground flex flex-col',
        theme === 'dark' && 'dark',
        className,
      )}
    >
      <header
        data-slot="external-portal-header"
        className="h-14 border-b border-border bg-card px-4 sm:px-6 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            aria-hidden="true"
            className="size-8 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center shadow-xs"
          >
            <Boxes className="size-4" strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-tight truncate">{title}</p>
            {subtitle ? <p className="text-xs text-muted-foreground truncate">{subtitle}</p> : null}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {headerRight}
          {onToggleTheme ? (
            <button
              type="button"
              data-slot="theme-toggle"
              onClick={onToggleTheme}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                density === 'touch' ? 'min-h-11 px-3' : 'h-8',
              )}
            >
              {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
            </button>
          ) : null}
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6">
        <div className={cn('mx-auto w-full', maxWidthClass)}>{children}</div>
      </main>
    </div>
  );
}
