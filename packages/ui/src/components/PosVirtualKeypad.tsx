import { Check, Delete } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface PosVirtualKeypadProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  className?: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'] as const;

/** Touch-friendly 3-column POS numeric keypad inspired by GeorginaPOS VirtualKeypad. */
export function PosVirtualKeypad({ value, onChange, onSubmit, className }: PosVirtualKeypadProps) {
  function press(key: string) {
    if (key === '.' && value.includes('.')) return;
    const next = value === '0' && key !== '.' ? key : `${value}${key}`;
    onChange(next);
  }

  return (
    <div data-slot="pos-virtual-keypad" className={cn('grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/40 p-2', className)}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-card font-mono text-base font-semibold text-foreground shadow-xs hover:bg-muted active:scale-[0.98]"
        >
          {key}
        </button>
      ))}
      <button
        type="button"
        aria-label="Borrar"
        onClick={() => onChange(value.length > 1 ? value.slice(0, -1) : '')}
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-xs hover:bg-muted"
      >
        <Delete className="size-4" />
      </button>
      {onSubmit ? (
        <button
          type="button"
          onClick={onSubmit}
          className="col-span-3 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-xs hover:opacity-90"
        >
          <Check className="size-4" />
          <span>Aplicar</span>
        </button>
      ) : null}
    </div>
  );
}
