import { useRef } from 'react';
import { Check, Delete } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface PosVirtualKeypadProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  replaceOnFirstInput?: boolean;
  className?: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'] as const;

/** Touch-friendly 56px 3-column POS numeric keypad with Clear (C) and overwrite-on-first-tap. */
export function PosVirtualKeypad({
  value,
  onChange,
  onSubmit,
  replaceOnFirstInput = false,
  className,
}: PosVirtualKeypadProps) {
  const pristineRef = useRef(replaceOnFirstInput);

  function press(key: string) {
    if (pristineRef.current) {
      pristineRef.current = false;
      onChange(key === '.' ? '0.' : key);
      return;
    }
    if (key === '.' && value.includes('.')) return;
    const next = value === '0' && key !== '.' ? key : `${value}${key}`;
    onChange(next);
  }

  function handleClear() {
    pristineRef.current = false;
    onChange('');
  }

  return (
    <div
      data-slot="pos-virtual-keypad"
      className={cn('grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/40 p-2', className)}
    >
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          className="inline-flex min-h-14 items-center justify-center rounded-md border border-border bg-card font-mono text-lg font-semibold text-foreground shadow-xs hover:bg-muted active:scale-[0.98]"
        >
          {key}
        </button>
      ))}
      <button
        type="button"
        aria-label="Borrar"
        onClick={() => {
          pristineRef.current = false;
          onChange(value.length > 1 ? value.slice(0, -1) : '');
        }}
        className="inline-flex min-h-14 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-xs hover:bg-muted"
      >
        <Delete className="size-5" />
      </button>
      <button
        type="button"
        aria-label="Limpiar"
        onClick={handleClear}
        className={cn(
          'inline-flex min-h-14 items-center justify-center rounded-md border border-border bg-card font-mono text-sm font-semibold text-muted-foreground shadow-xs hover:bg-muted',
          onSubmit ? 'col-span-1' : 'col-span-3',
        )}
      >
        C
      </button>
      {onSubmit ? (
        <button
          type="button"
          onClick={onSubmit}
          className="col-span-2 inline-flex min-h-14 items-center justify-center gap-1.5 rounded-md bg-checkout px-3 text-sm font-semibold text-checkout-foreground shadow-xs hover:opacity-90"
        >
          <Check className="size-4" />
          <span>Aplicar</span>
        </button>
      ) : null}
    </div>
  );
}
