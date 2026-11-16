import {
  assertOrgScope,
  crmParties,
  crmPartyProfiles,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import type { ExecutionContext } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import {
  profileSelectFields,
  type upsertPartyInputSchema,
} from './parties-schemas.js';

type UpsertInput = z.infer<typeof upsertPartyInputSchema>;

export async function findExistingPartyForUpsert(
  ctx: ExecutionContext<ShacD1Database>,
  id: string | undefined,
  taxIdHash: string | null,
) {
  const whereExpr = id
    ? and(eq(crmParties.id, id), isNull(crmParties.deletedAt))
    : taxIdHash
      ? and(
          eq(crmParties.tenantId, ctx.tenantId),
          eq(crmParties.taxIdHash, taxIdHash),
          isNull(crmParties.deletedAt),
        )
      : null;

  if (!whereExpr) return null;

  const rows = await ctx.db
    .select({
      party: crmParties,
      orgTreePath: iamOrganizations.treePath,
      profile: profileSelectFields,
    })
    .from(crmParties)
    .leftJoin(
      iamOrganizations,
      and(
        eq(crmParties.orgId, iamOrganizations.id),
        eq(crmParties.tenantId, iamOrganizations.tenantId),
        isNull(iamOrganizations.deletedAt),
      ),
    )
    .leftJoin(
      crmPartyProfiles,
      and(
        eq(crmPartyProfiles.partyId, crmParties.id),
        eq(crmPartyProfiles.tenantId, crmParties.tenantId),
      ),
    )
    .where(whereExpr)
    .limit(1);

  const hit = rows[0];
  if (!hit) return null;

  const effectiveOrgPath =
    hit.orgTreePath ??
    (hit.party.orgId === ctx.orgId ? ctx.orgPath : '/__out_of_scope__');
  assertOrgScope(ctx, hit.party.tenantId, effectiveOrgPath);
  return hit;
}

export function buildMutablePartyFields(
  input: UpsertInput,
  dedupedRoles: string[],
  identity: {
    taxIdNumber: string | null;
    taxIdHash: string | null;
    primaryEmail: string | null;
    emailHash: string | null;
  },
  version: number,
  nowSec: number,
) {
  return {
    partyKind: input.partyKind,
    rolesMaskJson: JSON.stringify(dedupedRoles),
    displayName: input.displayName,
    legalName: input.legalName ?? null,
    firstName: input.firstName ?? null,
    middleName: input.middleName ?? null,
    lastName: input.lastName ?? null,
    secondLastName: input.secondLastName ?? null,
    nationality: input.nationality ?? null,
    taxIdType: input.taxIdType ?? null,
    taxIdNumber: identity.taxIdNumber,
    taxIdHash: identity.taxIdHash,
    primaryEmail: identity.primaryEmail,
    emailHash: identity.emailHash,
    primaryPhone: input.primaryPhone ?? null,
    secondaryPhone: input.secondaryPhone ?? null,
    ownerUserId: input.ownerUserId ?? null,
    lifecycleStage: input.lifecycleStage,
    leadSource: input.leadSource ?? null,
    temperature: input.temperature ?? null,
    vipStatus: input.vipStatus,
    loyaltyPoints: input.loyaltyPoints,
    creditLimitMinor: input.creditLimitMinor,
    preferredCurrency: input.preferredCurrency,
    paymentTermsCode: input.paymentTermsCode ?? null,
    is1099Vendor: input.is1099Vendor,
    isActive: input.isActive,
    customFields: JSON.stringify(input.customFields),
    version,
    updatedAt: nowSec,
  };
}

export function buildMutableProfileFields(
  profile: NonNullable<UpsertInput['profile']>,
  nowSec: number,
) {
  return {
    birthDate: profile.birthDate ?? null,
    gender: profile.gender ?? null,
    maritalStatus: profile.maritalStatus ?? null,
    preferredLanguage: profile.preferredLanguage ?? null,
    occupation: profile.occupation ?? null,
    employerName: profile.employerName ?? null,
    annualIncomeMinor: profile.annualIncomeMinor ?? null,
    screeningScore: profile.screeningScore ?? null,
    mrnCode: profile.mrnCode ?? null,
    guestPreferencesJson: JSON.stringify(profile.guestPreferences),
    hasEvictions: profile.hasEvictions,
    agreedCreditCheck: profile.agreedCreditCheck,
    notes: profile.notes ?? null,
    updatedAt: nowSec,
  };
}
