import { Download, Printer, Usb, X } from 'lucide-react';
import { useState } from 'react';

export interface EscPosReceiptLine {
  title: string;
  qty: number;
  lineTotalMinor: number;
}

export interface EscPosReceiptInput {
  storeName: string;
  orderNumber: string;
  cashierName: string;
  currencyCode: string;
  lines: readonly EscPosReceiptLine[];
  grandTotalMinor: number;
  kickCashDrawer?: boolean;
}

/** Encodes a standard 80mm ESC/POS thermal receipt payload (with optional RJ11 cash drawer pulse). */
export function encodeEscPosReceipt(input: EscPosReceiptInput): Uint8Array {
  const enc = new TextEncoder();
  const chunks: number[] = [
    0x1b, 0x40, // ESC @ initialize
    0x1b, 0x61, 0x01, // center align
  ];
  const pushText = (txt: string) => {
    chunks.push(...enc.encode(`${txt}\n`));
  };

  pushText(input.storeName.toUpperCase());
  pushText(`ORDEN: ${input.orderNumber}`);
  pushText(`CAJERO: ${input.cashierName}`);
  pushText('--------------------------------');
  chunks.push(0x1b, 0x61, 0x00); // left align

  for (const line of input.lines) {
    const amount = `${input.currencyCode} ${(line.lineTotalMinor / 100).toFixed(2)}`;
    pushText(`${line.qty}x ${line.title.slice(0, 18).padEnd(18, ' ')} ${amount}`);
  }
  pushText('--------------------------------');
  pushText(`TOTAL: ${input.currencyCode} ${(input.grandTotalMinor / 100).toFixed(2)}`);
  pushText('\nGracias por su compra\n');
  chunks.push(0x1d, 0x56, 0x41, 0x10); // GS V A partial cut
  if (input.kickCashDrawer) {
    chunks.push(0x1b, 0x70, 0x00, 0x19, 0xfa); // ESC p pin 2 drawer kick
  }
  return new Uint8Array(chunks);
}

export interface ThermalReceiptModalProps {
  open: boolean;
  onClose: () => void;
  receipt: EscPosReceiptInput | null;
}

/** 80mm ESC/POS thermal receipt preview with WebSerial USB/COM direct print and .bin export. */
export function ThermalReceiptModal({ open, onClose, receipt }: ThermalReceiptModalProps) {
  const [hwStatus, setHwStatus] = useState<string | null>(null);
  if (!open || !receipt) return null;

  async function handleWebSerialPrint() {
    if (!receipt) return;
    const nav = navigator as Navigator & {
      serial?: {
        requestPort(): Promise<{
          open(opts: { baudRate: number }): Promise<void>;
          writable?: WritableStream<Uint8Array>;
          close(): Promise<void>;
        }>;
      };
    };
    if (!nav.serial) {
      setHwStatus('WebSerial no disponible en este navegador; usa Imprimir 80mm o Descargar .bin.');
      return;
    }
    try {
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 9600 });
      const writer = port.writable?.getWriter();
      if (writer) {
        await writer.write(encodeEscPosReceipt({ ...receipt, kickCashDrawer: true }));
        writer.releaseLock();
      }
      await port.close();
      setHwStatus('Ticket ESC/POS enviado por USB/Serial y gaveta abierta.');
    } catch (err) {
      setHwStatus(err instanceof Error ? err.message : 'Puerto serial cancelado');
    }
  }

  function handleDownloadBin() {
    if (!receipt) return;
    const bytes = encodeEscPosReceipt({ ...receipt, kickCashDrawer: true });
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${receipt.orderNumber}.escpos.bin`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Impresión Térmica ESC/POS 80mm"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Ticket Térmico · ESC/POS 80mm</h3>
            <p className="text-[11px] text-muted-foreground">{receipt.orderNumber}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ticket"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="rounded-md border border-dashed border-border bg-muted/40 p-3 font-mono text-xs text-foreground">
          <div className="text-center font-semibold">{receipt.storeName.toUpperCase()}</div>
          <div className="text-center text-[11px] text-muted-foreground">
            Orden {receipt.orderNumber} · Cajero {receipt.cashierName}
          </div>
          <div className="my-2 border-t border-dashed border-border" />
          {receipt.lines.map((line, i) => (
            <div key={`${line.title}-${i}`} className="flex justify-between gap-2">
              <span className="truncate">{line.qty}x {line.title}</span>
              <span>{receipt.currencyCode} {(line.lineTotalMinor / 100).toFixed(2)}</span>
            </div>
          ))}
          <div className="my-2 border-t border-dashed border-border" />
          <div className="flex justify-between font-semibold">
            <span>TOTAL</span>
            <span>{receipt.currencyCode} {(receipt.grandTotalMinor / 100).toFixed(2)}</span>
          </div>
        </div>

        {hwStatus ? (
          <p className="mt-2 text-[11px] text-muted-foreground">{hwStatus}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Printer className="size-3.5" />
            Imprimir
          </button>
          <button
            type="button"
            onClick={() => void handleWebSerialPrint()}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Usb className="size-3.5" />
            USB/Serial
          </button>
          <button
            type="button"
            onClick={handleDownloadBin}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Download className="size-3.5" />
            .bin
          </button>
        </div>
      </div>
    </div>
  );
}
