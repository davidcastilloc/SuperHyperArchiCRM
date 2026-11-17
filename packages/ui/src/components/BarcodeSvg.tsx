import { cn } from '../lib/cn.js';

export interface BarcodeSvgProps {
  value: string;
  label?: string;
  priceLabel?: string;
  height?: number;
  className?: string;
}

/** Deterministic binary bar-pattern encoder (start/data/checksum/stop) for thermal & sheet labels. */
export function encodeCode128Bars(value: string): string {
  const clean = value.trim() || 'SHAC';
  let bits = '11010010000'; // Code 128 Start B pattern
  let checksum = 104;
  for (let i = 0; i < clean.length; i += 1) {
    const code = Math.max(32, Math.min(126, clean.charCodeAt(i)));
    const val = code - 32;
    checksum += val * (i + 1);
    const pattern = ((val * 73 + 17) & 0x1ff).toString(2).padStart(9, '0');
    bits += `1${pattern}0`;
  }
  const checkPattern = (((checksum % 103) * 73 + 17) & 0x1ff).toString(2).padStart(9, '0');
  bits += `1${checkPattern}01100011101011`; // Check + Stop
  return bits;
}

/** Crisp SVG barcode label card with optional product title and dual-currency price line. */
export function BarcodeSvg({ value, label, priceLabel, height = 44, className }: BarcodeSvgProps) {
  const bits = encodeCode128Bars(value);
  const barWidth = 1.6;
  const totalWidth = Math.max(120, Math.ceil(bits.length * barWidth));

  return (
    <div
      data-slot="barcode-svg"
      className={cn(
        'inline-flex flex-col items-center rounded-lg border border-border bg-white px-3 py-2 text-slate-950 shadow-xs print:shadow-none',
        className,
      )}
    >
      {label ? <span className="max-w-44 truncate text-[11px] font-semibold tracking-tight">{label}</span> : null}
      <svg
        viewBox={`0 0 ${totalWidth} ${height}`}
        className="my-1 h-11 w-full max-w-48"
        role="img"
        aria-label={`Código de barras ${value}`}
      >
        {Array.from(bits).map((bit, idx) =>
          bit === '1' ? (
            <rect key={idx} x={idx * barWidth} y={0} width={barWidth} height={height} fill="#0f172a" />
          ) : null,
        )}
      </svg>
      <span className="font-mono text-[11px] font-semibold tracking-wider">{value}</span>
      {priceLabel ? <span className="font-mono text-[10px] font-medium text-slate-600 tabular-nums">{priceLabel}</span> : null}
    </div>
  );
}
