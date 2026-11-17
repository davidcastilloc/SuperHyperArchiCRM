import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, QrCode, ShieldCheck, Wrench, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { BarcodeSvg } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

export function buildWhatsAppPassUrl(visitorName: string, secretPin: string, branchName: string): string {
  const msg = `Hola ${visitorName}, tu pase de acceso para ${branchName} está listo.\nPIN / QR: ${secretPin}`;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

interface HeliosPassAndLprModalProps {
  rpc: Phase2ViewProps['rpc'];
  branchName: string;
  issuedPass: { visitorName: string; secretPin: string } | null;
  onCloseIssuedPass: () => void;
  deviceModalOpen: boolean;
  onCloseDeviceModal: () => void;
  validateModalOpen: boolean;
  onCloseValidateModal: () => void;
  onSuccess: (msg: string) => void;
}

/** Secondary Modals for Helios Gatehouse: QR/PIN WhatsApp Share, Device Registration & Pass Validator. */
export function HeliosPassAndLprModal({
  rpc,
  branchName,
  issuedPass,
  onCloseIssuedPass,
  deviceModalOpen,
  onCloseDeviceModal,
  validateModalOpen,
  onCloseValidateModal,
  onSuccess,
}: HeliosPassAndLprModalProps) {
  const queryClient = useQueryClient();
  const [deviceCode, setDeviceCode] = useState('LOCK-GARITA-01');
  const [deviceName, setDeviceName] = useState('Portón Principal');
  const [deviceKind, setDeviceKind] = useState<'SMART_DOOR_LOCK' | 'IP_CAMERA' | 'LPR_GATE'>('SMART_DOOR_LOCK');
  const [pinToCheck, setPinToCheck] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const deviceMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.physical.devices['upsert-or-toggle'].$post({
        json: { deviceCode: deviceCode.trim(), name: deviceName.trim(), deviceKind, lockState: 'LOCKED', batteryPct: 100 },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['physical', 'overview'] });
      onSuccess(`Dispositivo ${d.deviceCode} registrado en Garita.`);
      onCloseDeviceModal();
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.physical.passes.validate.$post({
        json: { pinOrQrSecret: pinToCheck.trim().toUpperCase() },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      setPinToCheck('');
      onSuccess(`Pase ${d.valid ? 'AUTORIZADO' : 'DENEGADO'} (${d.targetKind})`);
      onCloseValidateModal();
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  if (!issuedPass && !deviceModalOpen && !validateModalOpen) return null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
          <div className="flex items-center gap-2">
            {issuedPass ? <QrCode className="size-4 text-primary" /> : deviceModalOpen ? <Wrench className="size-4 text-primary" /> : <ShieldCheck className="size-4 text-primary" />}
            <h3 className="text-sm font-semibold">
              {issuedPass ? 'Pase de Acceso Emitido' : deviceModalOpen ? 'Registrar Dispositivo IoT' : 'Validar Pase QR / PIN'}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => { onCloseIssuedPass(); onCloseDeviceModal(); onCloseValidateModal(); setErrorMsg(null); }}
            aria-label="Cerrar"
            className="rounded p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        {errorMsg ? <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}

        {issuedPass ? (
          <div className="space-y-4 text-center">
            <p className="text-xs text-muted-foreground">Visitante: <strong>{issuedPass.visitorName}</strong></p>
            <p className="font-mono text-3xl font-bold tracking-widest text-primary">{issuedPass.secretPin}</p>
            <div className="flex justify-center"><BarcodeSvg value={issuedPass.secretPin} height={48} /></div>
            <a
              href={buildWhatsAppPassUrl(issuedPass.visitorName, issuedPass.secretPin, branchName)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              <MessageCircle className="size-4" /><span>Compartir por WhatsApp</span>
            </a>
          </div>
        ) : deviceModalOpen ? (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); deviceMutation.mutate(); }} className="space-y-3">
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Código Dispositivo</span><input value={deviceCode} onChange={(e) => setDeviceCode(e.target.value)} className={`${INPUT_CLS} w-full font-mono`} required /></label>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Nombre Puerta / Barrera</span><input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className={`${INPUT_CLS} w-full`} required /></label>
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Tipo IoT</span>
              <select value={deviceKind} onChange={(e) => setDeviceKind(e.target.value as typeof deviceKind)} className={`${INPUT_CLS} w-full`}>
                <option value="SMART_DOOR_LOCK">Cerradura / Barrera</option>
                <option value="LPR_GATE">Cámara LPR</option>
                <option value="IP_CAMERA">Cámara IP</option>
              </select>
            </label>
            <button type="submit" disabled={deviceMutation.isPending} className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">Guardar Dispositivo</button>
          </form>
        ) : (
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); validateMutation.mutate(); }} className="space-y-3">
            <label className="block space-y-1 text-xs"><span className="font-medium text-muted-foreground">Código QR o PIN</span><input autoFocus value={pinToCheck} onChange={(e) => setPinToCheck(e.target.value)} placeholder="A9F3K2P1" className={`${INPUT_CLS} h-12 w-full font-mono text-base uppercase`} required /></label>
            <button type="submit" disabled={validateMutation.isPending} className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">Verificar Acceso</button>
          </form>
        )}
      </div>
    </div>
  );
}
