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
  { id: 'home', label: 'Inicio', href: '/' },
  { id: 'auth', label: 'Acceso Sucursal', href: '/auth' },
  {
    id: 'parties',
    label: DEFAULT_PROFILE.vocabulary.partyPlural,
    href: '/parties',
    moduleId: 'customers',
  },
  { id: 'catalog', label: 'Catálogo', href: '/catalog', moduleId: 'catalog' },
  {
    id: 'pos',
    label: `POS · ${DEFAULT_PROFILE.vocabulary.orderSingular}`,
    href: '/pos',
    moduleId: 'pos',
    shortcut: 'F2',
  },
  {
    id: 'kiosk',
    label: 'SmartCheck 10s',
    href: '/kiosk/price-check',
    moduleId: 'pos',
    shortcut: 'F4',
  },
  {
    id: 'wms',
    label: `WMS · ${DEFAULT_PROFILE.vocabulary.branchSingular}`,
    href: '/wms',
    moduleId: 'wms',
    shortcut: 'F6',
  },
  {
    id: 'spaces',
    label: `${DEFAULT_PROFILE.vocabulary.spaceSingular}s · Rack`,
    href: '/spaces',
    moduleId: 'spaces',
  },
  { id: 'leases', label: 'Leases · Hub', href: '/leases', moduleId: 'leases' },
  {
    id: 'cases',
    label: `${DEFAULT_PROFILE.vocabulary.caseSingular}s · Med/Legal`,
    href: '/cases',
    moduleId: 'cases',
  },
  { id: 'finance', label: 'Finanzas · Trust/GAAP', href: '/finance', moduleId: 'finance' },
  { id: 'portal', label: 'Portal Cliente', href: '/portal', moduleId: 'portal' },
  { id: 'automation', label: 'Automatización IA', href: '/automation', moduleId: 'automation' },
  { id: 'app-store', label: 'App Store', href: '/app-store', moduleId: 'core' },
];
