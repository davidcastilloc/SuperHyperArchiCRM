import type { EditionPresetId } from '@shac/kernel';
import type { Phase2ViewProps } from '../views/phase2-format';
type RpcClient = Phase2ViewProps['rpc'];

export interface DemoPersona {
  id: string;
  presetId: EditionPresetId;
  roleTitle: string;
  vertical: string;
  route: string;
  summary: string;
}

interface DemoStep {
  label: string;
  endpointSummary: string;
  route: string;
}

export interface DemoScenario {
  id: string;
  title: string;
  vertical: string;
  steps: readonly DemoStep[];
}

export interface SopCheatSheet {
  id: string;
  title: string;
  shortcuts: readonly { keys: string; action: string }[];
  checklist: readonly string[];
}

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  { id: 'retail-pos', presetId: 'retail-pos', roleTitle: 'Cajero / Supervisor Retail', vertical: 'Retail & Farmacia', route: '/pos', summary: 'Cobro dual USD/Bs, lector HID 300ms, Leylan en espera e impresión térmica ESC/POS.' },
  { id: 'clinical-ehr', presetId: 'clinic-practice', roleTitle: 'Médico / Dirección Clínica', vertical: 'Salud EHR', route: '/clinical-ehr', summary: 'Signos vitales, AI Medical Scribe (SOAP + CIE-10), recetas eRx y auditoría RCM 837.' },
  { id: 'legal-iolta', presetId: 'legal-psa', roleTitle: 'Socio Director Legal', vertical: 'Bufete & Legal', route: '/legal-hub', summary: 'Expedientes, cronómetro facturable, e-Discovery Bates, escritos IA, IOLTA y ética CLE.' },
  { id: 'hospitality-pms', presetId: 'hospitality-pms', roleTitle: 'Gerente de Hotel / PMS', vertical: 'Hotelería & Espacios', route: '/spaces', summary: 'Rack visual de habitaciones, tablero de camareras housekeeping y folios.' },
  { id: 'property-condo', presetId: 'property-condo', roleTitle: 'Administrador de Condominio', vertical: 'Propiedades & Leases', route: '/leases', summary: 'Contratos split-rent 10000 bps, votaciones vecinales y pases QR.' },
  { id: 'wms-fleet', presetId: 'distro-wms', roleTitle: 'Jefe de Bodega & Flota', vertical: 'WMS & Logística', route: '/labels-fleet', summary: 'Estudio de etiquetas Code-128B, importador CSV masivo, conteo cíclico y despacho ePOD.' },
  { id: 'helios-security', presetId: 'industrial-gate', roleTitle: 'Operador de Garita IoT', vertical: 'Seguridad Helios', route: '/physical', summary: 'Control remoto de cerraduras, Video Wall SHA-256, placas LPR y Smart Lockers.' },
];

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'retail-pos-fefo',
    title: 'Ciclo Retail Completo: CSV -> Etiquetas -> POS Leylan -> Despacho ePOD',
    vertical: 'Retail & WMS',
    steps: [
      { label: 'Importar catálogo masivo CSV y generar etiquetas Code-128B', endpointSummary: 'POST /api/wms/catalog-csv-import', route: '/labels-fleet' },
      { label: 'Abrir turno de caja, escanear SKU y aparcar ticket Leylan (F8)', endpointSummary: 'POST /api/pos/shifts/open', route: '/pos' },
      { label: 'Cobrar en USD + Pago Móvil Bs y emitir ticket térmico 80mm', endpointSummary: 'POST /api/pos/sales/checkout', route: '/pos' },
      { label: 'Asignar vehículo y registrar entrega ePOD', endpointSummary: 'POST /api/wms/fleet-dispatch', route: '/labels-fleet' },
    ],
  },
  {
    id: 'clinical-ai-rcm',
    title: 'Flujo Clínico: Signos Vitales -> AI Scribe SOAP -> eRx -> Scrubber RCM',
    vertical: 'Clínica EHR',
    steps: [
      { label: 'Registrar signos vitales y dictado clínico con AI Scribe', endpointSummary: 'POST /api/clinical/encounters', route: '/clinical-ehr' },
      { label: 'Transmitir receta electrónica eRx al paciente', endpointSummary: 'POST /api/clinical/prescriptions', route: '/clinical-ehr' },
      { label: 'Auditar reclamo de seguro 837 y copago', endpointSummary: 'POST /api/clinical/labs-and-rcm', route: '/clinical-ehr' },
    ],
  },
  {
    id: 'legal-ediscovery-gaap',
    title: 'Flujo Bufete + CFO: e-Discovery Bates -> Escrito IA -> IOLTA & Conciliación',
    vertical: 'Legal & Finanzas',
    steps: [
      { label: 'Sellar evidencia probatoria con código Bates y SHA-256', endpointSummary: 'POST /api/legal/ediscovery-hold', route: '/legal-hub' },
      { label: 'Redactar moción judicial con Workers AI', endpointSummary: 'POST /api/legal/ai-brief', route: '/legal-hub' },
      { label: 'Conciliar cuenta bancaria y verificar Balance de Comprobación', endpointSummary: 'POST /api/finance/reconciliations', route: '/finance' },
    ],
  },
  {
    id: 'condo-hotel-helios',
    title: 'Propiedades & Seguridad: Housekeeping -> Votación Condominio -> Garita LPR',
    vertical: 'Propiedades & IoT',
    steps: [
      { label: 'Transicionar habitación en Rack y Housekeeping', endpointSummary: 'POST /api/hospitality/housekeeping', route: '/spaces' },
      { label: 'Publicar encuesta comunitaria y pase QR de visitante', endpointSummary: 'POST /api/condo/hub-items', route: '/leases' },
      { label: 'Validar cerradura y puerta desde Consola Garita Helios', endpointSummary: 'POST /api/physical/devices/upsert-or-toggle', route: '/physical' },
    ],
  },
];

