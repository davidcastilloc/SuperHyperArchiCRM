import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Camera, CarFront, KeySquare, ShieldAlert } from 'lucide-react';
import { PageHeader, StatusBadge } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

/** Open Mercato DS v3 Physical IoT console: PIN/QR passes, LPR gate scan, R2 clips, and tamper alerts. */
export function PhysicalView({ rpc }: Phase2ViewProps) {
  const [holderName, setHolderName] = useState('Visitante Demo');
  const [licensePlate, setLicensePlate] = useState('ABC123');
  const [pinSecret, setPinSecret] = useState('847291');
  const [deviceId, setDeviceId] = useState('dev_lock_1');
  const [gateId, setGateId] = useState('gate_main_1');
  const [r2Key, setR2Key] = useState('clips/cam-1/2026-11-16.mp4');
  const [integrityPayload, setIntegrityPayload] = useState('clip-frame-sha256-seed');
  const [tamperDesc, setTamperDesc] = useState('Carcasa abierta en cerradura principal');
  const [feedback, setFeedback] = useState<string | null>(null);

  const issueMutation = useMutation({
    mutationFn: async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const res = await rpc.api.physical.passes.issue.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          passKind: 'VISITOR_TEMP',
          holderName: holderName.trim(),
          licensePlate: licensePlate.trim() || null,
          pinOrQrSecret: pinSecret.trim(),
          allowedDeviceIds: [deviceId.trim()],
          validFrom: nowSec - 60,
          validUntil: nowSec + 86_400,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => setFeedback(`Pase emitido ${data.id} (${data.status}) · Hash: ${data.pinOrQrHash.slice(0, 12)}...`),
    onError: (err) => setFeedback(err.message),
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.physical.passes.validate.$post({
        json: { deviceId: deviceId.trim(), pinOrQrSecret: pinSecret.trim() },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => setFeedback(`Acceso concedido (${data.targetKind}) · Dispositivo: ${data.unlockedDeviceId ?? data.unlockedLockerId}`),
    onError: (err) => setFeedback(err.message),
  });

  const lprMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.physical.lpr.scan.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          gateId: gateId.trim(),
          licensePlate: licensePlate.trim(),
          confidenceBps: 9850,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => setFeedback(`LPR ${data.licensePlate}: ${data.decision} (${data.latencyMs} ms) · ${data.doormanNotification.message}`),
    onError: (err) => setFeedback(err.message),
  });

  const clipMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.physical.clips.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          cameraDeviceId: deviceId.trim(),
          clipKind: 'MOTION_EVENT',
          r2Key: r2Key.trim(),
          integrityPayload: integrityPayload.trim(),
          durationSec: 15,
          sizeBytes: 1_048_576,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => setFeedback(`Clip R2 sellado ${data.id} · SHA-256: ${data.sha256Hash.slice(0, 16)}...`),
    onError: (err) => setFeedback(err.message),
  });

  const tamperMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.physical.tamper.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          deviceId: deviceId.trim(),
          alertKind: 'ENCLOSURE_OPEN',
          severity: 'CRITICAL',
          description: tamperDesc.trim(),
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (data) => setFeedback(`Alerta anti-sabotaje ${data.id}: ${data.severity} (${data.status})`),
    onError: (err) => setFeedback(err.message),
  });

  function handleIssue(e: FormEvent) {
    e.preventDefault();
    if (!issueMutation.isPending) issueMutation.mutate();
  }

  return (
    <section className="space-y-5" data-slot="physical-view">
      <PageHeader
        title="IoT Físico · Accesos QR, Barreras LPR & Evidencia R2"
        description="Validación constant-time de pases temporales, lectura de placas vehiculares y clips sellados con SHA-256."
        actions={<StatusBadge label="Constant-Time Crypto" tone="info" />}
      />

      {feedback ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{feedback}</p> : null}

      <div className="grid gap-5 md:grid-cols-2">
        <form onSubmit={handleIssue} className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <KeySquare className="size-4 text-muted-foreground" />
            <span>Pases PIN / QR & Cerraduras</span>
          </h2>
          <input className={`${INPUT_CLS} w-full`} value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="Titular del pase" />
          <div className="grid grid-cols-2 gap-2.5">
            <input className={`${INPUT_CLS} font-mono text-xs`} value={pinSecret} onChange={(e) => setPinSecret(e.target.value)} placeholder="PIN / Secreto QR" />
            <input className={`${INPUT_CLS} font-mono text-xs`} value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="Dispositivo" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={issueMutation.isPending} className="h-9 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs">
              {issueMutation.isPending ? 'Emitiendo...' : 'Emitir Pase'}
            </button>
            <button type="button" disabled={validateMutation.isPending} onClick={() => validateMutation.mutate()} className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium shadow-xs hover:bg-muted">
              Validar PIN
            </button>
          </div>
        </form>

        <div className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <CarFront className="size-4 text-muted-foreground" />
            <span>Barrera LPR & Notificación Portería</span>
          </h2>
          <input className={`${INPUT_CLS} w-full font-mono text-xs`} value={gateId} onChange={(e) => setGateId(e.target.value)} placeholder="ID de barrera LPR" />
          <input className={`${INPUT_CLS} w-full font-mono text-xs`} value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} placeholder="Placa vehicular" />
          <button type="button" disabled={lprMutation.isPending} onClick={() => lprMutation.mutate()} className="h-9 rounded-md bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-xs">
            Evaluar Lectura LPR
          </button>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <Camera className="size-4 text-muted-foreground" />
            <span>Evidencia Video R2 (SHA-256)</span>
          </h2>
          <input className={`${INPUT_CLS} w-full font-mono text-xs`} value={r2Key} onChange={(e) => setR2Key(e.target.value)} placeholder="Clave R2 del clip" />
          <input className={`${INPUT_CLS} w-full font-mono text-xs`} value={integrityPayload} onChange={(e) => setIntegrityPayload(e.target.value)} placeholder="Payload de integridad" />
          <button type="button" disabled={clipMutation.isPending} onClick={() => clipMutation.mutate()} className="h-9 rounded-md border border-border bg-background px-3.5 text-xs font-medium shadow-xs hover:bg-muted">
            Registrar Clip SHA-256
          </button>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <ShieldAlert className="size-4 text-danger" />
            <span>Alerta Anti-Sabotaje</span>
          </h2>
          <input className={`${INPUT_CLS} w-full`} value={tamperDesc} onChange={(e) => setTamperDesc(e.target.value)} placeholder="Descripción del evento tamper" />
          <button type="button" disabled={tamperMutation.isPending} onClick={() => tamperMutation.mutate()} className="h-9 rounded-md border border-status-error-border bg-status-error-bg px-3.5 text-xs font-medium text-status-error-text shadow-xs">
            Reportar Alerta Crítica
          </button>
        </div>
      </div>
    </section>
  );
}
