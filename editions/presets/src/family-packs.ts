import { z } from 'zod';

export const CANONICAL_MODULE_IDS = [
  'core',
  'iam',
  'customers',
  'catalog',
  'pos',
  'regional',
  'wms',
  'spaces',
  'leases',
  'services',
  'cases',
  'finance',
  'portal',
  'automation',
  'physical',
] as const;

export type CanonicalModuleId = (typeof CANONICAL_MODULE_IDS)[number];

export const CanonicalModuleIdSchema = z.enum(CANONICAL_MODULE_IDS);

export const FAMILY_PACK_IDS = [
  'commerce-wms',
  'spaces-stays',
  'cases-practice',
  'physical-iot',
] as const;

export type FamilyPackId = (typeof FAMILY_PACK_IDS)[number];

export const FamilyPackIdSchema = z.enum(FAMILY_PACK_IDS);

export interface FamilyPackDefinition {
  readonly id: FamilyPackId;
  readonly label: string;
  readonly description: string;
  readonly modules: readonly CanonicalModuleId[];
}

export const FAMILY_PACKS: Readonly<Record<FamilyPackId, FamilyPackDefinition>> = {
  'commerce-wms': {
    id: 'commerce-wms',
    label: 'Commerce & WMS',
    description:
      'Retail POS, wholesale distribution, multi-branch inventory, fiscal/regional compliance, finance, and B2B portal.',
    modules: [
      'core',
      'iam',
      'customers',
      'catalog',
      'pos',
      'regional',
      'wms',
      'finance',
      'portal',
    ],
  },
  'spaces-stays': {
    id: 'spaces-stays',
    label: 'Spaces & Stays',
    description:
      'Hospitality rooms, condo units, leases, service orders, and self-service resident/guest portal.',
    modules: [
      'core',
      'iam',
      'customers',
      'spaces',
      'leases',
      'services',
      'portal',
    ],
  },
  'cases-practice': {
    id: 'cases-practice',
    label: 'Cases & Practice',
    description:
      'Clinical charts, legal matters, EVV/service delivery, billing/IOLTA finance, portal, and workflow automation.',
    modules: [
      'core',
      'iam',
      'customers',
      'cases',
      'services',
      'finance',
      'portal',
      'automation',
    ],
  },
  'physical-iot': {
    id: 'physical-iot',
    label: 'Physical & IoT',
    description:
      'Smart gates, access passes, facility spaces, field services, hardware/IoT triggers, and automation.',
    modules: [
      'core',
      'iam',
      'customers',
      'spaces',
      'services',
      'physical',
      'automation',
    ],
  },
};

export function getFamilyPackModules(packId: FamilyPackId): CanonicalModuleId[] {
  return [...FAMILY_PACKS[packId].modules];
}

export function expandFamilyPacks(packIds: readonly FamilyPackId[]): CanonicalModuleId[] {
  const seen = new Set<CanonicalModuleId>();
  const result: CanonicalModuleId[] = [];
  for (const packId of packIds) {
    for (const mod of FAMILY_PACKS[packId].modules) {
      if (!seen.has(mod)) {
        seen.add(mod);
        result.push(mod);
      }
    }
  }
  return result;
}
