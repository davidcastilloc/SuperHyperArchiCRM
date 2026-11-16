import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { INPUT_CLS, type Phase2ViewProps } from './phase2-format';

/** Physical IoT console: PIN/QR passes, LPR gate scan, R2 clips, and tamper alerts. */
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      setFeedback(`Pase emitido ${data.id} (${data.status}) · Hash: ${data.pinOrQrHash.slice(0, 12)}...`);
    },
    onError: (err) => setFeedback(err.message),
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.physical.passes.validate.$post({
        json: {
          deviceId: deviceId.trim(),
          pinOrQrSecret: pinSecret.trim(),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      setFeedback(`Acceso concedido (${data.targetKind}) · Dispositivo: ${data.unlockedDeviceId ?? data.unlockedLockerId}`);
    },
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      setFeedback(`LPR ${data.licensePlate}: ${data.decision} (${data.latencyMs} ms) · ${data.doormanNotification.message}`);
    },
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      setFeedback(`Clip R2 sellado ${data.id} · SHA-256: ${data.sha256Hash.slice(0, 16)}...`);
    },
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: (data) => {
      setFeedback(`Alerta anti-sabotaje ${data.id}: ${data.severity} (${data.status})`);
    },
    onError: (err) => setFeedback(err.message),
  });

  function handleIssue(e: FormEvent) {
    e.preventDefault();
    if (!issueMutation.isPending) issueMutation.mutate();
  }

  return (
    <section className="space-y-4 p-4" data-slot="physical-view">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">IoT Físico · Cerraduras, Lockers QR, LPR & R2 Clips</h1>
        <p className="text-sm text-muted-foreground">
          Emisión y validación constant-time de pases PIN/QR, evaluación LPR de barreras, sellado SHA-256 en R2 y alertas anti-sabotaje.
        </p>
      </div>

      {feedback && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          {feedback}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={handleIssue} className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">Pases PIN / QR & Cerraduras</h2>
          <input className={INPUT_CLS} value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="Titular del pase" />
          <input className={INPUT_CLS} value={pinSecret} onChange={(e) => setPinSecret(e.target.value)} placeholder="PIN o secreto QR" />
          <input className={INPUT_CLS} value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="ID dispositivo / cerradura" />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={issueMutation.isPending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
              {issueMutation.isPending ? 'Emitiendo...' : 'Emitir Pase'}
            </button>
            <button type="button" disabled={validateMutation.isPending} onClick={() => validateMutation.mutate()} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium">
              {validateMutation.isPending ? 'Validando...' : 'Validar PIN (Constant-Time)'}
            </button>
          </div>
        </form>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">Barrera LPR & Notificación Portería</h2>
          <input className={INPUT_CLS} value={gateId} onChange={(e) => setGateId(e.target.value)} placeholder="ID / Código de barrera LPR" />
          <input className={INPUT_CLS} value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} placeholder="Placa vehicular" />
          <button type="button" disabled={lprMutation.isPending} onClick={() => lprMutation.mutate()} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            {lprMutation.isPending ? 'Escaneando...' : 'Evaluar Lectura LPR'}
          </button>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">Evidencia Video R2 (SHA-256)</h2>
          <input className={INPUT_CLS} value={r2Key} onChange={(e) => setR2Key(e.target.value)} placeholder="Clave R2 del clip" />
          <input className={INPUT_CLS} value={integrityPayload} onChange={(e) => setIntegrityPayload(e.target.value)} placeholder="Payload de integridad" />
          <button type="button" disabled={clipMutation.isPending} onClick={() => clipMutation.mutate()} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
            {clipMutation.isPending ? 'Sellando...' : 'Registrar Clip SHA-256'}
          </button>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">Alerta Anti-Sabotaje (CRITICAL)</h2>
          <input className={INPUT_CLS} value={tamperDesc} onChange={(e) => setTamperDesc(e.target.value)} placeholder="Descripción del evento tamper" />
          <button type="button" disabled={tamperMutation.isPending} onClick={() => tamperMutation.mutate()} className="rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-medium text-destructive">
            {tamperMutation.isPending ? 'Reportando...' : 'Reportar Tamper CRITICAL'}
          </button>
        </div>
      </div>
    </section>
  );
}
