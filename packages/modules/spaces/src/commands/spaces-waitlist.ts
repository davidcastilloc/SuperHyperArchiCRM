import {
  assertOrgScope,
  kernelIdempotencyKeys,
  spcWaitlist,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import {
  buildIdempotencyInsert,
  computeCommandRequestHash,
  nowEpochSec,
  resolveOrgId,
} from '../lib/spaces-helpers.js';
import {
  spacesWaitlistManageInputSchema,
  spacesWaitlistManageOutputSchema,
} from './spaces-schemas.js';

export const spacesWaitlistManageCommand = defineCommand<
  typeof spacesWaitlistManageInputSchema,
  z.infer<typeof spacesWaitlistManageOutputSchema>,
  ShacD1Database
>({
  id: 'spaces.waitlist.manage',
  moduleId: 'spaces',
  method: 'POST',
  path: '/api/spaces/waitlist',
  summary: 'Add, promote, or cancel a space waitlist entry',
  requiredPermission: 'spaces.bookings.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Manage spc_waitlist entries (ADD, PROMOTE, CANCEL) with idempotency',
  },
  inputSchema: spacesWaitlistManageInputSchema,
  outputSchema: spacesWaitlistManageOutputSchema,
  async handler(ctx, input) {
    assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);
    const orgId = resolveOrgId(ctx, input.orgId);

    if (input.action === 'ADD' && !input.partyId) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'partyId is required when action is ADD',
      );
    }
    if (input.action !== 'ADD' && !input.waitlistId) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'waitlistId is required when action is PROMOTE or CANCEL',
      );
    }

    const requestHash = await computeCommandRequestHash(
      'spaces.waitlist.manage',
      {
        orgId,
        action: input.action,
        waitlistId: input.waitlistId ?? null,
        partyId: input.partyId ?? null,
        unitTypeId: input.unitTypeId ?? null,
        priority: input.priority,
        preferredDates: input.preferredDates,
        preferredSlots: input.preferredSlots,
      },
    );

    const idemRows = await ctx.db
      .select({
        requestHash: kernelIdempotencyKeys.requestHash,
        responseJson: kernelIdempotencyKeys.responseJson,
      })
      .from(kernelIdempotencyKeys)
      .where(
        and(
          eq(kernelIdempotencyKeys.tenantId, ctx.tenantId),
          eq(kernelIdempotencyKeys.clientMutationId, input.clientMutationId),
        ),
      )
      .limit(1);

    const idemHit = idemRows[0];
    if (idemHit) {
      if (idemHit.requestHash !== requestHash) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          409,
          'clientMutationId already used with a different payload',
        );
      }
      return spacesWaitlistManageOutputSchema.parse(
        JSON.parse(idemHit.responseJson),
      );
    }

    const nowSec = nowEpochSec();

    if (input.action === 'ADD') {
      const waitlistId = `wl_${crypto.randomUUID().replace(/-/g, '')}`;
      const output: z.infer<typeof spacesWaitlistManageOutputSchema> = {
        ok: true,
        waitlistId,
        status: 'waiting',
        priority: input.priority,
      };

      await ctx.db.batch([
        ctx.db.insert(spcWaitlist).values({
          id: waitlistId,
          tenantId: ctx.tenantId,
          orgId,
          partyId: input.partyId!,
          preferredStaffId: input.preferredStaffId ?? null,
          unitTypeId: input.unitTypeId ?? null,
          priority: input.priority,
          preferredDatesJson: JSON.stringify(input.preferredDates),
          preferredSlotsJson: JSON.stringify(input.preferredSlots),
          reason: input.reason ?? null,
          status: 'waiting',
          createdAt: nowSec,
          updatedAt: nowSec,
        }),
        buildIdempotencyInsert(ctx.db, {
          tenantId: ctx.tenantId,
          orgId,
          clientMutationId: input.clientMutationId,
          commandId: 'spaces.waitlist.manage',
          requestHash,
          responseJson: JSON.stringify(output),
          nowSec,
        }),
      ]);

      return output;
    }

    const existing = await ctx.db
      .select({
        id: spcWaitlist.id,
        priority: spcWaitlist.priority,
      })
      .from(spcWaitlist)
      .where(
        and(
          eq(spcWaitlist.tenantId, ctx.tenantId),
          eq(spcWaitlist.orgId, orgId),
          eq(spcWaitlist.id, input.waitlistId!),
          isNull(spcWaitlist.deletedAt),
        ),
      )
      .limit(1);

    const row = existing[0];
    if (!row) {
      throw new AppError(
        'WAITLIST_NOT_FOUND',
        404,
        `Waitlist entry ${input.waitlistId} not found in organization ${orgId}`,
      );
    }

    const nextStatus = input.action === 'PROMOTE' ? 'promoted' : 'cancelled';
    const output: z.infer<typeof spacesWaitlistManageOutputSchema> = {
      ok: true,
      waitlistId: row.id,
      status: nextStatus,
      priority: row.priority,
    };

    await ctx.db.batch([
      ctx.db
        .update(spcWaitlist)
        .set({ status: nextStatus, updatedAt: nowSec })
        .where(
          and(eq(spcWaitlist.tenantId, ctx.tenantId), eq(spcWaitlist.id, row.id)),
        ),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId,
        clientMutationId: input.clientMutationId,
        commandId: 'spaces.waitlist.manage',
        requestHash,
        responseJson: JSON.stringify(output),
        nowSec,
      }),
    ]);

    return output;
  },
});