export const SOP_CHEAT_SHEETS: readonly SopCheatSheet[] = [
  {
    id: 'sop-pos',
    title: 'SOP Caja Rápida POS & Hardware ESC/POS',
    shortcuts: [
      { keys: 'F1', action: 'Enfocar lector de código de barras / SKU' },
      { keys: 'F2', action: 'Ir directo al módulo POS' },
      { keys: 'F4', action: 'Abrir Kiosco verificador SmartCheck 10s' },
      { keys: 'F8', action: 'Aparcar carrito en espera (Leylan)' },
      { keys: 'F9', action: 'Abrir Cobro Rápido (Billetes y Vuelto USD/Bs)' },
      { keys: '⌘K / Ctrl+K', action: 'Paleta de comandos global entre los módulos habilitados' },
    ],
    checklist: [
      'Abrir turno en POS declarando fondo inicial USD/Bs.',
      'Escanear con lector USB HID o cámara; confirmar beep sonoro.',
      'Al cerrar turno, ejecutar arqueo en USD y Bs antes de cerrar caja.',
    ],
  },
  {
    id: 'sop-gaap',
    title: 'SOP Cierre Contable GAAP & Trust IOLTA',
    shortcuts: [
      { keys: 'Trust >= 0', action: 'Guarda anti-sobregiro estricta en fin_trust_escrow_ledgers' },
      { keys: 'Partida Doble', action: 'Débito = Crédito obligatorio en asientos GL' },
    ],
    checklist: [
      'Registrar facturas de proveedores (AP Bills) y verificar saldo pendiente.',
      'Ejecutar conciliación bancaria comparando extracto vs. libros.',
      'Auditar saldos IOLTA y horas facturables aprobadas desde /legal-hub.',
    ],
  },
  {
    id: 'sop-clinical',
    title: 'SOP Consulta Clínica & AI Scribe',
    shortcuts: [
      { keys: 'AI Scribe', action: 'Dictado clínico convertido a SOAP + CIE-10 (borrador)' },
      { keys: 'RCM 837', action: 'Validación automática anti-glosas antes de facturar' },
    ],
    checklist: [
      'Tomar signos vitales completos (PA, FC, Temp, SpO2).',
      'Revisar borrador AI SOAP, firmar nota médica y transmitir receta eRx.',
    ],
  },
  {
    id: 'sop-helios',
    title: 'SOP Garita Helios & Seguridad IoT',
    shortcuts: [
      { keys: 'Garita', action: 'Apertura remota de cerraduras y registro de placas LPR' },
      { keys: 'SHA-256', action: 'Verificación de integridad en clips de Video Wall' },
    ],
    checklist: [
      'Emitir pase QR temporal con placa para visitantes.',
      'Monitorear alertas de tamper y batería de cerraduras IoT.',
    ],
  },
  {
    id: 'sop-hotel',
    title: 'SOP Hotelería PMS & Housekeeping',
    shortcuts: [
      { keys: 'Rack PMS', action: 'Disponibilidad por habitación y cobro rápido de folio' },
      { keys: 'Housekeeping', action: 'Flujo DIRTY -> CLEANING -> INSPECTED -> AVAILABLE' },
    ],
    checklist: [
      'Confirmar check-in con huésped y unidad asignada.',
      'Validar inspección de camarera antes de liberar habitación.',
    ],
  },
  {
    id: 'sop-condo',
    title: 'SOP Condominio, Leases & Split-Rent',
    shortcuts: [
      { keys: '10000 bps', action: 'Prorrateo exacto entre co-inquilinos sin decimales flotantes' },
      { keys: 'Votaciones', action: 'Registro único de voto por residente autenticado' },
    ],
    checklist: [
      'Verificar que las cuotas sumen 100.00% (10000 bps) antes de activar.',
      'Emitir pases QR con envío directo por WhatsApp al visitante.',
    ],
  },
];

export interface ScenarioProgressState {
  currentStep: number;
  logs: string[];
}

async function assertStepOk(res: { ok: boolean; status?: number; json: () => Promise<unknown> }, endpoint: string): Promise<Record<string, unknown>> {
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errObj = payload.error as { message?: string } | undefined;
    throw new Error(errObj?.message || `Error HTTP ${res.status ?? 500} en ${endpoint}`);
  }
  return payload;
}

