import {
  crmParties,
  crmPartyProfiles,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand, sha256Hex } from '@shac/kernel';
import { and, asc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { partyKindSchema, partyRoleSchema } from '../lib/identity.js';
import { buildOrgSubtreeFilter, escapeSqlLike } from '../lib/scope-helpers.js';
import { mapPartyRow, partySummarySchema } from './parties-schemas.js';

const listPartiesInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  role: partyRoleSchema.optional(),
  partyKind: partyKindSchema.optional(),
  search: z.string().max(120).optional(),
  includeInactive: z.coerce.boolean().default(false),
});

const listPartiesOutputSchema = z.object({
  items: z.array(partySummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export const customersPartiesListCommand = defineCommand<
  typeof listPartiesInputSchema,
  z.infer<typeof listPartiesOutputSchema>,
  ShacD1Database
>({
  id: 'customers.parties.list',
  moduleId: 'customers',
  method: 'GET',
  path: '/api/customers/parties',
  summary: 'List unified parties within tenant and org subtree using <= 2 D1 queries',
  requiredPermission: 'customers.parties.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description: 'List parties scoped by tenantId and orgPath subtree via a single D1 batch',
  },
  inputSchema: listPartiesInputSchema,
  outputSchema: listPartiesOutputSchema,
  async handler(ctx, input) {
    const conditions = [
      eq(crmParties.tenantId, ctx.tenantId),
      isNull(crmParties.deletedAt),
      buildOrgSubtreeFilter(ctx),
    ];

    if (!input.includeInactive) {
      conditions.push(eq(crmParties.isActive, true));
    }
    if (input.partyKind) {
      conditions.push(eq(crmParties.partyKind, input.partyKind));
    }
    if (input.role) {
      conditions.push(like(crmParties.rolesMaskJson, `%"${input.role}"%`));
    }

    const trimmedSearch = input.search?.trim();
    if (trimmedSearch) {
      const pattern = `%${escapeSqlLike(trimmedSearch)}%`;
      const normalizedTax = trimmedSearch
        .toUpperCase()
        .replace(/[\s.-]+/g, '');
      const searchConds = [
        like(crmParties.displayName, pattern),
        like(crmParties.legalName, pattern),
        like(crmParties.taxIdNumber, pattern),
        like(crmParties.primaryEmail, pattern),
      ];
      if (normalizedTax.length > 0) {
        const taxHash = await sha256Hex(normalizedTax);
        searchConds.push(eq(crmParties.taxIdHash, taxHash));
      }
      const searchOr = or(...searchConds);
      if (searchOr) {
        conditions.push(searchOr);
      }
    }

    const whereClause = and(...conditions);

    const itemsQuery = ctx.db
      .select({
        party: crmParties,
        profile: crmPartyProfiles,
      })
      .from(crmParties)
      .leftJoin(
        crmPartyProfiles,
        and(
          eq(crmPartyProfiles.partyId, crmParties.id),
          eq(crmPartyProfiles.tenantId, crmParties.tenantId),
        ),
      )
      .where(whereClause)
      .orderBy(asc(crmParties.displayName), asc(crmParties.id))
      .limit(input.limit)
      .offset(input.offset);

    const countQuery = ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(crmParties)
      .where(whereClause);

    const [rows, countRows] = await ctx.db.batch([itemsQuery, countQuery]);

    return {
      items: rows.map((r) => mapPartyRow(r.party, r.profile)),
      total: Number(countRows[0]?.count ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  },
});
