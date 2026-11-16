import {
  buildActionLogInsert,
  phyAccessPasses,
  phyDevicesAndLocks,
  phyLockerReservations,
  phySmartLockers,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { sha256DigestHex, timingSafeEqualStrings } from '../lib/crypto.js';
import {
  parseStringArray,
  resolveScopedTargetOrg,
} from '../lib/scope-helpers.js';

const validatePassInputSchema = z.object({
  orgId: z.string().min(1).optional(),
  passId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  lockerId: z.string().min(1).optional(),
  pinOrQrSecret: z.string().min(1).max(256),
  nowSec: z.number().int().positive().optional(),
});

const validatePassOutputSchema = z.object({
  valid: z.literal(true),
  targetKind: z.enum(['ACCESS_PASS', 'LOCKER_RESERVATION']),
  recordId: z.string(),
  orgId: z.string(),
  unlockedDeviceId: z.string().nullable(),
  unlockedLockerId: z.string().nullable(),
  status: z.string(),
  validatedAt: z.number().int(),
});

export const physicalPassesValidateCommand = defineCommand<
  typeof validatePassInputSchema,
  z.infer<typeof validatePassOutputSchema>,
  ShacD1Database
>({
  id: 'physical.passes.validate',
  moduleId: 'physical',
  method: 'POST',
  path: '/api/physical/passes/validate',
  summary:
    'Validate a PIN/QR pass in constant time and unlock a smart lock or smart locker',
  requiredPermission: 'physical.passes.validate',
  mcp: {
    expose: true,
    idempotentHint: false,
    description:
      'Constant-time pass validation (XOR over bytes) with smart lock/locker unlock; rejects invalid/expired/revoked passes with 403',
  },
  inputSchema: validatePassInputSchema,
  outputSchema: validatePassOutputSchema,
  async handler(ctx, input) {
    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);
    const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
    const candidateHash = await sha256DigestHex(input.pinOrQrSecret);

    if (input.lockerId) {
      const reservations = await ctx.db
        .select()
        .from(phyLockerReservations)
        .where(
          and(
            eq(phyLockerReservations.tenantId, ctx.tenantId),
            eq(phyLockerReservations.orgId, targetOrgId),
            eq(phyLockerReservations.lockerId, input.lockerId),
            isNull(phyLockerReservations.deletedAt),
          ),
        );

      let matchedReservation: (typeof reservations)[number] | null = null;
      for (const row of reservations) {
        if (timingSafeEqualStrings(candidateHash, row.pickupQrOrPinHash)) {
          matchedReservation = row;
        }
      }

      if (
        !matchedReservation ||
        matchedReservation.status !== 'RESERVED' ||
        nowSec < matchedReservation.reservedFrom ||
        nowSec > matchedReservation.expiresAt
      ) {
        throw new AppError(
          'FORBIDDEN',
          403,
          'Invalid, expired, or revoked locker pickup pass',
        );
      }

      await ctx.db.batch([
        ctx.db
          .update(phyLockerReservations)
          .set({
            status: 'PICKED_UP',
            pickedUpAt: nowSec,
            version: matchedReservation.version + 1,
            updatedAt: nowSec,
          })
          .where(eq(phyLockerReservations.id, matchedReservation.id)),
        ctx.db
          .update(phySmartLockers)
          .set({
            doorState: 'OPEN_UNLOCKED',
            occupancyStatus: 'AVAILABLE',
            updatedAt: nowSec,
          })
          .where(
            and(
              eq(phySmartLockers.id, input.lockerId),
              eq(phySmartLockers.tenantId, ctx.tenantId),
              eq(phySmartLockers.orgId, targetOrgId),
            ),
          ),
        buildActionLogInsert(ctx.db, {
          tenantId: ctx.tenantId,
          orgId: targetOrgId,
          actor: ctx.actor,
          commandId: 'physical.passes.validate',
          resourceKind: 'phy_locker_reservation',
          resourceId: matchedReservation.id,
          snapshotAfterJson: JSON.stringify({
            status: 'PICKED_UP',
            lockerId: input.lockerId,
          }),
          nowSec,
        }),
      ]);

      return {
        valid: true,
        targetKind: 'LOCKER_RESERVATION',
        recordId: matchedReservation.id,
        orgId: targetOrgId,
        unlockedDeviceId: null,
        unlockedLockerId: input.lockerId,
        status: 'PICKED_UP',
        validatedAt: nowSec,
      };
    }

    const passConditions = [
      eq(phyAccessPasses.tenantId, ctx.tenantId),
      eq(phyAccessPasses.orgId, targetOrgId),
      isNull(phyAccessPasses.deletedAt),
    ];
    if (input.passId) {
      passConditions.push(eq(phyAccessPasses.id, input.passId));
    }

    const passes = await ctx.db
      .select()
      .from(phyAccessPasses)
      .where(and(...passConditions));

    let matchedPass: (typeof passes)[number] | null = null;
    for (const row of passes) {
      if (timingSafeEqualStrings(candidateHash, row.pinOrQrHash)) {
        matchedPass = row;
      }
    }

    if (
      !matchedPass ||
      matchedPass.status !== 'ACTIVE' ||
      nowSec < matchedPass.validFrom ||
      nowSec > matchedPass.validUntil ||
      (matchedPass.maxUses !== null &&
        matchedPass.useCount >= matchedPass.maxUses)
    ) {
      throw new AppError(
        'FORBIDDEN',
        403,
        'Invalid, expired, or revoked access pass',
      );
    }

    const allowedDevices = parseStringArray(matchedPass.allowedDeviceIdsJson);
    if (
      input.deviceId &&
      allowedDevices.length > 0 &&
      !allowedDevices.includes(input.deviceId)
    ) {
      throw new AppError(
        'FORBIDDEN',
        403,
        'Access pass is not authorized for this device',
      );
    }

    const nextUseCount = matchedPass.useCount + 1;
    const nextStatus =
      matchedPass.maxUses !== null && nextUseCount >= matchedPass.maxUses
        ? 'EXHAUSTED'
        : 'ACTIVE';

    const passUpdate = ctx.db
      .update(phyAccessPasses)
      .set({
        useCount: nextUseCount,
        status: nextStatus,
        version: matchedPass.version + 1,
        updatedAt: nowSec,
      })
      .where(eq(phyAccessPasses.id, matchedPass.id));

    const actionLogInsert = buildActionLogInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      actor: ctx.actor,
      commandId: 'physical.passes.validate',
      resourceKind: 'phy_access_pass',
      resourceId: matchedPass.id,
      targetPartyId: matchedPass.partyId ?? undefined,
      snapshotAfterJson: JSON.stringify({
        status: nextStatus,
        useCount: nextUseCount,
        deviceId: input.deviceId ?? null,
      }),
      nowSec,
    });

    if (input.deviceId) {
      await ctx.db.batch([
        passUpdate,
        actionLogInsert,
        ctx.db
          .update(phyDevicesAndLocks)
          .set({
            lockState: 'UNLOCKED',
            updatedAt: nowSec,
          })
          .where(
            and(
              eq(phyDevicesAndLocks.id, input.deviceId),
              eq(phyDevicesAndLocks.tenantId, ctx.tenantId),
              eq(phyDevicesAndLocks.orgId, targetOrgId),
            ),
          ),
      ]);
    } else {
      await ctx.db.batch([passUpdate, actionLogInsert]);
    }

    return {
      valid: true,
      targetKind: 'ACCESS_PASS',
      recordId: matchedPass.id,
      orgId: targetOrgId,
      unlockedDeviceId: input.deviceId ?? null,
      unlockedLockerId: null,
      status: nextStatus,
      validatedAt: nowSec,
    };
  },
});
