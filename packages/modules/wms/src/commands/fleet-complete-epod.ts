import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  wmsFleetAndDeliveries,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { assertWmsResourceScope, resolveWmsTargetOrg } from '../lib/scope.js';
import type { WmsBatchOp } from './pickings-batch-ops.js';
import {
  completeEpodInputSchema,
  completeEpodOutputSchema,
} from './wms-schemas.js';

export const wmsFleetCompleteEpodCommand = defineCommand<
  typeof completeEpodInputSchema,
  z.infer<typeof completeEpodOutputSchema>,
  ShacD1Database
>({
  id: 'wms.fleet.complete_epod',
  moduleId: 'wms',
  method: 'POST',
  path: '/api/wms/fleet/epod',
  summary:
    'Validate vehicle capacity/cold-chain and record e-POD signature, R2 photo key, and GPS coords',
  requiredPermission: 'wms.fleet.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Complete fleet delivery e-POD after enforcing vehicle maxWeightGrams, maxPallets, and isRefrigerated',
  },
  inputSchema: completeEpodInputSchema,
  outputSchema: completeEpodOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({ commandId: 'wms.fleet.complete_epod', ...input }),
    );
    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      completeEpodOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveWmsTargetOrg(ctx, input.orgId);

    const [vehicleRows, tripRows] = await ctx.db.batch([
      ctx.db
        .select()
        .from(wmsFleetAndDeliveries)
        .where(
          and(
            eq(wmsFleetAndDeliveries.id, input.vehicleId),
            eq(wmsFleetAndDeliveries.recordKind, 'vehicle'),
            isNull(wmsFleetAndDeliveries.deletedAt),
          ),
        )
        .limit(1),
      input.deliveryTripId
        ? ctx.db
            .select()
            .from(wmsFleetAndDeliveries)
            .where(
              and(
                eq(wmsFleetAndDeliveries.id, input.deliveryTripId),
                eq(wmsFleetAndDeliveries.recordKind, 'delivery_trip'),
                isNull(wmsFleetAndDeliveries.deletedAt),
              ),
            )
            .limit(1)
        : ctx.db
            .select()
            .from(wmsFleetAndDeliveries)
            .where(eq(wmsFleetAndDeliveries.id, '__none__'))
            .limit(1),
    ]);

    const vehicle = vehicleRows[0];
    await assertWmsResourceScope(ctx, vehicle, 'Fleet vehicle');
    const existingTrip = input.deliveryTripId ? tripRows[0] : undefined;
    if (input.deliveryTripId) {
      await assertWmsResourceScope(ctx, existingTrip, 'Delivery trip');
    }

    if (input.requiresColdChain && !vehicle!.isRefrigerated) {
      throw new AppError(
        'COLD_CHAIN_REQUIRED',
        422,
        `Vehicle ${vehicle!.vehicleCode ?? vehicle!.id} is not refrigerated for cold-chain cargo`,
        { vehicleId: vehicle!.id, isRefrigerated: vehicle!.isRefrigerated },
      );
    }

    const overWeight =
      vehicle!.maxWeightGrams !== null &&
      input.loadWeightGrams > vehicle!.maxWeightGrams;
    const overPallets =
      vehicle!.maxPallets !== null && input.loadPallets > vehicle!.maxPallets;
    if (overWeight || overPallets) {
      throw new AppError(
        'VEHICLE_CAPACITY_EXCEEDED',
        422,
        'Cargo exceeds vehicle maxWeightGrams or maxPallets limit',
        {
          vehicleId: vehicle!.id,
          loadWeightGrams: input.loadWeightGrams,
          maxWeightGrams: vehicle!.maxWeightGrams,
          loadPallets: input.loadPallets,
          maxPallets: vehicle!.maxPallets,
        },
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const deliveryTripId = existingTrip?.id ?? crypto.randomUUID();
    const orderId = input.orderId ?? existingTrip?.orderId ?? null;
    const breadcrumbsJson = JSON.stringify(input.gpsBreadcrumbs);

    const tripOp: WmsBatchOp = existingTrip
      ? ctx.db
          .update(wmsFleetAndDeliveries)
          .set({
            vehicleCode: vehicle!.vehicleCode,
            licensePlate: vehicle!.licensePlate,
            maxPallets: vehicle!.maxPallets,
            maxWeightGrams: vehicle!.maxWeightGrams,
            isRefrigerated: vehicle!.isRefrigerated,
            orderId,
            gpsBreadcrumbsJson: breadcrumbsJson,
            arrivedAt: nowSec,
            epodRecipientName: input.epodRecipientName,
            epodSignatureSvg: input.epodSignatureSvg,
            epodPhotoR2Key: input.epodPhotoR2Key,
            epodLat: input.epodLat,
            epodLng: input.epodLng,
            autoRestocked: input.autoRestocked,
            autoInvoiced: input.autoInvoiced,
            status: 'delivered',
            version: existingTrip.version + 1,
            updatedAt: nowSec,
          })
          .where(
            and(
              eq(wmsFleetAndDeliveries.tenantId, ctx.tenantId),
              eq(wmsFleetAndDeliveries.id, deliveryTripId),
            ),
          )
      : ctx.db.insert(wmsFleetAndDeliveries).values({
          id: deliveryTripId,
          tenantId: ctx.tenantId,
          orgId: targetOrgId,
          recordKind: 'delivery_trip',
          vehicleCode: vehicle!.vehicleCode,
          licensePlate: vehicle!.licensePlate,
          maxPallets: vehicle!.maxPallets,
          maxWeightGrams: vehicle!.maxWeightGrams,
          isRefrigerated: vehicle!.isRefrigerated,
          driverStaffId: vehicle!.driverStaffId,
          orderId,
          gpsBreadcrumbsJson: breadcrumbsJson,
          departedAt: nowSec,
          arrivedAt: nowSec,
          epodRecipientName: input.epodRecipientName,
          epodSignatureSvg: input.epodSignatureSvg,
          epodPhotoR2Key: input.epodPhotoR2Key,
          epodLat: input.epodLat,
          epodLng: input.epodLng,
          autoRestocked: input.autoRestocked,
          autoInvoiced: input.autoInvoiced,
          status: 'delivered',
          createdAt: nowSec,
          updatedAt: nowSec,
        });

    const response: z.infer<typeof completeEpodOutputSchema> = {
      ok: true,
      deliveryTripId,
      vehicleId: vehicle!.id,
      vehicleCode: vehicle!.vehicleCode,
      orderId,
      status: 'delivered',
      epodRecipientName: input.epodRecipientName,
      epodPhotoR2Key: input.epodPhotoR2Key,
      epodLat: input.epodLat,
      epodLng: input.epodLng,
      arrivedAt: nowSec,
    };
    const responseJson = JSON.stringify(response);

    await ctx.db.batch([
      tripOp,
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'wms.fleet.complete_epod',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'wms.fleet.complete_epod',
        resourceKind: 'wms_delivery_trip',
        resourceId: deliveryTripId,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return response;
  },
});
