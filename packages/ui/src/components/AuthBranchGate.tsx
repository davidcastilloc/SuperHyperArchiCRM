import { useState, type FormEvent, type Ref } from 'react';
import type { MarketVocabulary } from '@shac/kernel';
import { cn } from '../lib/cn.js';

export interface BranchOption {
  id: string;
  name: string;
  orgPath: string;
}

export interface AuthBranchGateProps {
  vocabulary: MarketVocabulary;
  branches: BranchOption[];
  selectedBranchId: string;
  onSelectBranch: (branchId: string) => void;
  onCredentialsSubmit?: (credentials: { email: string; password: string; branchId: string }) => void;
  onPinSubmit: (payload: { pin: string; branchId: string; mode: 'cashier' | 'delegation' }) => void;
  pinLength?: 4 | 6;
  density?: 'touch' | 'compact';
  theme?: 'light' | 'dark';
  loading?: boolean;
  error?: string | null;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** Bimodal login, hierarchical branch selector, and 56px touch PIN keypad. */
export function AuthBranchGate({
  vocabulary,
  branches,
  selectedBranchId,
  onSelectBranch,
  onCredentialsSubmit,
  onPinSubmit,
  pinLength = 6,
  density = 'touch',
  theme = 'light',
  loading = false,
  error = null,
  className,
  ref,
}: AuthBranchGateProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<'cashier' | 'delegation'>(
    pinLength === 4 ? 'cashier' : 'delegation',
  );

  const activePinLength = mode === 'cashier' ? 4 : 6;

  function handleDigit(digit: string) {
    if (loading || pin.length >= activePinLength) return;
    setPin((prev) => prev + digit);
  }

  function handleBackspace() {
    if (loading) return;
    setPin((prev) => prev.slice(0, -1));
  }

  function handleClear() {
    if (loading) return;
    setPin('');
  }

  function handlePinConfirm() {
    if (loading || pin.length !== activePinLength || !selectedBranchId) return;
    onPinSubmit({ pin, branchId: selectedBranchId, mode });
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || !email.trim() || !password || !selectedBranchId) return;
    onCredentialsSubmit?.({ email: email.trim(), password, branchId: selectedBranchId });
  }

  return (
    <div
      ref={ref}
      data-slot="auth-branch-gate"
      data-density={density}
      data-theme={theme}
      className={cn(
        'w-full max-w-4xl mx-auto rounded-xl border border-border bg-card text-card-foreground p-6',
        'grid grid-cols-1 md:grid-cols-2 gap-6',
        theme === 'dark' && 'dark',
        className,
      )}
    >
      <section data-slot="branch-credentials-panel" className="flex flex-col gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Acceso Operativo</h2>
          <p className="text-sm text-muted-foreground">
            Selecciona {vocabulary.branchSingular} e inicia sesión o usa tu PIN táctil.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="shac-branch-select" className="text-sm font-medium">
            {vocabulary.branchSingular}
          </label>
          <select
            id="shac-branch-select"
            data-slot="branch-selector"
            value={selectedBranchId}
            disabled={loading || branches.length === 0}
            onChange={(e) => onSelectBranch(e.target.value)}
            className={cn(
              'w-full rounded-md border border-input bg-background px-3 text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              density === 'touch' ? 'min-h-12' : 'h-9',
            )}
          >
            {branches.length === 0 ? (
              <option value="">Sin {vocabulary.branchSingular} disponible</option>
            ) : (
              branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.orgPath})
                </option>
              ))
            )}
          </select>
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="shac-email" className="text-sm font-medium">
              Correo corporativo
            </label>
            <input
              id="shac-email"
              type="email"
              autoComplete="username"
              value={email}
              disabled={loading}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operador@empresa.com"
              className={cn(
                'w-full rounded-md border border-input bg-background px-3 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                density === 'touch' ? 'min-h-12' : 'h-9',
              )}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="shac-password" className="text-sm font-medium">
              Contraseña
            </label>
            <input
              id="shac-password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={loading}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(
                'w-full rounded-md border border-input bg-background px-3 text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                density === 'touch' ? 'min-h-12' : 'h-9',
              )}
            />
          </div>

          <button
            type="submit"
            data-slot="credentials-submit"
            disabled={loading || !email.trim() || !password || !selectedBranchId}
            className={cn(
              'w-full rounded-md bg-primary text-primary-foreground font-medium text-sm transition-opacity',
              'disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              density === 'touch' ? 'min-h-12 text-base' : 'h-9',
            )}
          >
            {loading ? 'Verificando...' : 'Ingresar'}
          </button>
        </form>

        {error ? (
          <div
            data-slot="auth-error"
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {error}
          </div>
        ) : null}
      </section>

      <section data-slot="pin-keypad-panel" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {mode === 'cashier' ? 'PIN Cajero (4 dígitos)' : 'PIN Delegación (6 dígitos)'}
          </span>
          <button
            type="button"
            data-slot="pin-mode-toggle"
            disabled={loading}
            onClick={() => {
              setMode((prev) => (prev === 'delegation' ? 'cashier' : 'delegation'));
              setPin('');
            }}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cambiar a {mode === 'delegation' ? '4 dígitos' : '6 dígitos'}
          </button>
        </div>

        <div
          data-slot="pin-display"
          aria-label={`PIN ingresado: ${pin.length} de ${activePinLength} dígitos`}
          className="grid gap-2 font-mono tabular-nums"
          style={{ gridTemplateColumns: `repeat(${activePinLength}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: activePinLength }, (_, idx) => {
            const filled = idx < pin.length;
            return (
              <div
                key={idx}
                data-slot="pin-slot"
                data-filled={filled ? 'true' : 'false'}
                className={cn(
                  'h-12 rounded-md border flex items-center justify-center text-xl font-bold',
                  filled ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted',
                )}
              >
                {filled ? '•' : ''}
              </div>
            );
          })}
        </div>

        <div data-slot="pin-keypad" className="grid grid-cols-3 gap-2">
          {KEYPAD_DIGITS.map((digit) => (
            <button
              key={digit}
              type="button"
              data-slot="pin-key"
              disabled={loading}
              onClick={() => handleDigit(digit)}
              className={cn(
                'min-h-14 min-w-14 rounded-xl border border-border bg-background text-lg font-mono font-semibold tabular-nums',
                'hover:bg-muted active:scale-[0.98] transition-transform',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            data-slot="pin-key-clear"
            disabled={loading}
            onClick={handleClear}
            className="min-h-14 rounded-xl border border-border bg-muted text-sm font-medium hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Limpiar
          </button>
          <button
            type="button"
            data-slot="pin-key"
            disabled={loading}
            onClick={() => handleDigit('0')}
            className="min-h-14 min-w-14 rounded-xl border border-border bg-background text-lg font-mono font-semibold tabular-nums hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            0
          </button>
          <button
            type="button"
            data-slot="pin-key-backspace"
            disabled={loading}
            onClick={handleBackspace}
            className="min-h-14 rounded-xl border border-border bg-muted text-sm font-medium hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Borrar
          </button>
        </div>

        <button
          type="button"
          data-slot="pin-submit"
          disabled={loading || pin.length !== activePinLength || !selectedBranchId}
          onClick={handlePinConfirm}
          className={cn(
            'min-h-14 w-full rounded-xl bg-checkout text-checkout-foreground text-base font-semibold transition-opacity',
            'disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {loading ? 'Validando PIN...' : 'Confirmar PIN'}
        </button>
      </section>
    </div>
  );
}
