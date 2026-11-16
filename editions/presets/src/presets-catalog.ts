import type {
  EditionPresetId,
  MarketVocabulary,
  TenantMarketProfile,
} from '@shac/kernel';
import { z } from 'zod';
import {
  CANONICAL_MODULE_IDS,
  type CanonicalModuleId,
  type FamilyPackId,
} from './family-packs.js';

export {
  getDefaultCurrencyProfile,
  REGION_DEFAULT_CURRENCIES,
  REGION_PACK_IDS,
  RegionPackIdSchema,
} from './region-packs.js';

export const EDITION_PRESET_IDS = [
  'retail-pos',
  'distro-wms',
  'tech-service',
  'hospitality-pms',
  'property-condo',
  'clinic-practice',
  'legal-psa',
  'industrial-gate',
  'omni-enterprise',
] as const satisfies readonly EditionPresetId[];

export const EditionPresetIdSchema = z.enum(EDITION_PRESET_IDS);

export type EditionEntitlements = TenantMarketProfile['entitlements'];

export interface EditionPresetDefinition {
  readonly id: EditionPresetId;
  readonly label: string;
  readonly targetMarket: string;
  readonly familyPacks: readonly FamilyPackId[];
  readonly activeModules: readonly CanonicalModuleId[];
  readonly vocabulary: MarketVocabulary;
  readonly entitlements: EditionEntitlements;
}

