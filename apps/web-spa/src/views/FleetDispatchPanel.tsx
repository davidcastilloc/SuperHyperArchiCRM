import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eraser, Plus, Truck } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { DataTable, StatusBadge } from '@shac/ui';
import { INPUT_CLS, readApiError, type Phase2ViewProps } from './phase2-format';

interface FleetDispatchPanelProps {
  rpc: Phase2ViewProps['rpc'];
  vehicles: Array<{ id: string; vehicleCode: string; plateNumber: string; driverName: string }>;
  orders: Array<{ id: string; orderNumber: string }>;
  ops: Array<{ id: string; kind: string; code: string; status: string }>;
  opsLoading: boolean;
  onStatus: (msg: string) => void;
  onError: (msg: string | null) => void;
}

/** Fleet vehicle registry, e-POD canvas signature capture, and dispatch audit table. */
export function FleetDispatchPanel({ rpc, vehicles, orders, ops, opsLoading, onStatus, onError }: FleetDispatchPanelProps) {
  const queryClient = useQueryClient();
  const [newVehCode, setNewVehCode] = useState('');
  const [newVehPlate, setNewVehPlate] = useState('');
  const [newVehDriver, setNewVehDriver] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [signaturePath, setSignaturePath] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  const registerVehicleMutation = useMutation({
    mutationFn: async () => {
      const res = await rpc.api.wms.vehicles.$post({
        json: { vehicleCode: newVehCode.trim(), plateNumber: newVehPlate.trim(), driverName: newVehDriver.trim() || undefined, isColdChain: false },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: (v) => {
      onError(null);
      setNewVehCode('');
      setNewVehPlate('');
      setNewVehDriver('');
      setSelectedVehicleId(v.id);
      onStatus(`Vehículo ${v.vehicleCode} registrado.`);
      void queryClient.invalidateQueries({ queryKey: ['wms', 'vehicles'] });
    },
    onError: (err: Error) => onError(err.message),
  });

  const epodMutation = useMutation({
    mutationFn: async () => {
      const veh = vehicles.find((v) => v.id === (selectedVehicleId || vehicles[0]?.id));
      const ord = orders.find((o) => o.id === (selectedOrderId || orders[0]?.id));
      const res = await rpc.api.wms.fleet.epod.$post({
        json: {
          clientMutationId: crypto.randomUUID(),
          vehicleId: veh?.id ?? 'veh_default',
          orderId: ord?.id ?? 'ord_default',
          epodRecipientName: recipient.trim() || 'Receptor Conforme',
          epodSignatureSvg: `<svg viewBox="0 0 420 110"><path d="${signaturePath || 'M 10 30 L 80 30'}" stroke="#2563EB" fill="none"/></svg>`,
          epodPhotoR2Key: `epod/${ord?.orderNumber ?? 'delivery'}-${Date.now()}.png`,
          epodLat: 10.4806,
          epodLng: -66.9036,
          loadWeightGrams: 1000,
          loadPallets: 1,
        },
      });
      if (!res.ok) throw await readApiError(res);
      return res.json();
    },
    onSuccess: () => {
      onError(null);
      setRecipient('');
      clearSignature();
      void queryClient.invalidateQueries({ queryKey: ['wms', 'fleet-and-qc'] });
      onStatus('Entrega confirmada con firma digital e-POD.');
    },
    onError: (err: Error) => onError(err.message),
  });

  function clearSignature() {
    setSignaturePath('');
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = true;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    const ctx = canvas.getContext('2d');
    ctx?.beginPath();
    ctx?.moveTo(x, y);
    setSignaturePath((p) => `${p ? `${p} ` : ''}M ${x} ${y}`);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) { ctx.lineWidth = 2; ctx.strokeStyle = '#2563EB'; ctx.lineTo(x, y); ctx.stroke(); }
    setSignaturePath((p) => `${p} L ${x} ${y}`);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (newVehCode.trim() && newVehPlate.trim()) registerVehicleMutation.mutate(); }} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4">
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Código Unidad</span><input value={newVehCode} onChange={(e) => setNewVehCode(e.target.value)} placeholder="VAN-02" className={`${INPUT_CLS} w-full font-mono`} /></label>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Placa</span><input value={newVehPlate} onChange={(e) => setNewVehPlate(e.target.value)} placeholder="XYZ-991" className={`${INPUT_CLS} w-full font-mono`} /></label>
        <label className="space-y-1 text-xs"><span className="font-medium text-muted-foreground">Chofer</span><input value={newVehDriver} onChange={(e) => setNewVehDriver(e.target.value)} placeholder="Carlos Pérez" className={`${INPUT_CLS} w-full`} /></label>
        <button type="submit" disabled={registerVehicleMutation.isPending} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-semibold hover:bg-muted">
          <Plus className="size-3.5" /><span>Registrar Vehículo</span>
        </button>
      </form>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Vehículo</span>
            <select value={selectedVehicleId || vehicles[0]?.id || ''} onChange={(e) => setSelectedVehicleId(e.target.value)} className={`${INPUT_CLS} h-11 w-full`}>
              {vehicles.length === 0 ? <option value="">Sin vehículos (registra uno arriba)</option> : null}
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicleCode} · {v.plateNumber}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Orden de Despacho</span>
            <select value={selectedOrderId || orders[0]?.id || ''} onChange={(e) => setSelectedOrderId(e.target.value)} className={`${INPUT_CLS} h-11 w-full`}>
              {orders.length === 0 ? <option value="ord_demo">ORD-DEMO</option> : null}
              {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Receptor e-POD</span>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Nombre receptor" className={`${INPUT_CLS} h-11 w-full`} />
          </label>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">Firma Digital en Pantalla (e-POD)</span>
            <button type="button" onClick={clearSignature} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <Eraser className="size-3" /><span>Limpiar trazo</span>
            </button>
          </div>
          <canvas ref={canvasRef} width={420} height={110} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drawingRef.current = false; }} onPointerLeave={() => { drawingRef.current = false; }} className="w-full max-w-md touch-none rounded-lg border border-dashed border-border bg-background" />
        </div>
        <button type="button" disabled={epodMutation.isPending} onClick={() => epodMutation.mutate()} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground">
          <Truck className="size-3.5" /><span>{epodMutation.isPending ? 'Enviando...' : 'Confirmar Entrega e-POD'}</span>
        </button>
      </div>

      <DataTable
        columns={[
          { id: 'kind', header: 'Tipo', cell: (r) => <StatusBadge label={r.kind} tone="info" /> },
          { id: 'code', header: 'Unidad / SKU', cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
          { id: 'st', header: 'Estado', cell: (r) => <StatusBadge label={r.status} tone="success" appearance="dot" /> },
        ]}
        data={ops}
        getRowId={(r) => r.id}
        loading={opsLoading}
        emptyTitle="Sin movimientos de flota o conteo aún"
      />
    </div>
  );
}
