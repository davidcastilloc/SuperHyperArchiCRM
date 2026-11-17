import { useMutation } from '@tanstack/react-query';
import { KeyRound, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PosVirtualKeypad } from '@shac/ui';
import { setAuthSession, type AuthSession } from '../lib/authSession';
import { INPUT_CLS, parseMajorToMinor, readApiError, type Phase2ViewProps } from './phase2-format';

interface PosProModalsProps {
  rpc: Phase2ViewProps['rpc'];
  branchId?: string;
  pinOpen: boolean;
  onClosePin: () => void;
  onSwitchCashier: (name: string) => void;
  returnOpen: boolean;
  onCloseReturn: () => void;
  onReturnSuccess: (msg: string) => void;
}

/** POS Cashier PIN Quick-Switch (real /api/auth/pin) & Quick Return modals. */
export function PosProModals({
  rpc,
  branchId = 'org_1',
  pinOpen,
  onClosePin,
  onSwitchCashier,
  returnOpen,
  onCloseReturn,
  onReturnSuccess,
}: PosProModalsProps) {
  const [pinCode, setPinCode] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState('');
  const [reason, setReason] = useState('Devolución directa en caja');
  const [refundMajor, setRefundMajor] = useState('0.00');
  const [returnError, setReturnError] = useState<string | null>(null);

  useEffect(() => {
    if (!pinOpen && !returnOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pinOpen) {
          setPinError(null);
          onClosePin();
        }
        if (returnOpen) {
          setReturnError(null);
          onCloseReturn();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pinOpen, returnOpen, onClosePin, onCloseReturn]);

  const pinMutation = useMutation({
    mutationFn: async (pin: string) => {
      const res = await rpc.api.auth.pin.$post({
        json: { pin, branchId, mode: 'cashier' },
      });
      if (!res.ok) throw await readApiError(res);
      return (await res.json()) as AuthSession;
    },
    onSuccess: (session) => {
      setAuthSession(session);
      onSwitchCashier(session.actor.fullName);
      setPinCode('');
      setPinError(null);
      onClosePin();
    },
    onError: (err: Error) => {
      setPinError(err.message);
      setPinCode('');
    },
  });

  const returnMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.pos['returns-quick'].$post({
        json: {
          orderNumber: orderNumber.trim() || 'POS-DIRECTO',
          reason: reason.trim(),
          refundMinor: parseMajorToMinor(refundMajor),
          currency: 'USD',
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      setReturnError(null);
      onReturnSuccess(`Devolución ${d.returnNumber} registrada.`);
      setOrderNumber('');
      setRefundMajor('0.00');
      onCloseReturn();
    },
    onError: (err: Error) => setReturnError(err.message),
  });

  return (
    <>
      {pinOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Cambio Rápido de Cajero" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-xs rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                <h3 className="text-sm font-semibold">Relevo de Cajero (PIN)</h3>
              </div>
              <button type="button" onClick={onClosePin} aria-label="Cerrar PIN" className="rounded p-1 text-muted-foreground hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>
            {pinError ? (
              <div role="alert" className="mb-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                {pinError}
              </div>
            ) : null}
            <div className="mb-3 rounded-md border border-border bg-muted/40 py-2 text-center font-mono text-lg tracking-[0.4em]">
              {pinCode.replace(/./g, '•') || '••••'}
            </div>
            <PosVirtualKeypad
              value={pinCode}
              onChange={(v) => setPinCode(v.replace(/\D/g, '').slice(0, 6))}
              onSubmit={() => {
                if (pinCode.length < 4 || pinMutation.isPending) return;
                pinMutation.mutate(pinCode);
              }}
            />
          </div>
        </div>
      ) : null}

      {returnOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Devolución Rápida POS" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-2">
                <RotateCcw className="size-4 text-amber-500" />
                <h3 className="text-sm font-semibold">Devolución Rápida desde Caja</h3>
              </div>
              <button type="button" onClick={onCloseReturn} aria-label="Cerrar devolución" className="rounded p-1 text-muted-foreground hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>
            {returnError ? (
              <div role="alert" className="mb-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                {returnError}
              </div>
            ) : null}
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); returnMutation.mutate(); }}>
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">N° de Orden / Ticket</span>
                <input placeholder="POS-0001" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} required />
              </label>
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Motivo</span>
                <input placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} className={`${INPUT_CLS} w-full`} required />
              </label>
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Monto Reembolso (USD)</span>
                <input placeholder="0.00" value={refundMajor} onChange={(e) => setRefundMajor(e.target.value)} className={`${INPUT_CLS} w-full font-mono tabular-nums`} required />
              </label>
              <button type="submit" disabled={returnMutation.isPending} className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                {returnMutation.isPending ? 'Procesando...' : 'Registrar Nota de Crédito'}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
