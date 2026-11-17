import { createElement, type ComponentType } from 'react';
import type { EditionPresetId, TenantMarketProfile } from '@shac/kernel';
import type { BranchOption, ShacNavItem } from '@shac/ui';
import {
  BedDouble, Blocks, BookOpenCheck, Building2, ClipboardCheck, ClipboardList,
  Columns3, Database, FileSignature, FileSpreadsheet, FileText, FolderKanban,
  FolderTree, GitBranch, History, Landmark, LayoutDashboard, Leaf,
  MapPin, Package, Percent, Plug, QrCode, ReceiptText, Scale, ScanBarcode, ShieldCheck,
  Sparkles, Stethoscope, Truck, UserCheck, Users, Warehouse, Wrench,
} from 'lucide-react';

function navIcon(Icon: ComponentType<{ className?: string }>) {
  return createElement(Icon, { className: 'size-4' });
}

export const DEFAULT_PROFILE: Pick<
  TenantMarketProfile,
  'tenantId' | 'editionPreset' | 'activeModules' | 'vocabulary'
> = {
  tenantId: 'tenant-demo',
  editionPreset: 'omni-enterprise',
  activeModules: [
    'core', 'iam', 'customers', 'catalog', 'pos', 'wms', 'spaces',
    'leases', 'services', 'cases', 'finance', 'portal', 'automation', 'physical',
  ],
  vocabulary: {
    partySingular: 'Cliente', partyPlural: 'Clientes', orderSingular: 'Pedido',
    branchSingular: 'Sucursal', spaceSingular: 'Espacio', caseSingular: 'Expediente',
  },
};

export const DEFAULT_BRANCHES: BranchOption[] = [
  { id: 'branch-hq', name: 'Casa Matriz', orgPath: '/hq' },
];

type NavProfileInput = Pick<TenantMarketProfile, 'editionPreset' | 'activeModules' | 'vocabulary'>;

