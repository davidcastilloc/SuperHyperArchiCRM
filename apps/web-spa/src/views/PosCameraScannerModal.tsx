import { Camera, ScanBarcode, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { INPUT_CLS } from './phase2-format';

interface PosCameraScannerModalProps {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}

/** Camera barcode scanner modal (BarcodeDetector API with manual SKU fallback). */
export function PosCameraScannerModal({ open, onClose, onDetected }: PosCameraScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || typeof navigator === 'undefined') return;
    let active = true;
    let stream: MediaStream | null = null;
    let rafId = 0;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Cámara no disponible en este navegador; ingresa el código manualmente.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!active || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const Detector = (window as unknown as {
          BarcodeDetector?: new (opts: { formats: string[] }) => {
            detect(src: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>;
          };
        }).BarcodeDetector;

        if (!Detector) {
          setCameraError('BarcodeDetector no soportado aquí; usa lector USB o ingreso manual.');
          return;
        }
        const detector = new Detector({ formats: ['ean_13', 'code_128', 'upc_a', 'qr_code'] });
        const scanLoop = async () => {
          if (!active || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const first = codes[0]?.rawValue?.trim();
            if (first) {
              onDetected(first);
              onClose();
              return;
            }
          } catch {
            // Continue scanning frames
          }
          rafId = requestAnimationFrame(() => void scanLoop());
        };
        rafId = requestAnimationFrame(() => void scanLoop());
      } catch (err) {
        setCameraError(err instanceof Error ? err.message : 'Permiso de cámara denegado');
      }
    }

    void startCamera();
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onDetected, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Escáner de Cámara" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            <Camera className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Escáner de Cámara / Código de Barras</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar escáner" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        <div className="relative overflow-hidden rounded-lg border border-border bg-black/90">
          <video ref={videoRef} muted playsInline className="h-48 w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-emerald-400/80 shadow-[0_0_8px_#34d399]" />
        </div>

        {cameraError ? <p className="mt-2 text-xs text-muted-foreground">{cameraError}</p> : null}

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!manualCode.trim()) return;
            onDetected(manualCode.trim());
            setManualCode('');
            onClose();
          }}
        >
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="O escribe/escanea SKU manual..."
            className={`${INPUT_CLS} flex-1 font-mono`}
          />
          <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90">
            <ScanBarcode className="size-3.5" />
            <span>Agregar</span>
          </button>
        </form>
      </div>
    </div>
  );
}
