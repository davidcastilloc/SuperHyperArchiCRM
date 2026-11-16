import { crmPartyProfiles } from '@shac/db-d1';
import { z } from 'zod';
import {
  nationalitySchema,
  parseJsonRecord,
  parseRolesMaskJson,
  partyKindSchema,
  partyRoleSchema,
  taxIdTypeSchema,
} from '../lib/identity.js';

export const profileSelectFields = {
  partyId: crmPartyProfiles.partyId,
  birthDate: crmPartyProfiles.birthDate,
  gender: crmPartyProfiles.gender,
  maritalStatus: crmPartyProfiles.maritalStatus,
  preferredLanguage: crmPartyProfiles.preferredLanguage,
  occupation: crmPartyProfiles.occupation,
  employerName: crmPartyProfiles.employerName,
  annualIncomeMinor: crmPartyProfiles.annualIncomeMinor,
  screeningScore: crmPartyProfiles.screeningScore,
  mrnCode: crmPartyProfiles.mrnCode,
  guestPreferencesJson: crmPartyProfiles.guestPreferencesJson,
  hasEvictions: crmPartyProfiles.hasEvictions,
  agreedCreditCheck: crmPartyProfiles.agreedCreditCheck,
  notes: crmPartyProfiles.notes,
} as const;

const partyProfileInputSchema = z.object({
  birthDate: z.string().max(32).nullable().optional(),
  gender: z.string().max(32).nullable().optional(),
  maritalStatus: z.string().max(32).nullable().optional(),
  preferredLanguage: z.string().max(16).nullable().optional(),
  occupation: z.string().max(120).nullable().optional(),
  employerName: z.string().max(160).nullable().optional(),
  annualIncomeMinor: z.number().int().nonnegative().nullable().optional(),
  screeningScore: z.number().int().nullable().optional(),
  mrnCode: z.string().max(64).nullable().optional(),
  guestPreferences: z.record(z.unknown()).default({}),
  hasEvictions: z.boolean().default(false),
  agreedCreditCheck: z.boolean().default(false),
  notes: z.string().max(2000).nullable().optional(),
});

const partyProfileOutputSchema = z.object({
  partyId: z.string(),
  birthDate: z.string().nullable(),
  gender: z.string().nullable(),
  maritalStatus: z.string().nullable(),
  preferredLanguage: z.string().nullable(),
  occupation: z.string().nullable(),
  employerName: z.string().nullable(),
  annualIncomeMinor: z.number().int().nullable(),
  screeningScore: z.number().int().nullable(),
  mrnCode: z.string().nullable(),
  guestPreferences: z.record(z.unknown()),
  hasEvictions: z.boolean(),
  agreedCreditCheck: z.boolean(),
  notes: z.string().nullable(),
});

export const partySummarySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  partyKind: partyKindSchema,
  rolesMask: z.array(partyRoleSchema),
  displayName: z.string(),
  legalName: z.string().nullable(),
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  secondLastName: z.string().nullable(),
  nationality: nationalitySchema.nullable(),
  taxIdType: taxIdTypeSchema.nullable(),
  taxIdNumber: z.string().nullable(),
  taxIdHash: z.string().nullable(),
  primaryEmail: z.string().nullable(),
  emailHash: z.string().nullable(),
  primaryPhone: z.string().nullable(),
  secondaryPhone: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  lifecycleStage: z.string(),
  leadSource: z.string().nullable(),
  temperature: z.string().nullable(),
  vipStatus: z.string(),
  loyaltyPoints: z.number().int(),
  creditLimitMinor: z.number().int().nonnegative(),
  preferredCurrency: z.string(),
  paymentTermsCode: z.string().nullable(),
  is1099Vendor: z.boolean(),
  isActive: z.boolean(),
  customFields: z.record(z.unknown()),
  version: z.number().int().positive(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  profile: partyProfileOutputSchema.nullable(),
});

