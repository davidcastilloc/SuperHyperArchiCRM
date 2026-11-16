import {
  assertOrgScope,
  iamOrganizations,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
} from './idempotency.js';

export const orgSummarySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  parentId: z.string().nullable(),
  rootId: z.string(),
  treePath: z.string(),
  depth: z.number().int(),
  slug: z.string(),
  name: z.string(),
  orgKind: z.string(),
  timezone: z.string(),
  isPrimary: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.number().int(),
});

const createOrgInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  name: z.string().min(1).max(160),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, 'slug must contain lowercase letters, numbers, or hyphens'),
  orgKind: z
    .enum(['company', 'region', 'branch', 'warehouse', 'clinic', 'department'])
    .default('branch'),
  parentId: z.string().min(1).optional(),
  timezone: z.string().min(1).default('UTC'),
  isPrimary: z.boolean().default(false),
});

export function normalizeOrgPath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

export const iamOrgsCreateCommand = defineCommand<
  typeof createOrgInputSchema,
  z.infer<typeof orgSummarySchema>,
  ShacD1Database
>({
  id: 'iam.orgs.create',
  moduleId: 'iam',
  method: 'POST',
  path: '/api/iam/orgs',
  summary: 'Create an organization or branch within the authorized org subtree',
  requiredPermission: 'iam.orgs.create',
  mcp: {
    expose: true,
    idempotentHint: true,
    description: 'Create an organization or branch scoped to the current tenant and orgPath',
  },
  inputSchema: createOrgInputSchema,
  outputSchema: orgSummarySchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'iam.orgs.create',
        name: input.name,
        slug: input.slug,
        orgKind: input.orgKind,
        parentId: input.parentId ?? null,
        timezone: input.timezone,
        isPrimary: input.isPrimary,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      orgSummarySchema,
    );
    if (replay) {
      return replay;
    }

    const parentId = input.parentId ?? null;
    let parentTreePath = normalizeOrgPath(ctx.orgPath);
    let parentDepth =
      parentTreePath === '/' ? 0 : parentTreePath.split('/').filter(Boolean).length;
    let rootId = ctx.orgId;

    if (parentId) {
      const parentRows = await ctx.db
        .select({
          id: iamOrganizations.id,
          tenantId: iamOrganizations.tenantId,
          treePath: iamOrganizations.treePath,
          depth: iamOrganizations.depth,
          rootId: iamOrganizations.rootId,
        })
        .from(iamOrganizations)
        .where(
          and(
            eq(iamOrganizations.tenantId, ctx.tenantId),
            eq(iamOrganizations.id, parentId),
            isNull(iamOrganizations.deletedAt),
          ),
        )
        .limit(1);

      const parent = parentRows[0];
      if (!parent) {
        throw new AppError('NOT_FOUND', 404, 'Parent organization not found');
      }
      assertOrgScope(ctx, parent.tenantId, parent.treePath);
      parentTreePath = normalizeOrgPath(parent.treePath);
      parentDepth = parent.depth;
      rootId = parent.rootId;
    } else {
      assertOrgScope(ctx, ctx.tenantId, parentTreePath);
    }

    const orgId = crypto.randomUUID();
    const treePath =
      parentTreePath === '/' ? `/${input.slug}` : `${parentTreePath}/${input.slug}`;
    const nowSec = Math.floor(Date.now() / 1000);

    const created: z.infer<typeof orgSummarySchema> = {
      id: orgId,
      tenantId: ctx.tenantId,
      parentId,
      rootId,
      treePath,
      depth: parentDepth + 1,
      slug: input.slug,
      name: input.name,
      orgKind: input.orgKind,
      timezone: input.timezone,
      isPrimary: input.isPrimary,
      isActive: true,
      createdAt: nowSec,
    };

    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(iamOrganizations).values({
        ...created,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        clientMutationId: input.clientMutationId,
        commandId: 'iam.orgs.create',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: ctx.orgId,
        actor: ctx.actor,
        commandId: 'iam.orgs.create',
        resourceKind: 'iam_organization',
        resourceId: orgId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});
