import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BatteryCharging, Camera, Car, Lock, LockOpen, Plus, QrCode, Radio, ShieldAlert, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AiCopilotBanner, DataTable, EmptyState, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { HeliosPassAndLprModal } from './HeliosPassAndLprModal';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

type HeliosTab = 'garita' | 'videowall' | 'lpr' | 'lockers' | 'lan';

/** 56px Touch-First Helios Physical Security Console: Pulso 5s, Lockdown, QR/PIN & LPR. */
export function HeliosSecurityView({ rpc, vocabulary }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<HeliosTab>('garita');
  const [plateInput, setPlateInput] = useState('');
  const [holderInput, setHolderInput] = useState('');
  const [lprScanPlate, setLprScanPlate] = useState('');
  const [pulseCountdowns, setPulseCountdowns] = useState<Record<string, number>>({});
  const [issuedPass, setIssuedPass] = useState<{ visitorName: string; secretPin: string } | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [validateModalOpen, setValidateModalOpen] = useState(false);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['physical', 'overview'],
    queryFn: async () => {
      const res = await rpc.api.physical.overview.$get();
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
  });

  const deviceMutation = useMutation({
    mutationFn: async (vars: { code: string; name: string; lockState: 'LOCKED' | 'UNLOCKED' }) => {
      const res = await rpc.api.physical.devices['upsert-or-toggle'].$post({
        json: { deviceCode: vars.code, name: vars.name, deviceKind: 'SMART_DOOR_LOCK', lockState: vars.lockState },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['physical', 'overview'] });
      setStatusMsg(`Dispositivo ${d.deviceCode}: ${d.lockState}`);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const lockdownMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.physical.devices.lockdown.$post({}, { init: { body: '{}', headers: { 'content-type': 'application/json' } } });
      if (!res.ok) throw await readApiError(res);
      return (await res.json()) as { lockedCount: number };
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      setPulseCountdowns({});
      void queryClient.invalidateQueries({ queryKey: ['physical', 'overview'] });
      setStatusMsg(`LOCKDOWN PERIMETRAL ACTIVO: ${d.lockedCount} puerta(s) bloqueadas.`);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const passMutation = useMutation({
    mutationFn: async () => {
      const now = Math.floor(Date.now() / 1000);
      const secretPin = crypto.randomUUID().slice(0, 8).toUpperCase();
      const visitorName = holderInput.trim() || 'Visitante Garita';
      const res = await rpc.api.physical.passes.issue.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          pinOrQrSecret: secretPin,
          passKind: 'VISITOR_TEMP',
          holderName: visitorName,
          licensePlate: plateInput.trim().toUpperCase() || undefined,
          validFrom: now,
          validUntil: now + 86400,
        },
      });
      if (!res.ok) throw await readApiError(res);
      await res.json();
      return { visitorName, secretPin };
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      void queryClient.invalidateQueries({ queryKey: ['physical', 'overview'] });
      setHolderInput('');
      setPlateInput('');
      setIssuedPass(d);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const lprMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.physical.lpr.scan.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          gateId: 'GATE-MAIN-01',
          licensePlate: lprScanPlate.trim().toUpperCase(),
          confidenceBps: 9850,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      setErrorMsg(null);
      setLprScanPlate('');
      void queryClient.invalidateQueries({ queryKey: ['physical', 'overview'] });
      setStatusMsg(`LPR ${d.licensePlate}: ${d.decision}`);
    },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await rpc.api.automation['ai-chat'].$post({ json: { prompt } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => { setErrorMsg(null); setAiReply(d.reply); },
    onError: (err: Error) => setErrorMsg(err.message),
  });

  function triggerPulse5s(dev: { device_code: string; name: string }) {
    deviceMutation.mutate({ code: dev.device_code, name: dev.name, lockState: 'UNLOCKED' });
    setPulseCountdowns((prev) => ({ ...prev, [dev.device_code]: 5 }));
  }

  useEffect(() => {
    const activeCodes = Object.keys(pulseCountdowns).filter((k) => (pulseCountdowns[k] ?? 0) > 0);
    if (activeCodes.length === 0) return undefined;
    const timer = window.setInterval(() => {
      setPulseCountdowns((prev) => {
        const next: Record<string, number> = {};
        for (const [code, sec] of Object.entries(prev)) {
          if (sec > 1) {
            next[code] = sec - 1;
          } else if (sec === 1) {
            deviceMutation.mutate({ code, name: code, lockState: 'LOCKED' });
          }
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pulseCountdowns]);

  const devices = (overviewQuery.data?.devices ?? []) as Array<{ id: string; device_code: string; name: string; device_kind: string; battery_pct: number | null; lock_state: string; watchdog_status: string }>;
  const passes = (overviewQuery.data?.passes ?? []) as Array<{ id: string; pass_kind: string; holder_name: string; license_plate: string | null; status: string }>;
  const lprEvents = (overviewQuery.data?.lprEvents ?? []) as Array<{ id: string; gate_id: string; license_plate: string; confidence_bps: number; decision: string }>;
  const lockers = (overviewQuery.data?.lockers ?? []) as Array<{ id: string; bank_code: string; compartment_code: string; door_state: string; occupancy_status: string }>;
  const clips = (overviewQuery.data?.clips ?? []) as Array<{ id: string; camera_device_id: string; clip_kind: string; sha256_hash: string; duration_sec: number; status: string }>;
  const tamperAlerts = (overviewQuery.data?.tamperAlerts ?? []) as Array<{ id: string; device_id: string; alert_kind: string; severity: string; description: string }>;

  return (
    <section className="space-y-4" data-slot="helios-security-view">
      <PageHeader
        title="Helios IoT · Garita, Video Wall & LPR"
        description={`Consola táctil de garita en ${vocabulary.branchSingular}, Pulso 5s, Lockdown y LPR.`}
        onRefresh={() => void overviewQuery.refetch()}
        refreshing={overviewQuery.isFetching}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setValidateModalOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted">
              <QrCode className="size-3.5" /><span>Validar QR/PIN</span>
            </button>
            <button type="button" onClick={() => setDeviceModalOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted">
              <Plus className="size-3.5" /><span>Dispositivo</span>
            </button>
            <button type="button" disabled={lockdownMutation.isPending} onClick={() => lockdownMutation.mutate()} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-destructive px-3.5 text-xs font-semibold text-destructive-foreground shadow-xs">
              <Lock className="size-3.5" /><span>Lockdown Perimetral</span>
            </button>
          </div>
        }
      />

      <AiCopilotBanner
        title="Centinela Helios IA"
        summary="Correlaciona alertas de tamper, accesos LPR denegados y salud de batería de cerraduras."
        prompts={['Resumir alertas de tamper y accesos LPR', 'Verificar estado de dispositivos IoT']}
        onRunPrompt={(p) => aiMutation.mutate(p)}
        reply={aiReply}
        onClearReply={() => setAiReply(null)}
        loading={aiMutation.isPending}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard title="Dispositivos / Puertas" value={devices.length} />
        <KpiCard title="Pases Activos" value={passes.length} />
        <KpiCard title="Lecturas LPR" value={lprEvents.length} />
        <KpiCard title="Alertas Tamper" value={tamperAlerts.length} />
      </div>

      {errorMsg ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{errorMsg}</div> : null}
      {statusMsg ? <p className="rounded-md border border-status-info-border bg-status-info-bg px-3 py-2 text-xs font-medium text-status-info-text">{statusMsg}</p> : null}

      <SegmentedTabs
        activeId={tab}
        onSelect={(id) => setTab(id as HeliosTab)}
        tabs={[
          { id: 'garita', label: 'Consola Garita', count: devices.length, icon: <Lock className="size-3.5" /> },
          { id: 'videowall', label: 'Video Wall', count: clips.length, icon: <Camera className="size-3.5" /> },
          { id: 'lpr', label: 'Placas LPR', count: lprEvents.length, icon: <Car className="size-3.5" /> },
          { id: 'lockers', label: 'Smart Lockers', count: lockers.length, icon: <QrCode className="size-3.5" /> },
          { id: 'lan', label: 'Red LAN & Tamper', count: tamperAlerts.length, icon: <Radio className="size-3.5" /> },
        ]}
      />

      {tab === 'garita' ? (
        <div className="space-y-4">
          <form className="grid grid-cols-1 items-end gap-2.5 rounded-xl border border-border bg-card p-4 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); passMutation.mutate(); }}>
            <label className="space-y-1 text-xs sm:col-span-2"><span className="font-medium text-muted-foreground">Visitante</span><input placeholder="Nombre completo" value={holderInput} onChange={(e) => setHolderInput(e.target.value)} className={`${INPUT_CLS} h-11 w-full`} required /></label>
            <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Placa (Opcional)</span><input placeholder="ABC123" value={plateInput} onChange={(e) => setPlateInput(e.target.value)} className={`${INPUT_CLS} h-11 w-full font-mono uppercase`} /></label>
            <button type="submit" disabled={passMutation.isPending} className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground">Emitir Pase QR / PIN</button>
          </form>
          {devices.length === 0 ? (
            <EmptyState title="Sin cerraduras o puertas" description="Registra un dispositivo IoT para controlarlo desde Garita." actionLabel="Registrar Dispositivo" onAction={() => setDeviceModalOpen(true)} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {devices.map((dev) => {
                const unlocked = dev.lock_state === 'UNLOCKED';
                const secs = pulseCountdowns[dev.device_code] ?? 0;
                return (
                  <div key={dev.id} className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-xs">
                    <div className="flex items-start justify-between">
                      <div><p className="font-mono text-xs text-muted-foreground">{dev.device_code}</p><p className="text-sm font-semibold">{dev.name}</p></div>
                      <StatusBadge label={dev.lock_state} tone={unlocked ? 'warning' : 'success'} appearance="dot" />
                    </div>
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground"><BatteryCharging className="size-3.5 text-emerald-500" />{dev.battery_pct ?? 100}%</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => triggerPulse5s(dev)} className="inline-flex min-h-14 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground">
                        <Timer className="size-4" /><span>{secs > 0 ? `Pulso (${secs}s)` : 'Pulso 5s'}</span>
                      </button>
                      <button type="button" onClick={() => deviceMutation.mutate({ code: dev.device_code, name: dev.name, lockState: unlocked ? 'LOCKED' : 'UNLOCKED' })} className="inline-flex min-h-14 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-muted">
                        {unlocked ? <Lock className="size-4" /> : <LockOpen className="size-4 text-amber-500" />}<span>{unlocked ? 'Bloquear' : 'Abrir'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DataTable columns={[{ id: 'holder', header: 'Titular Pase', cell: (p) => <span className="font-medium">{p.holder_name}</span> }, { id: 'kind', header: 'Tipo', cell: (p) => <StatusBadge label={p.pass_kind} tone="info" /> }, { id: 'plate', header: 'Placa', cell: (p) => <span className="font-mono text-xs">{p.license_plate ?? '—'}</span> }, { id: 'st', header: 'Estado', cell: (p) => <StatusBadge label={p.status} tone="success" appearance="dot" /> }]} data={passes} getRowId={(p) => p.id} emptyTitle="Sin pases emitidos" />
        </div>
      ) : null}

      {tab === 'videowall' ? (clips.length === 0 ? <EmptyState title="Video Wall en espera" description="Los clips sellados SHA-256 aparecerán aquí." /> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{clips.map((c) => <div key={c.id} className="rounded-xl border border-border bg-card p-4 shadow-xs"><div className="flex items-center justify-between"><span className="font-mono text-xs font-semibold">{c.camera_device_id} · {c.clip_kind}</span><StatusBadge label={`${c.duration_sec}s · ${c.status}`} tone="info" /></div><p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">SHA-256: {c.sha256_hash}</p></div>)}</div>) : null}

      {tab === 'lpr' ? (
        <div className="space-y-4">
          <form className="flex flex-wrap items-end gap-2.5 rounded-xl border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); if (lprScanPlate.trim()) lprMutation.mutate(); }}>
            <label className="min-w-48 flex-1 space-y-1 text-xs"><span className="font-medium text-muted-foreground">Verificar Placa Manualmente</span><input placeholder="Ej. AB123CD" value={lprScanPlate} onChange={(e) => setLprScanPlate(e.target.value)} className={`${INPUT_CLS} h-11 w-full font-mono uppercase`} required /></label>
            <button type="submit" disabled={lprMutation.isPending} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground">Escanear LPR</button>
          </form>
          <DataTable columns={[{ id: 'plate', header: 'Placa', cell: (r) => <span className="font-mono font-semibold">{r.license_plate}</span> }, { id: 'gate', header: 'Portón', cell: (r) => <span className="font-mono text-xs">{r.gate_id}</span> }, { id: 'conf', header: 'Confianza', cell: (r) => <span className="font-mono tabular-nums">{(r.confidence_bps / 100).toFixed(1)}%</span> }, { id: 'dec', header: 'Decisión', cell: (r) => <StatusBadge label={r.decision} tone={r.decision === 'ALLOWED' ? 'success' : 'error'} /> }]} data={lprEvents} getRowId={(r) => r.id} emptyTitle="Sin lecturas LPR registradas" />
        </div>
      ) : null}

      {tab === 'lockers' ? <DataTable columns={[{ id: 'bank', header: 'Banco', cell: (r) => <span className="font-mono text-xs">{r.bank_code}-{r.compartment_code}</span> }, { id: 'door', header: 'Puerta', cell: (r) => <StatusBadge label={r.door_state} tone="info" /> }, { id: 'occ', header: 'Ocupación', cell: (r) => <StatusBadge label={r.occupancy_status} tone={r.occupancy_status === 'AVAILABLE' ? 'success' : 'warning'} /> }]} data={lockers} getRowId={(r) => r.id} emptyTitle="Sin compartimentos Smart Locker" /> : null}
      {tab === 'lan' ? <DataTable columns={[{ id: 'dev', header: 'Dispositivo', cell: (r) => <span className="font-mono text-xs">{r.device_id}</span> }, { id: 'kind', header: 'Alerta', cell: (r) => <span className="inline-flex items-center gap-1"><ShieldAlert className="size-3.5 text-destructive" />{r.alert_kind}</span> }, { id: 'desc', header: 'Detalle', cell: (r) => r.description }, { id: 'sev', header: 'Severidad', cell: (r) => <StatusBadge label={r.severity} tone="error" /> }]} data={tamperAlerts} getRowId={(r) => r.id} emptyTitle="Red LAN saludable · 0 alertas de tamper" /> : null}

      <HeliosPassAndLprModal rpc={rpc} branchName={vocabulary.branchSingular} issuedPass={issuedPass} onCloseIssuedPass={() => setIssuedPass(null)} deviceModalOpen={deviceModalOpen} onCloseDeviceModal={() => setDeviceModalOpen(false)} validateModalOpen={validateModalOpen} onCloseValidateModal={() => setValidateModalOpen(false)} onSuccess={(m) => setStatusMsg(m)} />
    </section>
  );
}
