import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Clock, KeyRound, Lock, ScanBarcode, Search, Tag, X } from 'lucide-react';
import { PageHeader, PosVirtualKeypad, StatusBadge } from '@shac/ui';
import { useAuthSession } from '../lib/authSession';
import { useMarketProfile } from '../lib/marketProfile';
import { useGlobalBarcodeHid } from '../lib/usePosScanner';
import { formatMinorUnits, readApiError, type Phase2ViewProps } from './phase2-format';

/** Locked 10-second auto-closing SmartCheck dual-currency price verifier kiosk. */
export function SmartCheckKioskView({ vocabulary, rpc }: Phase2ViewProps) {
  const profile = useMarketProfile();
  const session = useAuthSession();
  const secondaryCurrency = (profile as { currency?: { operatingCurrencies?: string[] } }).currency?.operatingCurrencies?.[1] ?? 'VES';
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitPin, setExitPin] = useState('');
  const [exitError, setExitError] = useState<string | null>(null);

  const checkMutation = useMutation({
    mutationFn: async (lookupCode: string) => {
      const res = await rpc.api.pos.kiosk.smartcheck.$get({
        query: { code: lookupCode, secondaryCurrency },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => {
      setSecondsLeft(data.autoCloseSeconds);
    },
  });

  const exitPinMutation = useMutation({
    mutationFn: async (pin: string) => {
      const res = await rpc.api.auth.pin.$post({
        json: { pin, branchId: session?.actor.orgId ?? 'org_1', mode: 'cashier' },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      setExitOpen(false);
      setExitPin('');
      setExitError(null);
      window.location.assign('/pos');
    },
    onError: (err: Error) => {
      setExitError(err.message);
      setExitPin('');
    },
  });

  useGlobalBarcodeHid((scanned) => {
    const trimmed = scanned.trim();
    if (!trimmed) return;
    setCode(trimmed);
    checkMutation.mutate(trimmed);
  }, !exitOpen);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          checkMutation.reset();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft, checkMutation]);

  function handleCheck(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    checkMutation.mutate(trimmed);
  }

  const found = checkMutation.data;

  return (
    <section className="mx-auto max-w-3xl space-y-6 py-4" data-slot="smartcheck-kiosk-view">
      <PageHeader
        title={`SmartCheck · Verificador de Precios`}
        description={`Escanea cualquier código de barras o SKU en ${vocabulary.branchSingular}.`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge
              label={secondsLeft > 0 ? `Auto-cierre en ${secondsLeft}s` : 'Kiosco Activo'}
              tone={secondsLeft > 0 ? 'warning' : 'info'}
              icon={<Clock className="size-3" />}
            />
            <button
              type="button"
              onClick={() => setExitOpen(true)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
            >
              <Lock className="size-3.5 text-muted-foreground" />
              <span>Salir Kiosco (PIN)</span>
            </button>
          </div>
        }
      />

      <form onSubmit={handleCheck} className="flex gap-2.5 rounded-xl border border-border bg-card p-4 shadow-xs">
        <div className="relative flex-1">
          <ScanBarcode className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Escanea código de barras o escribe SKU..."
            aria-label="Código de barras o SKU"
            className="min-h-14 w-full rounded-lg border border-input bg-background pl-11 pr-4 font-mono text-lg text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="submit"
          disabled={checkMutation.isPending}
          className="inline-flex min-h-14 items-center gap-2 rounded-lg bg-primary px-6 text-base font-semibold text-primary-foreground shadow-xs hover:bg-primary-hover"
        >
          <Search className="size-4" />
          <span>{checkMutation.isPending ? 'Buscando...' : 'Consultar'}</span>
        </button>
      </form>

      {checkMutation.isError ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-5 text-center text-sm font-medium text-destructive">
          {(checkMutation.error as Error).message}
        </div>
      ) : null}

      {found ? (
        <div className="space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <div className="flex items-center justify-center gap-2">
            <Tag className="size-4 text-primary" />
            <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{found.sku}</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">{found.name}</h2>
          <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-xs font-medium text-muted-foreground">Precio Base ({found.primaryCurrency})</p>
              <p className="mt-1 font-mono text-4xl font-bold tracking-tight tabular-nums">
                {formatMinorUnits(found.unitPriceInclTaxMinor, found.primaryCurrency)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-xs font-medium text-muted-foreground">Equivalente ({found.secondaryCurrency ?? secondaryCurrency})</p>
              <p className="mt-1 font-mono text-4xl font-bold tracking-tight tabular-nums">
                {found.secondaryUnitPriceInclTaxMinor != null
                  ? formatMinorUnits(found.secondaryUnitPriceInclTaxMinor, found.secondaryCurrency ?? secondaryCurrency)
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {exitOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Salir de Kiosco" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-xs rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                <h3 className="text-sm font-semibold">PIN de Staff para Salir</h3>
              </div>
              <button type="button" onClick={() => setExitOpen(false)} aria-label="Cerrar" className="rounded p-1 text-muted-foreground hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>
            {exitError ? (
              <div role="alert" className="mb-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                {exitError}
              </div>
            ) : null}
            <div className="mb-3 rounded-md border border-border bg-muted/40 py-2 text-center font-mono text-lg tracking-[0.4em]">
              {exitPin.replace(/./g, '•') || '••••'}
            </div>
            <PosVirtualKeypad
              value={exitPin}
              onChange={(v) => setExitPin(v.replace(/\D/g, '').slice(0, 6))}
              onSubmit={() => {
                if (exitPin.length < 4 || exitPinMutation.isPending) return;
                exitPinMutation.mutate(exitPin);
              }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
