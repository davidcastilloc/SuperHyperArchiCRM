import type { TenantMarketProfile } from '@shac/kernel';
import type { BranchOption, ShacNavItem } from '@shac/ui';

export const DEFAULT_PROFILE: Pick<
  TenantMarketProfile,
  'tenantId' | 'editionPreset' | 'activeModules' | 'vocabulary'
> = {
  tenantId: 'tenant-demo',
  editionPreset: 'omni-enterprise',
  activeModules: [
    'core',
    'iam',
    'customers',
    'catalog',
    'pos',
    'wms',
    'spaces',
    'leases',
    'services',
    'cases',
    'finance',
    'portal',
    'automation',
    'physical',
    'crm',
  ],
  vocabulary: {
    partySingular: 'Cliente',
    partyPlural: 'Clientes',
    orderSingular: 'Pedido',
    branchSingular: 'Sucursal',
    spaceSingular: 'Espacio',
    caseSingular: 'Expediente',
  },
};

export const DEFAULT_BRANCHES: BranchOption[] = [
  { id: 'branch-hq', name: 'Casa Matriz', orgPath: '/hq' },
];

export const NAV_ITEMS: ShacNavItem[] = [
  { id: 'home', label: 'Dashboard', href: '/', group: 'GENERAL' },
  { id: 'auth', label: 'Acceso Sucursal', href: '/auth', group: 'GENERAL' },
  {
    id: 'parties',
    label: DEFAULT_PROFILE.vocabulary.partyPlural,
    href: '/parties',
    group: 'CUSTOMERS',
    moduleId: 'customers',
  },
  { id: 'catalog', label: 'Productos y Tarifas', href: '/catalog', group: 'CATALOG', moduleId: 'catalog' },
  {
    id: 'pos',
    label: `POS · ${DEFAULT_PROFILE.vocabulary.orderSingular}`,
    href: '/pos',
    group: 'SALES',
    moduleId: 'pos',
    shortcut: 'F2',
  },
  {
    id: 'kiosk',
    label: 'SmartCheck 10s',
    href: '/kiosk/price-check',
    group: 'SALES',
    moduleId: 'pos',
    shortcut: 'F4',
  },
  {
    id: 'wms',
    label: `WMS · ${DEFAULT_PROFILE.vocabulary.branchSingular}`,
    href: '/wms',
    group: 'WMS',
    moduleId: 'wms',
    shortcut: 'F6',
  },
  {
    id: 'spaces',
    label: `${DEFAULT_PROFILE.vocabulary.spaceSingular}s · Rack`,
    href: '/spaces',
    group: 'OPERACIONES',
    moduleId: 'spaces',
  },
  { id: 'leases', label: 'Leases · Hub', href: '/leases', group: 'OPERACIONES', moduleId: 'leases' },
  {
    id: 'cases',
    label: `${DEFAULT_PROFILE.vocabulary.caseSingular}s · Med/Legal`,
    href: '/cases',
    group: 'OPERACIONES',
    moduleId: 'cases',
  },
  { id: 'finance', label: 'Finanzas · Trust/GAAP', href: '/finance', group: 'FINANZAS', moduleId: 'finance' },
  { id: 'portal', label: 'Portal Cliente', href: '/portal', group: 'CUSTOMERS', moduleId: 'portal' },
  { id: 'automation', label: 'Automatización IA', href: '/automation', group: 'SISTEMA', moduleId: 'automation' },
  { id: 'physical', label: 'IoT · Accesos & LPR', href: '/physical', group: 'OPERACIONES', moduleId: 'physical' },
  { id: 'app-store', label: 'App Store (Módulos)', href: '/app-store', group: 'SISTEMA', moduleId: 'core' },
];
