export interface DemoPersona {
  id: string;
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
  { id: 'retail-pos', roleTitle: 'Cajero / Supervisor Retail', vertical: 'Retail & Farmacia', route: '/pos', summary: 'Cobro dual USD/Bs, lector HID 300ms, Leylan en espera e impresión térmica ESC/POS.' },
  { id: 'clinical-ehr', roleTitle: 'Médico / Dirección Clínica', vertical: 'Salud EHR', route: '/clinical-ehr', summary: 'Signos vitales, AI Medical Scribe (SOAP + CIE-10), recetas eRx y auditoría RCM 837.' },
  { id: 'legal-iolta', roleTitle: 'Socio Director Legal', vertical: 'Bufete & Legal', route: '/legal-hub', summary: 'Expedientes, cronómetro facturable, e-Discovery Bates, escritos IA, IOLTA y ética CLE.' },
  { id: 'hospitality-pms', roleTitle: 'Gerente de Hotel / PMS', vertical: 'Hotelería & Espacios', route: '/spaces', summary: 'Rack visual de habitaciones, tablero de camareras housekeeping y folios.' },
  { id: 'wms-fleet', roleTitle: 'Jefe de Bodega & Flota', vertical: 'WMS & Logística', route: '/labels-fleet', summary: 'Estudio de etiquetas Code-128B, importador CSV masivo, conteo cíclico y despacho ePOD.' },
  { id: 'helios-security', roleTitle: 'Operador de Garita IoT', vertical: 'Seguridad Helios', route: '/physical', summary: 'Control remoto de cerraduras, Video Wall SHA-256, placas LPR y Smart Lockers.' },
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
      { keys: '⌘K / Ctrl+K', action: 'Paleta de comandos global entre los 35+ módulos' },
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
      { keys: 'AI Scribe', action: 'Dictado clínico convertido a SOAP + CIE-10' },
      { keys: 'RCM 837', action: 'Validación automática anti-glosas antes de facturar' },
    ],
    checklist: [
      'Tomar signos vitales completos (PA, FC, Temp, SpO2).',
      'Generar nota SOAP firmada y transmitir receta eRx.',
    ],
  },
  {
    id: 'sop-helios',
    title: 'SOP Garita Helios & Condominio',
    shortcuts: [
      { keys: 'Garita', action: 'Apertura remota de cerraduras y registro de placas LPR' },
      { keys: 'SHA-256', action: 'Verificación de integridad en clips de Video Wall' },
    ],
    checklist: [
      'Emitir pase QR temporal con placa para visitantes.',
      'Monitorear alertas de tamper y batería de cerraduras IoT.',
    ],
  },
];

export interface ScenarioProgressState {
  currentStep: number;
  logs: string[];
}

/** Pure step-advancer for guided DemoScenarioRunner playbooks. */
export function advanceScenarioStep(
  state: ScenarioProgressState,
  scenario: DemoScenario,
): ScenarioProgressState {
  const step = scenario.steps[state.currentStep];
  if (!step) return state;
  const stamp = new Date().toLocaleTimeString('es', { hour12: false });
  return {
    currentStep: Math.min(scenario.steps.length, state.currentStep + 1),
    logs: [`[${stamp}] ✓ ${step.label} (${step.endpointSummary})`, ...state.logs],
  };
}
