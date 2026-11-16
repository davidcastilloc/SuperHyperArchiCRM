import { createElement, type ComponentType } from 'react';
import type { TenantMarketProfile } from '@shac/kernel';
import type { BranchOption, ShacNavItem } from '@shac/ui';
import {
  BedDouble, Blocks, BriefcaseMedical, Building2, ClipboardCheck, ClipboardList,
  Columns3, Database, FileSignature, FileSpreadsheet, FileText, FolderKanban,
  FolderTree, GitBranch, History, KeyRound, Landmark, LayoutDashboard, Leaf,
  MapPin, Package, Percent, Plug, QrCode, ReceiptText, ScanBarcode, ShieldCheck,
  Sparkles, UserCheck, Users, Warehouse, Wrench,
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
    'leases', 'services', 'cases', 'finance', 'portal', 'automation', 'physical', 'crm',
  ],
  vocabulary: {
    partySingular: 'Cliente', partyPlural: 'Clientes', orderSingular: 'Pedido',
    branchSingular: 'Sucursal', spaceSingular: 'Espacio', caseSingular: 'Expediente',
  },
};

export const DEFAULT_BRANCHES: BranchOption[] = [
  { id: 'branch-hq', name: 'Casa Matriz', orgPath: '/hq' },
];

export const NAV_ITEMS: ShacNavItem[] = [
  { id: 'home', label: 'Dashboard', href: '/', group: 'GENERAL', icon: navIcon(LayoutDashboard) },
  { id: 'auth', label: 'Acceso Sucursal', href: '/auth', group: 'GENERAL', icon: navIcon(KeyRound) },
  { id: 'tasks', label: 'Tareas & Agenda', href: '/tasks', group: 'CUSTOMERS', moduleId: 'customers', icon: navIcon(ClipboardCheck) },
  { id: 'parties', label: DEFAULT_PROFILE.vocabulary.partyPlural, href: '/parties', group: 'CUSTOMERS', moduleId: 'customers', icon: navIcon(Building2) },
  { id: 'deals', label: 'Deals (Kanban & Mapa)', href: '/deals', group: 'CUSTOMERS', moduleId: 'customers', icon: navIcon(Columns3) },
  { id: 'portal', label: 'Portal Cliente', href: '/portal', group: 'CUSTOMERS', moduleId: 'portal', icon: navIcon(ShieldCheck) },
  { id: 'forms', label: 'Formularios Públicos', href: '/forms', group: 'CUSTOMERS', moduleId: 'portal', icon: navIcon(ClipboardList) },
  { id: 'catalog', label: 'Productos y Tarifas', href: '/catalog', group: 'CATALOG', moduleId: 'catalog', icon: navIcon(Package) },
  { id: 'categories', label: 'Categorías & Variantes', href: '/categories', group: 'CATALOG', moduleId: 'catalog', icon: navIcon(FolderTree) },
  { id: 'promotions', label: 'Promociones & Cupones', href: '/promotions', group: 'CATALOG', moduleId: 'catalog', icon: navIcon(Percent) },
  { id: 'pos', label: `POS · ${DEFAULT_PROFILE.vocabulary.orderSingular}`, href: '/pos', group: 'SALES', moduleId: 'pos', shortcut: 'F2', icon: navIcon(ReceiptText) },
  { id: 'orders', label: 'Órdenes de Venta', href: '/orders', group: 'SALES', moduleId: 'pos', icon: navIcon(FileSpreadsheet) },
  { id: 'quotes', label: 'Cotizaciones & PDF', href: '/quotes', group: 'SALES', moduleId: 'pos', icon: navIcon(FileText) },
  { id: 'kiosk', label: 'SmartCheck 10s', href: '/kiosk/price-check', group: 'SALES', moduleId: 'pos', shortcut: 'F4', icon: navIcon(ScanBarcode) },
  { id: 'wms', label: `WMS · ${DEFAULT_PROFILE.vocabulary.branchSingular}`, href: '/wms', group: 'WMS', moduleId: 'wms', shortcut: 'F6', icon: navIcon(Warehouse) },
  { id: 'wms-locations', label: 'Almacenes, Bins & ASNs', href: '/wms-locations', group: 'WMS', moduleId: 'wms', icon: navIcon(MapPin) },
  { id: 'eudr', label: 'EUDR Trazabilidad', href: '/eudr', group: 'WMS', moduleId: 'core', icon: navIcon(Leaf) },
  { id: 'claims', label: 'Garantías & RMA', href: '/claims', group: 'OPERACIONES', moduleId: 'services', icon: navIcon(Wrench) },
  { id: 'spaces', label: `${DEFAULT_PROFILE.vocabulary.spaceSingular}s · Rack`, href: '/spaces', group: 'OPERACIONES', moduleId: 'spaces', icon: navIcon(BedDouble) },
  { id: 'leases', label: 'Leases · Hub', href: '/leases', group: 'OPERACIONES', moduleId: 'leases', icon: navIcon(FileSignature) },
  { id: 'cases', label: `${DEFAULT_PROFILE.vocabulary.caseSingular}s · Med/Legal`, href: '/cases', group: 'OPERACIONES', moduleId: 'cases', icon: navIcon(BriefcaseMedical) },
  { id: 'physical', label: 'IoT · Accesos & LPR', href: '/physical', group: 'OPERACIONES', moduleId: 'physical', icon: navIcon(QrCode) },
  { id: 'staff', label: 'Staff, Ausencias & Horas', href: '/staff', group: 'STAFF & PSA', moduleId: 'iam', icon: navIcon(UserCheck) },
  { id: 'projects', label: 'Proyectos PSA', href: '/projects', group: 'STAFF & PSA', moduleId: 'iam', icon: navIcon(FolderKanban) },
  { id: 'finance', label: 'Finanzas · Trust/GAAP', href: '/finance', group: 'FINANZAS', moduleId: 'finance', icon: navIcon(Landmark) },
  { id: 'iam-admin', label: 'Usuarios, Orgs & Keys', href: '/iam-admin', group: 'SISTEMA', moduleId: 'iam', icon: navIcon(Users) },
  { id: 'audit-logs', label: 'Audit Logs', href: '/audit-logs', group: 'SISTEMA', moduleId: 'core', icon: navIcon(History) },
  { id: 'custom-fields', label: 'Campos Custom (v_cf)', href: '/custom-fields', group: 'SISTEMA', moduleId: 'core', icon: navIcon(Database) },
  { id: 'workflows', label: 'Workflows Visuales', href: '/workflows', group: 'SISTEMA', moduleId: 'automation', icon: navIcon(GitBranch) },
  { id: 'automation', label: 'Reglas & InboxOps', href: '/automation', group: 'SISTEMA', moduleId: 'automation', icon: navIcon(Sparkles) },
  { id: 'integrations', label: 'Integraciones & Gateways', href: '/integrations', group: 'SISTEMA', moduleId: 'core', icon: navIcon(Plug) },
  { id: 'app-store', label: 'App Store (Módulos)', href: '/app-store', group: 'SISTEMA', moduleId: 'core', icon: navIcon(Blocks) },
];