export const upsertPartyInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  id: z.string().min(1).optional(),
  orgId: z.string().min(1).optional(),
  partyKind: partyKindSchema.default('person'),
  rolesMask: z.array(partyRoleSchema).min(1),
  displayName: z.string().min(1).max(200),
  legalName: z.string().max(200).nullable().optional(),
  firstName: z.string().max(120).nullable().optional(),
  middleName: z.string().max(120).nullable().optional(),
  lastName: z.string().max(120).nullable().optional(),
  secondLastName: z.string().max(120).nullable().optional(),
  nationality: nationalitySchema.nullable().optional(),
  taxIdType: taxIdTypeSchema.nullable().optional(),
  taxIdNumber: z.string().min(1).max(64).nullable().optional(),
  primaryEmail: z.string().email().max(200).nullable().optional(),
  primaryPhone: z.string().max(40).nullable().optional(),
  secondaryPhone: z.string().max(40).nullable().optional(),
  ownerUserId: z.string().max(128).nullable().optional(),
  lifecycleStage: z.string().min(1).max(64).default('active'),
  leadSource: z.string().max(64).nullable().optional(),
  temperature: z.string().max(32).nullable().optional(),
  vipStatus: z.string().min(1).max(32).default('standard'),
  loyaltyPoints: z.number().int().nonnegative().default(0),
  creditLimitMinor: z.number().int().nonnegative().default(0),
  preferredCurrency: z.string().min(3).max(8).default('USD'),
  paymentTermsCode: z.string().max(64).nullable().optional(),
  is1099Vendor: z.boolean().default(false),
  isActive: z.boolean().default(true),
  customFields: z.record(z.unknown()).default({}),
  profile: partyProfileInputSchema.optional(),
});

export type PartySummary = z.infer<typeof partySummarySchema>;
type PartyProfileOutput = z.infer<typeof partyProfileOutputSchema>;

export interface PartyRowInput {
  id: string;
  tenantId: string;
  orgId: string;
  partyKind: string;
  rolesMaskJson: string;
  displayName: string;
  legalName: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  secondLastName: string | null;
  nationality: string | null;
  taxIdType: string | null;
  taxIdNumber: string | null;
  taxIdHash: string | null;
  primaryEmail: string | null;
  emailHash: string | null;
  primaryPhone: string | null;
  secondaryPhone: string | null;
  ownerUserId: string | null;
  lifecycleStage: string;
  leadSource: string | null;
  temperature: string | null;
  vipStatus: string;
  loyaltyPoints: number;
  creditLimitMinor: number;
  preferredCurrency: string;
  paymentTermsCode: string | null;
  is1099Vendor: boolean;
  isActive: boolean;
  customFields: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface PartyProfileRowInput {
  partyId: string;
  birthDate: string | null;
  gender: string | null;
  maritalStatus: string | null;
  preferredLanguage: string | null;
  occupation: string | null;
  employerName: string | null;
  annualIncomeMinor: number | null;
  screeningScore: number | null;
  mrnCode: string | null;
  guestPreferencesJson: string;
  hasEvictions: boolean;
  agreedCreditCheck: boolean;
  notes: string | null;
}

function mapPartyProfileRow(
  row: PartyProfileRowInput | null | undefined,
): PartyProfileOutput | null {
  if (!row || !row.partyId) {
    return null;
  }
  return {
    partyId: row.partyId,
    birthDate: row.birthDate,
    gender: row.gender,
    maritalStatus: row.maritalStatus,
    preferredLanguage: row.preferredLanguage,
    occupation: row.occupation,
    employerName: row.employerName,
    annualIncomeMinor: row.annualIncomeMinor,
    screeningScore: row.screeningScore,
    mrnCode: row.mrnCode,
    guestPreferences: parseJsonRecord(row.guestPreferencesJson),
    hasEvictions: row.hasEvictions,
    agreedCreditCheck: row.agreedCreditCheck,
    notes: row.notes,
  };
}

export function mapPartyRow(
  row: PartyRowInput,
  profileRow?: PartyProfileRowInput | null,
): PartySummary {
  return {
    id: row.id,
    tenantId: row.tenantId,
    orgId: row.orgId,
    partyKind: partyKindSchema.parse(row.partyKind),
    rolesMask: parseRolesMaskJson(row.rolesMaskJson),
    displayName: row.displayName,
    legalName: row.legalName,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    secondLastName: row.secondLastName,
    nationality: row.nationality ? nationalitySchema.parse(row.nationality) : null,
    taxIdType: row.taxIdType ? taxIdTypeSchema.parse(row.taxIdType) : null,
    taxIdNumber: row.taxIdNumber,
    taxIdHash: row.taxIdHash,
    primaryEmail: row.primaryEmail,
    emailHash: row.emailHash,
    primaryPhone: row.primaryPhone,
    secondaryPhone: row.secondaryPhone,
    ownerUserId: row.ownerUserId,
    lifecycleStage: row.lifecycleStage,
    leadSource: row.leadSource,
    temperature: row.temperature,
    vipStatus: row.vipStatus,
    loyaltyPoints: row.loyaltyPoints,
    creditLimitMinor: row.creditLimitMinor,
    preferredCurrency: row.preferredCurrency,
    paymentTermsCode: row.paymentTermsCode,
    is1099Vendor: row.is1099Vendor,
    isActive: row.isActive,
    customFields: parseJsonRecord(row.customFields),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    profile: mapPartyProfileRow(profileRow),
  };
}
