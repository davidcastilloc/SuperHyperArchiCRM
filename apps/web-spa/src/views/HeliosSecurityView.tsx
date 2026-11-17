import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BatteryCharging, Camera, Car, Lock, LockOpen, QrCode, Radio, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { AiCopilotBanner, DataTable, EmptyState, KpiCard, PageHeader, SegmentedTabs, StatusBadge } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

type HeliosTab = 'garita' | 'videowall' | 'lpr' | 'lockers' | 'lan';

/** Helios Physical Security Console: Garita Touch Deck, Door Locks, Video Wall, LPR, Smart Lockers & LAN. */
export function HeliosSecurityView({ rpc }: Phase2ViewProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<HeliosTab>('garita');
  const [deviceCode, setDeviceCode] = useState('LOCK-GARITA-01');
  const [deviceName, setDeviceName] = useState('Portón Principal');
  const [plateInput, setPlateInput] = useState('');
  const [holderInput, setHolderInput] = useState('');
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

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
        json: { deviceCode: vars.code, name: vars.name, deviceKind: 'SMART_DOOR_LOCK', lockState: vars.lockState, batteryPct: 95 },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => {
      void queryClient.invalidateQueries({ queryKey: ['physical', 'overview'] });
      setStatusMsg(`Dispositivo ${d.deviceCode}: ${d.lockState}`);
    },
  });

  const passMutation = useMutation({
    mutationFn: async () => {
      const now = Math.floor(Date.now() / 1000);
      const res = await rpc.api.physical.passes.issue.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          pinOrQrSecret: crypto.randomUUID().slice(0, 8).toUpperCase(),
          passKind: 'VISITOR_TEMP',
          holderName: holderInput.trim() || 'Visitante Garita',
          licensePlate: plateInput.trim().toUpperCase() || undefined,
          validFrom: now,
          validUntil: now + 86400,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['physical', 'overview'] });
      setHolderInput('');
      setPlateInput('');
      setStatusMsg('Pase QR + Placa emitido en Garita.');
    },
  });

  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await rpc.api.automation['ai-chat'].$post({ json: { prompt } });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (d) => setAiReply(d.reply),
  });

  const devices = (overviewQuery.data?.devices ?? []) as Array<{ id: string; device_code: string; name: string; device_kind: string; battery_pct: number | null; lock_state: string; watchdog_status: string }>;
  const lprEvents = (overviewQuery.data?.lprEvents ?? []) as Array<{ id: string; gate_id: string; license_plate: string; confidence_bps: number; decision: string }>;
  const lockers = (overviewQuery.data?.lockers ?? []) as Array<{ id: string; bank_code: string; compartment_code: string; door_state: string; occupancy_status: string }>;
  const clips = (overviewQuery.data?.clips ?? []) as Array<{ id: string; camera_device_id: string; clip_kind: string; sha256_hash: string; duration_sec: number; status: string }>;
  const tamperAlerts = (overviewQuery.data?.tamperAlerts ?? []) as Array<{ id: string; device_id: string; alert_kind: string; severity: string; description: string }>;

  return (
    <section className="space-y-5" data-slot="helios-security-view">
      <PageHeader
        title="Helios IoT · Garita, Video Wall & LPR"
        description="Consola táctil de garita, apertura remota de cerraduras, Video Wall sellado SHA-256, placas LPR y Smart Lockers."
        onRefresh={() => void overviewQuery.refetch()}
        refreshing={overviewQuery.isFetching}
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
        <KpiCard title="Lecturas LPR" value={lprEvents.length} />
        <KpiCard title="Clips Video Wall" value={clips.length} />
        <KpiCard title="Alertas Tamper" value={tamperAlerts.length} />
      </div>

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
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <form className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); deviceMutation.mutate({ code: deviceCode, name: deviceName, lockState: 'LOCKED' }); }}>
              <input placeholder="Código (LOCK-01)" value={deviceCode} onChange={(e) => setDeviceCode(e.target.value)} className={`${INPUT_CLS} w-36 font-mono`} required />
              <input placeholder="Nombre puerta" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} className={`${INPUT_CLS} flex-1`} required />
              <button type="submit" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Registrar Dispositivo</button>
            </form>
            <form className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-4" onSubmit={(e) => { e.preventDefault(); passMutation.mutate(); }}>
              <input placeholder="Visitante" value={holderInput} onChange={(e) => setHolderInput(e.target.value)} className={`${INPUT_CLS} flex-1`} required />
              <input placeholder="Placa (ABC123)" value={plateInput} onChange={(e) => setPlateInput(e.target.value)} className={`${INPUT_CLS} w-32 font-mono`} />
              <button type="submit" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Emitir Pase QR</button>
            </form>
          </div>
          {devices.length === 0 ? (
            <EmptyState title="Sin cerraduras o puertas" description="Registra un dispositivo IoT arriba para controlarlo desde Garita." />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {devices.map((dev) => {
                const unlocked = dev.lock_state === 'UNLOCKED';
                return (
                  <div key={dev.id} className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-xs">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-mono text-xs text-muted-foreground">{dev.device_code}</p>
                        <p className="text-sm font-semibold">{dev.name}</p>
                      </div>
                      <StatusBadge label={dev.lock_state} tone={unlocked ? 'warning' : 'success'} appearance="dot" />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 font-mono"><BatteryCharging className="size-3.5 text-emerald-500" />{dev.battery_pct ?? 100}%</span>
                      <button
                        type="button"
                        onClick={() => deviceMutation.mutate({ code: dev.device_code, name: dev.name, lockState: unlocked ? 'LOCKED' : 'UNLOCKED' })}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted"
                      >
                        {unlocked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5 text-amber-500" />}
                        <span>{unlocked ? 'Bloquear' : 'Abrir Puerta'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'videowall' ? (
        clips.length === 0 ? (
          <EmptyState title="Video Wall en espera" description="Los clips sellados SHA-256 de cámaras aparecerán aquí." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {clips.map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold">{c.camera_device_id} · {c.clip_kind}</span>
                  <StatusBadge label={`${c.duration_sec}s · ${c.status}`} tone="info" />
                </div>
                <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">SHA-256: {c.sha256_hash}</p>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === 'lpr' ? (
        <DataTable
          columns={[
            { id: 'plate', header: 'Placa', cell: (r) => <span className="font-mono font-semibold">{r.license_plate}</span> },
            { id: 'gate', header: 'Portón', cell: (r) => <span className="font-mono text-xs">{r.gate_id}</span> },
            { id: 'conf', header: 'Confianza', cell: (r) => <span className="font-mono tabular-nums">{(r.confidence_bps / 100).toFixed(1)}%</span> },
            { id: 'dec', header: 'Decisión', cell: (r) => <StatusBadge label={r.decision} tone={r.decision === 'ALLOWED' ? 'success' : 'error'} /> },
          ]}
          data={lprEvents}
          getRowId={(r) => r.id}
          emptyTitle="Sin lecturas LPR registradas"
        />
      ) : null}

      {tab === 'lockers' ? (
        <DataTable
          columns={[
            { id: 'bank', header: 'Banco', cell: (r) => <span className="font-mono text-xs">{r.bank_code}-{r.compartment_code}</span> },
            { id: 'door', header: 'Puerta', cell: (r) => <StatusBadge label={r.door_state} tone="info" /> },
            { id: 'occ', header: 'Ocupación', cell: (r) => <StatusBadge label={r.occupancy_status} tone={r.occupancy_status === 'AVAILABLE' ? 'success' : 'warning'} /> },
          ]}
          data={lockers}
          getRowId={(r) => r.id}
          emptyTitle="Sin compartimentos Smart Locker"
        />
      ) : null}

      {tab === 'lan' ? (
        <DataTable
          columns={[
            { id: 'dev', header: 'Dispositivo', cell: (r) => <span className="font-mono text-xs">{r.device_id}</span> },
            { id: 'kind', header: 'Alerta', cell: (r) => <span className="inline-flex items-center gap-1"><ShieldAlert className="size-3.5 text-destructive" />{r.alert_kind}</span> },
            { id: 'desc', header: 'Detalle', cell: (r) => r.description },
            { id: 'sev', header: 'Severidad', cell: (r) => <StatusBadge label={r.severity} tone="error" /> },
          ]}
          data={tamperAlerts}
          getRowId={(r) => r.id}
          emptyTitle="Red LAN saludable · 0 alertas de tamper"
        />
      ) : null}
    </section>
  );
}