/** Builds 5 collapsible role workstations filtered strictly by activeModules and allowedPresets (8–12 items/vertical). */
export function buildNavItems(profile: NavProfileInput): ShacNavItem[] {
  const voc = profile.vocabulary;
  return [
    { id: 'home', label: 'Dashboard', href: '/', group: 'GENERAL', icon: navIcon(LayoutDashboard) },

    {
      id: 'pos', label: `POS · ${voc.orderSingular}`, href: '/pos', group: 'OPERACIÓN PRINCIPAL', moduleId: 'pos',
      allowedPresets: ['retail-pos', 'tech-service', 'hospitality-pms', 'omni-enterprise'], shortcut: 'F2', icon: navIcon(ReceiptText),
    },
    {
      id: 'orders', label: voc.orderSingular, href: '/orders', group: 'OPERACIÓN PRINCIPAL', moduleId: 'catalog',
      allowedPresets: ['retail-pos', 'distro-wms', 'omni-enterprise'], icon: navIcon(FileSpreadsheet),
    },
    {
      id: 'kiosk', label: 'SmartCheck 10s', href: '/kiosk/price-check', group: 'OPERACIÓN PRINCIPAL', moduleId: 'pos',
      allowedPresets: ['retail-pos', 'omni-enterprise'], shortcut: 'F4', icon: navIcon(ScanBarcode),
    },
    {
      id: 'spaces', label: 'Rack PMS & Reservas', href: '/spaces', group: 'OPERACIÓN PRINCIPAL', moduleId: 'spaces',
      allowedPresets: ['hospitality-pms', 'omni-enterprise'], icon: navIcon(BedDouble),
    },
    {
      id: 'leases', label: 'Condominio & Leases', href: '/leases', group: 'OPERACIÓN PRINCIPAL', moduleId: 'leases',
      allowedPresets: ['property-condo', 'omni-enterprise'], icon: navIcon(FileSignature),
    },
    {
      id: 'clinical-ehr', label: 'Clínica EHR & AI Scribe', href: '/clinical-ehr', group: 'OPERACIÓN PRINCIPAL', moduleId: 'cases',
      allowedPresets: ['clinic-practice', 'omni-enterprise'], icon: navIcon(Stethoscope),
    },
    {
      id: 'legal-hub', label: 'Legal, Dockets & IOLTA', href: '/legal-hub', group: 'OPERACIÓN PRINCIPAL', moduleId: 'cases',
      allowedPresets: ['legal-psa', 'omni-enterprise'], icon: navIcon(Scale),
    },
    {
      id: 'physical', label: 'Helios IoT · Garita & LPR', href: '/physical', group: 'OPERACIÓN PRINCIPAL', moduleId: 'physical',
      allowedPresets: ['industrial-gate', 'hospitality-pms', 'property-condo', 'omni-enterprise'], icon: navIcon(QrCode),
    },
    {
      id: 'claims', label: voc.caseSingular, href: '/claims', group: 'OPERACIÓN PRINCIPAL', moduleId: 'services',
      allowedPresets: ['retail-pos', 'distro-wms', 'tech-service', 'hospitality-pms', 'property-condo', 'clinic-practice', 'industrial-gate', 'omni-enterprise'], icon: navIcon(Wrench),
    },

    { id: 'parties', label: voc.partyPlural, href: '/parties', group: 'DIRECTORIO & COMERCIAL', moduleId: 'customers', icon: navIcon(Building2) },
    {
      id: 'tasks', label: 'Agenda & Tareas', href: '/tasks', group: 'DIRECTORIO & COMERCIAL', moduleId: 'customers',
      allowedPresets: ['clinic-practice', 'legal-psa', 'tech-service', 'omni-enterprise'], icon: navIcon(ClipboardCheck),
    },
    {
      id: 'deals', label: 'Deals (Kanban & Mapa)', href: '/deals', group: 'DIRECTORIO & COMERCIAL', moduleId: 'customers',
      allowedPresets: ['omni-enterprise'], icon: navIcon(Columns3),
    },
    {
      id: 'quotes', label: 'Cotizaciones & PDF', href: '/quotes', group: 'DIRECTORIO & COMERCIAL', moduleId: 'catalog',
      allowedPresets: ['retail-pos', 'distro-wms', 'tech-service', 'omni-enterprise'], icon: navIcon(FileText),
    },
    {
      id: 'portal', label: `Portal ${voc.partySingular}`, href: '/portal', group: 'DIRECTORIO & COMERCIAL', moduleId: 'portal',
      allowedPresets: ['distro-wms', 'tech-service', 'hospitality-pms', 'property-condo', 'clinic-practice', 'legal-psa', 'omni-enterprise'], icon: navIcon(ShieldCheck),
    },
    {
      id: 'forms', label: 'Formularios Públicos', href: '/forms', group: 'DIRECTORIO & COMERCIAL', moduleId: 'portal',
      allowedPresets: ['property-condo', 'clinic-practice', 'legal-psa', 'omni-enterprise'], icon: navIcon(ClipboardList),
    },

    {
      id: 'catalog', label: 'Productos y Tarifas', href: '/catalog', group: 'CATÁLOGO & LOGÍSTICA', moduleId: 'catalog',
      allowedPresets: ['retail-pos', 'distro-wms', 'tech-service', 'hospitality-pms', 'clinic-practice', 'omni-enterprise'], icon: navIcon(Package),
    },
    {
      id: 'categories', label: 'Categorías & Variantes', href: '/categories', group: 'CATÁLOGO & LOGÍSTICA', moduleId: 'catalog',
      allowedPresets: ['retail-pos', 'omni-enterprise'], icon: navIcon(FolderTree),
    },
    {
      id: 'promotions', label: 'Promociones & Cupones', href: '/promotions', group: 'CATÁLOGO & LOGÍSTICA', moduleId: 'catalog',
      allowedPresets: ['retail-pos', 'omni-enterprise'], icon: navIcon(Percent),
    },
    {
      id: 'wms', label: `WMS · ${voc.branchSingular}`, href: '/wms', group: 'CATÁLOGO & LOGÍSTICA', moduleId: 'wms',
      allowedPresets: ['retail-pos', 'distro-wms', 'tech-service', 'omni-enterprise'], shortcut: 'F6', icon: navIcon(Warehouse),
    },
    {
      id: 'wms-locations', label: 'Almacenes, Bins & ASNs', href: '/wms-locations', group: 'CATÁLOGO & LOGÍSTICA', moduleId: 'wms',
      allowedPresets: ['distro-wms', 'omni-enterprise'], icon: navIcon(MapPin),
    },
    {
      id: 'labels-fleet', label: 'Etiquetas, CSV & Flota', href: '/labels-fleet', group: 'CATÁLOGO & LOGÍSTICA', moduleId: 'wms',
      allowedPresets: ['distro-wms', 'omni-enterprise'], icon: navIcon(Truck),
    },
    {
      id: 'eudr', label: 'EUDR Trazabilidad', href: '/eudr', group: 'CATÁLOGO & LOGÍSTICA', moduleId: 'wms',
      allowedPresets: ['omni-enterprise'], icon: navIcon(Leaf),
    },

    {
      id: 'finance', label: 'Finanzas · Trust/GAAP', href: '/finance', group: 'FINANZAS & EQUIPO', moduleId: 'finance',
      allowedPresets: ['distro-wms', 'hospitality-pms', 'property-condo', 'clinic-practice', 'legal-psa', 'omni-enterprise'], icon: navIcon(Landmark),
    },
    {
      id: 'staff', label: 'Staff, Ausencias & Horas', href: '/staff', group: 'FINANZAS & EQUIPO', moduleId: 'iam',
      allowedPresets: ['legal-psa', 'omni-enterprise'], icon: navIcon(UserCheck),
    },
    {
      id: 'projects', label: 'Proyectos PSA', href: '/projects', group: 'FINANZAS & EQUIPO', moduleId: 'iam',
      allowedPresets: ['legal-psa', 'tech-service', 'omni-enterprise'], icon: navIcon(FolderKanban),
    },

    { id: 'iam-admin', label: 'Usuarios, Sucursales & PIN', href: '/iam-admin', group: 'PLATAFORMA', moduleId: 'iam', allowedPresets: ['retail-pos', 'industrial-gate', 'omni-enterprise'], icon: navIcon(Users) },
    { id: 'automation', label: 'Reglas & InboxOps', href: '/automation', group: 'PLATAFORMA', moduleId: 'automation', allowedPresets: ['industrial-gate', 'omni-enterprise'], icon: navIcon(Sparkles) },
    { id: 'app-store', label: 'App Store (Módulos)', href: '/app-store', group: 'PLATAFORMA', moduleId: 'core', allowedPresets: ['omni-enterprise'], icon: navIcon(Blocks) },
    { id: 'audit-logs', label: 'Audit Logs', href: '/audit-logs', group: 'PLATAFORMA', moduleId: 'core', allowedPresets: ['omni-enterprise'], icon: navIcon(History) },
    { id: 'custom-fields', label: 'Campos Custom (v_cf)', href: '/custom-fields', group: 'PLATAFORMA', moduleId: 'core', allowedPresets: ['omni-enterprise'], icon: navIcon(Database) },
    { id: 'workflows', label: 'Workflows Visuales', href: '/workflows', group: 'PLATAFORMA', moduleId: 'automation', allowedPresets: ['omni-enterprise'], icon: navIcon(GitBranch) },
    { id: 'integrations', label: 'Integraciones & Gateways', href: '/integrations', group: 'PLATAFORMA', moduleId: 'core', allowedPresets: ['omni-enterprise'], icon: navIcon(Plug) },
    { id: 'demo-sop', label: 'Simulador Demo & SOP', href: '/demo-sop', group: 'PLATAFORMA', moduleId: 'core', allowedPresets: ['omni-enterprise'], icon: navIcon(BookOpenCheck) },
  ];
}

export function getDefaultCollapsedGroups(presetId: EditionPresetId): Record<string, boolean> {
  if (presetId === 'omni-enterprise') {
    return { 'CATÁLOGO & LOGÍSTICA': true, 'FINANZAS & EQUIPO': true, PLATAFORMA: true };
  }
  return {};
}
