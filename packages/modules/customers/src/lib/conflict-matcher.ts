import { crmParties, type ShacD1Database } from '@shac/db-d1';
import { sha256Hex } from '@shac/kernel';
import { and, eq, inArray, isNull, like, or, type SQL } from 'drizzle-orm';
import { parseRolesMaskJson, type PartyRole } from './identity.js';
import { escapeSqlLike } from './scope-helpers.js';

export interface ConflictMatch {
  partyId: string;
  displayName: string;
  taxIdNumber: string | null;
  rolesMask: PartyRole[];
  matchedTerms: string[];
}

export async function searchConflictParties(
  db: ShacD1Database,
  tenantId: string,
  searchedTerms: string[],
  candidatePartyId?: string | null,
): Promise<ConflictMatch[]> {
  const uniqueTerms = Array.from(
    new Set(searchedTerms.map((t) => t.trim()).filter((t) => t.length > 0)),
  );
  if (uniqueTerms.length === 0) {
    return [];
  }

  const termChecks = await Promise.all(
    uniqueTerms.map(async (term) => {
      const normTax = term.toUpperCase().replace(/[\s.-]+/g, '');
      const taxHash = normTax.length > 0 ? await sha256Hex(normTax) : null;
      const emailHash = term.includes('@')
        ? await sha256Hex(term.toLowerCase())
        : null;
      return { term, lower: term.toLowerCase(), normTax, taxHash, emailHash };
    }),
  );

  const orClauses: SQL[] = [];
  const taxHashes: string[] = [];
  const emailHashes: string[] = [];

  for (const item of termChecks) {
    const pattern = `%${escapeSqlLike(item.term)}%`;
    orClauses.push(
      like(crmParties.displayName, pattern),
      like(crmParties.legalName, pattern),
      like(crmParties.taxIdNumber, pattern),
      like(crmParties.primaryEmail, pattern),
    );
    if (item.taxHash) taxHashes.push(item.taxHash);
    if (item.emailHash) emailHashes.push(item.emailHash);
  }

  if (taxHashes.length > 0) {
    orClauses.push(inArray(crmParties.taxIdHash, taxHashes));
  }
  if (emailHashes.length > 0) {
    orClauses.push(inArray(crmParties.emailHash, emailHashes));
  }

  const candidates = await db
    .select({
      id: crmParties.id,
      displayName: crmParties.displayName,
      legalName: crmParties.legalName,
      taxIdNumber: crmParties.taxIdNumber,
      taxIdHash: crmParties.taxIdHash,
      primaryEmail: crmParties.primaryEmail,
      emailHash: crmParties.emailHash,
      rolesMaskJson: crmParties.rolesMaskJson,
    })
    .from(crmParties)
    .where(
      and(
        eq(crmParties.tenantId, tenantId),
        isNull(crmParties.deletedAt),
        or(...orClauses),
      ),
    )
    .limit(100);

  const matches: ConflictMatch[] = [];
  for (const row of candidates) {
    if (candidatePartyId && row.id === candidatePartyId) {
      continue;
    }

    const matchedTerms = termChecks
      .filter((tc) => {
        const haystacks = [
          row.displayName,
          row.legalName,
          row.taxIdNumber,
          row.primaryEmail,
        ];
        const textMatch = haystacks.some(
          (val) => typeof val === 'string' && val.toLowerCase().includes(tc.lower),
        );
        const hashMatch =
          (tc.taxHash !== null && row.taxIdHash === tc.taxHash) ||
          (tc.emailHash !== null && row.emailHash === tc.emailHash);
        return textMatch || hashMatch;
      })
      .map((tc) => tc.term);

    if (matchedTerms.length > 0) {
      matches.push({
        partyId: row.id,
        displayName: row.displayName,
        taxIdNumber: row.taxIdNumber,
        rolesMask: parseRolesMaskJson(row.rolesMaskJson),
        matchedTerms,
      });
    }
  }

  return matches;
}