/** Executes the real idempotent Hono RPC step against D1 / Durable Object and returns a verified receipt line. */
export async function executeLiveScenarioStep(
  rpc: RpcClient,
  scenarioId: string,
  stepIndex: number,
): Promise<string> {
  const scenario = DEMO_SCENARIOS.find((s) => s.id === scenarioId);
  const step = scenario?.steps[stepIndex];
  if (!scenario || !step) {
    throw new Error(`Paso de escenario inválido: ${scenarioId}#${stepIndex}`);
  }
  const mutId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `demo-${Date.now()}`;
  const stamp = new Date().toLocaleTimeString('es', { hour12: false });

  // Dispatch real backend call per endpointSummary
  let res: { ok: boolean; status?: number; json: () => Promise<unknown> };
  if (step.endpointSummary === 'POST /api/wms/catalog-csv-import') {
    res = await rpc.api.wms['catalog-csv-import'].$post({
      json: { clientMutationId: mutId, csvText: 'sku,name,priceMinor,taxRateBps\nDEMO-001,Producto Demo,1250,1600' },
    });
  } else if (step.endpointSummary === 'POST /api/pos/shifts/open') {
    res = await rpc.api.pos.shifts.open.$post({
      json: { clientMutationId: mutId, registerId: 'DEMO-POS-1', cashierName: 'Demo Cajero', initialBalancesMinor: { USD: 10_000 } },
    });
  } else if (step.endpointSummary === 'POST /api/pos/sales/checkout') {
    res = await rpc.api.pos.sales.checkout.$post({
      json: {
        clientMutationId: mutId,
        lines: [{ sku: 'DEMO-001', qty: 1 }],
        payments: [{ methodCode: 'CASH_USD', amountMinor: 1250 }],
      } as never,
    });
  } else if (step.endpointSummary === 'POST /api/wms/fleet-dispatch') {
    res = await rpc.api.wms['fleet-dispatch'].$post({
      json: { clientMutationId: mutId, driverName: 'Chofer Demo', vehiclePlate: 'DEMO-01', destinationLabel: 'Sucursal Centro' },
    });
  } else if (step.endpointSummary === 'POST /api/clinical/encounters') {
    res = await rpc.api.clinical.encounters.$post({
      json: { clientMutationId: mutId, patientPartyId: 'demo-patient', chiefComplaint: 'Control preventivo demo', vitals: { bp: '120/80', hr: 72 } },
    });
  } else if (step.endpointSummary === 'POST /api/clinical/prescriptions') {
    res = await rpc.api.clinical.prescriptions.$post({
      json: { clientMutationId: mutId, encounterId: 'demo-enc', medicationName: 'Amoxicilina 500mg', dosageText: '1 cada 8h x 7d' },
    });
  } else if (step.endpointSummary === 'POST /api/clinical/labs-and-rcm') {
    res = await rpc.api.clinical['labs-and-rcm'].$post({
      json: { clientMutationId: mutId, kind: 'rcm_claim', icd10Code: 'J06.9', cptCode: '99213', billedMinor: 4500 },
    });
  } else if (step.endpointSummary === 'POST /api/legal/ediscovery-hold') {
    res = await rpc.api.legal['ediscovery-hold'].$post({
      json: { clientMutationId: mutId, matterId: 'demo-matter', batesPrefix: 'DEMO-BATES', custodianName: 'Custodio Demo' },
    });
  } else if (step.endpointSummary === 'POST /api/legal/ai-brief') {
    res = await rpc.api.legal['ai-brief'].$post({
      json: { matterTitle: 'Caso Demo Arbitraje', briefType: 'Moción de Prueba', factsSummary: 'Hechos verificados en simulador.' },
    });
  } else if (step.endpointSummary === 'POST /api/finance/reconciliations') {
    res = await rpc.api.finance.reconciliations.$post({
      json: { clientMutationId: mutId, bankAccountCode: '1110-BCO', statementDate: '2026-11-16', statementEndingBalanceMinor: 50_000 },
    });
  } else if (step.endpointSummary === 'POST /api/hospitality/housekeeping') {
    res = await rpc.api.hospitality.housekeeping.$post({
      json: { clientMutationId: mutId, unitCode: 'HAB-101', targetStatus: 'INSPECTED' },
    });
  } else if (step.endpointSummary === 'POST /api/condo/hub-items') {
    res = await rpc.api.condo['hub-items'].$post({
      json: { clientMutationId: mutId, itemType: 'poll', title: 'Asamblea Demo', body: 'Aprobar mantenimiento trimestral.' },
    });
  } else {
    res = await rpc.api.physical.devices['upsert-or-toggle'].$post({
      json: { clientMutationId: mutId, deviceCode: 'GATE-DEMO-1', deviceType: 'door_lock', locationLabel: 'Garita Principal', state: 'UNLOCKED' },
    });
  }

  await assertStepOk(res, step.endpointSummary);
  return `[${stamp}] ✓ ${step.label} (${step.endpointSummary})`;
}
