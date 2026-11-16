import { iamOrganizations, type ShacD1Database } from '@shac/db-d1';
import { defineCommand } from '@shac/kernel';
import { and, asc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { normalizeOrgPath, orgSummarySchema } from './orgs-create.js';

const listOrgsInputSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  includeInactive: z.coerce.boolean().default(false),
});

const listOrgsOutputSchema = z.object({
  items: z.array(orgSummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export const iamOrgsListCommand = defineCommand<
  typeof listOrgsInputSchema,
  z.infer<typeof listOrgsOutputSchema>,
  ShacD1Database
>({
  id: 'iam.orgs.list',
  moduleId: 'iam',
  method: 'GET',
  path: '/api/iam/orgs',
  summary: 'List organizations within the tenant and authorized org subtree',
  requiredPermission: 'iam.orgs.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description: 'List organizations scoped by tenantId and orgPath using a single D1 batch',
  },
  inputSchema: listOrgsInputSchema,
  outputSchema: listOrgsOutputSchema,
  async handler(ctx, input) {
    const normalizedPath = normalizeOrgPath(ctx.orgPath);
    const subtreeFilter =
      normalizedPath === '/'
        ? or(
            eq(iamOrganizations.treePath, '/'),
            like(iamOrganizations.treePath, '/%'),
          )
        : or(
            eq(iamOrganizations.treePath, normalizedPath),
            like(iamOrganizations.treePath, `${normalizedPath}/%`),
          );

    const conditions = [
      eq(iamOrganizations.tenantId, ctx.tenantId),
      isNull(iamOrganizations.deletedAt),
      subtreeFilter,
    ];

    if (!input.includeInactive) {
      conditions.push(eq(iamOrganizations.isActive, true));
    }

    const whereClause = and(...conditions);

    const itemsQuery = ctx.db
      .select({
        id: iamOrganizations.id,
        tenantId: iamOrganizations.tenantId,
        parentId: iamOrganizations.parentId,
        rootId: iamOrganizations.rootId,
        treePath: iamOrganizations.treePath,
        depth: iamOrganizations.depth,
        slug: iamOrganizations.slug,
        name: iamOrganizations.name,
        orgKind: iamOrganizations.orgKind,
        timezone: iamOrganizations.timezone,
        isPrimary: iamOrganizations.isPrimary,
        isActive: iamOrganizations.isActive,
        createdAt: iamOrganizations.createdAt,
      })
      .from(iamOrganizations)
      .where(whereClause)
      .orderBy(asc(iamOrganizations.treePath))
      .limit(input.limit)
      .offset(input.offset);

    const countQuery = ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(iamOrganizations)
      .where(whereClause);

    const [items, countRows] = await ctx.db.batch([itemsQuery, countQuery]);

    return {
      items,
      total: Number(countRows[0]?.count ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  },
});