export const EDITION_PRESETS: Readonly<Record<EditionPresetId, EditionPresetDefinition>> = {
  'retail-pos': {
    id: 'retail-pos',
    label: 'Retail POS',
    targetMarket: 'Minimarkets, farmacias, ferreterias, tiendas',
    familyPacks: ['commerce-wms'],
    activeModules: ['core', 'iam', 'customers', 'catalog', 'pos', 'regional', 'wms'],
    vocabulary: {
      partySingular: 'Cliente',
      partyPlural: 'Clientes',
      orderSingular: 'Ticket de Venta',
      branchSingular: 'Tienda',
      spaceSingular: 'Caja',
      caseSingular: 'Reclamo',
    },
    entitlements: {
      maxBranches: 3,
      maxPosRegisters: 6,
      maxSpacesOrUnits: 10,
      aiCopilotEnabled: true,
      customEntitiesLimit: 10,
    },
  },
  'distro-wms': {
    id: 'distro-wms',
    label: 'Distro & WMS',
    targetMarket: 'Mayoristas, importadoras, distribuidoras, 3PL',
    familyPacks: ['commerce-wms'],
    activeModules: ['core', 'iam', 'customers', 'catalog', 'wms', 'regional', 'finance', 'portal'],
    vocabulary: {
      partySingular: 'Cuenta Mayorista',
      partyPlural: 'Cuentas Mayoristas',
      orderSingular: 'Orden de Despacho',
      branchSingular: 'CEDI',
      spaceSingular: 'Anden',
      caseSingular: 'RMA',
    },
    entitlements: {
      maxBranches: 5,
      maxPosRegisters: 4,
      maxSpacesOrUnits: 50,
      aiCopilotEnabled: true,
      customEntitiesLimit: 20,
    },
  },
  'tech-service': {
    id: 'tech-service',
    label: 'Tech Service',
    targetMarket: 'Talleres tecnicos, integradores IT, soporte',
    familyPacks: ['commerce-wms', 'cases-practice'],
    activeModules: ['core', 'iam', 'customers', 'catalog', 'pos', 'wms', 'services', 'portal'],
    vocabulary: {
      partySingular: 'Cliente',
      partyPlural: 'Clientes',
      orderSingular: 'Orden de Servicio',
      branchSingular: 'Sede Tecnica',
      spaceSingular: 'Banco de Trabajo',
      caseSingular: 'Garantia RMA',
    },
    entitlements: {
      maxBranches: 3,
      maxPosRegisters: 4,
      maxSpacesOrUnits: 20,
      aiCopilotEnabled: true,
      customEntitiesLimit: 15,
    },
  },
  'hospitality-pms': {
    id: 'hospitality-pms',
    label: 'Hospitality PMS',
    targetMarket: 'Hoteles, posadas, resorts, apart-hoteles',
    familyPacks: ['spaces-stays', 'physical-iot'],
    activeModules: [
      'core', 'iam', 'customers', 'catalog', 'spaces', 'pos', 'services', 'portal', 'physical',
    ],
    vocabulary: {
      partySingular: 'Huesped',
      partyPlural: 'Huespedes',
      orderSingular: 'Reserva & Folio',
      branchSingular: 'Propiedad',
      spaceSingular: 'Habitacion',
      caseSingular: 'Housekeeping',
    },
    entitlements: {
      maxBranches: 2,
      maxPosRegisters: 4,
      maxSpacesOrUnits: 100,
      aiCopilotEnabled: true,
      customEntitiesLimit: 15,
    },
  },
  'property-condo': {
    id: 'property-condo',
    label: 'Property & Condo',
    targetMarket: 'Condominios, edificios en renta, centros comerciales',
    familyPacks: ['spaces-stays', 'physical-iot'],
    activeModules: [
      'core', 'iam', 'customers', 'spaces', 'leases', 'services', 'finance', 'portal', 'physical',
    ],
    vocabulary: {
      partySingular: 'Residente-Inquilino',
      partyPlural: 'Residentes-Inquilinos',
      orderSingular: 'Estado de Cuenta',
      branchSingular: 'Complejo',
      spaceSingular: 'Unidad',
      caseSingular: 'Ticket Mant.',
    },
    entitlements: {
      maxBranches: 5,
      maxPosRegisters: 2,
      maxSpacesOrUnits: 250,
      aiCopilotEnabled: true,
      customEntitiesLimit: 20,
    },
  },
  'clinic-practice': {
    id: 'clinic-practice',
    label: 'Clinic Practice',
    targetMarket: 'Clinicas, consultorios, odontologia, salud mental/ABA',
    familyPacks: ['cases-practice', 'spaces-stays'],
    activeModules: [
      'core', 'iam', 'customers', 'catalog', 'spaces', 'cases', 'services', 'finance', 'portal', 'automation',
    ],
    vocabulary: {
      partySingular: 'Paciente',
      partyPlural: 'Pacientes',
      orderSingular: 'Superbill-Consulta',
      branchSingular: 'Sede Clinica',
      spaceSingular: 'Consultorio',
      caseSingular: 'Historia Clinica',
    },
    entitlements: {
      maxBranches: 3,
      maxPosRegisters: 4,
      maxSpacesOrUnits: 30,
      aiCopilotEnabled: true,
      customEntitiesLimit: 25,
    },
  },
  'legal-psa': {
    id: 'legal-psa',
    label: 'Legal & PSA',
    targetMarket: 'Bufetes de abogados, contadores, agencias, consultoras',
    familyPacks: ['cases-practice'],
    activeModules: [
      'core', 'iam', 'customers', 'spaces', 'cases', 'finance', 'portal', 'automation',
    ],
    vocabulary: {
      partySingular: 'Representado',
      partyPlural: 'Representados',
      orderSingular: 'Minuta Honorarios',
      branchSingular: 'Firma',
      spaceSingular: 'Despacho',
      caseSingular: 'Expediente',
    },
    entitlements: {
      maxBranches: 3,
      maxPosRegisters: 1,
      maxSpacesOrUnits: 25,
      aiCopilotEnabled: true,
      customEntitiesLimit: 25,
    },
  },
  'industrial-gate': {
    id: 'industrial-gate',
    label: 'Industrial Gate',
    targetMarket: 'Parques industriales, estacionamientos, clubes, flotas',
    familyPacks: ['physical-iot', 'spaces-stays'],
    activeModules: [
      'core', 'iam', 'customers', 'spaces', 'services', 'physical', 'automation',
    ],
    vocabulary: {
      partySingular: 'Residente-Chofer',
      partyPlural: 'Residentes-Choferes',
      orderSingular: 'Pase de Acceso',
      branchSingular: 'Parque',
      spaceSingular: 'Garita-Muelle',
      caseSingular: 'Incidente',
    },
    entitlements: {
      maxBranches: 4,
      maxPosRegisters: 2,
      maxSpacesOrUnits: 120,
      aiCopilotEnabled: true,
      customEntitiesLimit: 15,
    },
  },
  'omni-enterprise': {
    id: 'omni-enterprise',
    label: 'Omni Enterprise',
    targetMarket: 'Grupos empresariales hibridos multi-unidad',
    familyPacks: ['commerce-wms', 'spaces-stays', 'cases-practice', 'physical-iot'],
    activeModules: [...CANONICAL_MODULE_IDS],
    vocabulary: {
      partySingular: 'Cuenta',
      partyPlural: 'Cuentas',
      orderSingular: 'Operacion',
      branchSingular: 'Unidad de Negocio',
      spaceSingular: 'Espacio',
      caseSingular: 'Caso',
    },
    entitlements: {
      maxBranches: 50,
      maxPosRegisters: 100,
      maxSpacesOrUnits: 1000,
      aiCopilotEnabled: true,
      customEntitiesLimit: 100,
    },
  },
};

export function getEditionPreset(presetId: EditionPresetId): EditionPresetDefinition {
  return EDITION_PRESETS[presetId];
}
