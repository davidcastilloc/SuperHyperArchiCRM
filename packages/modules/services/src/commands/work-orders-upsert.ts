import {
  assertOrgScope,
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  iamOrganizations,
  srvWorkOrders,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import {
  buildPartyScopeQuery,
  buildUnitScopeQuery,
  parseJsonRecord,
  resolveScopedTargetOrg,
  verifyScopedRow,
} from '../lib/scope-helpers.js';
import {
  upsertWorkOrderInputSchema,
  workOrderOutputSchema,
} from './work-orders-schemas.js';

export const servicesWorkOrdersUpsertCommand = defineCommand<
  typeof upsertWorkOrderInputSchema,
  z.infer<typeof workOrderOutputSchema>,
  ShacD1Database
>({
  id: 'services.work_orders.upsert',
  moduleId: 'services',
  method: 'POST',
  path: '/api/services/work-orders',
  summary: 'Create or update a field service, workshop repair, or facility work order',
  requiredPermission: 'services.work_orders.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description: 'Create or update a work order with integer labor/parts minor costs',
  },
  inputSchema: upsertWorkOrderInputSchema,
  outputSchema: workOrderOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'services.work_orders.upsert',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      workOrderOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    if (input.partyId) {
      const partyRows = await buildPartyScopeQuery(ctx.db, input.partyId);
      verifyScopedRow(ctx, partyRows[0], 'Customer party');
    }
    if (input.unitId) {
      const unitRows = await buildUnitScopeQuery(ctx.db, input.unitId);
      verifyScopedRow(ctx, unitRows[0], 'Service unit');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const customFieldsJson = JSON.stringify(input.customFields);

    if (input.id) {
      const existingRows = await ctx.db
        .select({
          workOrder: srvWorkOrders,
          orgTreePath: iamOrganizations.treePath,
        })
        .from(srvWorkOrders)
        .leftJoin(
          iamOrganizations,
          and(
            eq(srvWorkOrders.orgId, iamOrganizations.id),
            eq(srvWorkOrders.tenantId, iamOrganizations.tenantId),
            isNull(iamOrganizations.deletedAt),
          ),
        )
        .where(and(eq(srvWorkOrders.id, input.id), isNull(srvWorkOrders.deletedAt)))
        .limit(1);

      const row = existingRows[0];
      if (!row) {
        throw new AppError('NOT_FOUND', 404, 'Work order not found');
      }
      const effectivePath =
        row.orgTreePath ??
        (row.workOrder.orgId === ctx.orgId ? ctx.orgPath : '/__out_of_scope__');
      assertOrgScope(ctx, row.workOrder.tenantId, effectivePath);

      const nextVersion = row.workOrder.version + 1;
      const ticketNumber = input.ticketNumber ?? row.workOrder.ticketNumber;
      const result: z.infer<typeof workOrderOutputSchema> = {
        id: row.workOrder.id,
        tenantId: row.workOrder.tenantId,
        orgId: row.workOrder.orgId,
        ticketNumber,
        orderKind: input.orderKind,
        partyId: input.partyId !== undefined ? input.partyId : row.workOrder.partyId,
        unitId: input.unitId !== undefined ? input.unitId : row.workOrder.unitId,
        category: input.category,
        priority: input.priority,
        laborCostMinor: input.laborCostMinor,
        partsCostMinor: input.partsCostMinor,
        status: input.status,
        version: nextVersion,
        customFields: parseJsonRecord(customFieldsJson),
        createdAt: row.workOrder.createdAt,
        updatedAt: nowSec,
      };
      const responseJson = JSON.stringify(result);

      await ctx.db.batch([
        ctx.db
          .update(srvWorkOrders)
          .set({
            ticketNumber,
            orderKind: input.orderKind,
            partyId: result.partyId,
            unitId: result.unitId,
            commonAreaName: input.commonAreaName ?? row.workOrder.commonAreaName,
            category: input.category,
            deviceSerialOrImei: input.deviceSerialOrImei ?? row.workOrder.deviceSerialOrImei,
            initialDiagnosis: input.initialDiagnosis ?? row.workOrder.initialDiagnosis,
            permissionToEnter: input.permissionToEnter,
            hasPetsAlert: input.hasPetsAlert,
            preferredTimeWindow: input.preferredTimeWindow ?? row.workOrder.preferredTimeWindow,
            priority: input.priority,
            slaDueAt: input.slaDueAt ?? row.workOrder.slaDueAt,
            assignedStaffId: input.assignedStaffId ?? row.workOrder.assignedStaffId,
            etaAt: input.etaAt ?? row.workOrder.etaAt,
            partsConsumedJson: JSON.stringify(input.partsConsumed),
            laborCostMinor: input.laborCostMinor,
            partsCostMinor: input.partsCostMinor,
            mediaUrlsJson: JSON.stringify(input.mediaUrls),
            commentsThreadJson: JSON.stringify(input.commentsThread),
            residentRating1to5: input.residentRating1to5 ?? row.workOrder.residentRating1to5,
            startedAt: input.startedAt ?? row.workOrder.startedAt,
            completedAt: input.completedAt ?? row.workOrder.completedAt,
            status: input.status,
            customFields: customFieldsJson,
            version: nextVersion,
            updatedAt: nowSec,
          })
          .where(and(eq(srvWorkOrders.id, row.workOrder.id), eq(srvWorkOrders.tenantId, ctx.tenantId))),
        buildIdempotencyInsert(ctx.db, {
          tenantId: ctx.tenantId,
          orgId: row.workOrder.orgId,
          clientMutationId: input.clientMutationId,
          commandId: 'services.work_orders.upsert',
          requestHash,
          responseJson,
          nowSec,
        }),
        buildActionLogInsert(ctx.db, {
          tenantId: ctx.tenantId,
          orgId: row.workOrder.orgId,
          actor: ctx.actor,
          commandId: 'services.work_orders.upsert',
          resourceKind: 'srv_work_order',
          resourceId: row.workOrder.id,
          targetPartyId: result.partyId ?? undefined,
          snapshotAfterJson: responseJson,
          nowSec,
        }),
      ]);

      return result;
    }

    const workOrderId = crypto.randomUUID();
    const ticketNumber = input.ticketNumber ?? `WO-${workOrderId.slice(0, 8).toUpperCase()}`;
    const created: z.infer<typeof workOrderOutputSchema> = {
      id: workOrderId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      ticketNumber,
      orderKind: input.orderKind,
      partyId: input.partyId ?? null,
      unitId: input.unitId ?? null,
      category: input.category,
      priority: input.priority,
      laborCostMinor: input.laborCostMinor,
      partsCostMinor: input.partsCostMinor,
      status: input.status,
      version: 1,
      customFields: parseJsonRecord(customFieldsJson),
      createdAt: nowSec,
      updatedAt: nowSec,
    };
    const responseJson = JSON.stringify(created);

    await ctx.db.batch([
      ctx.db.insert(srvWorkOrders).values({
        id: workOrderId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        ticketNumber,
        orderKind: input.orderKind,
        partyId: created.partyId,
        unitId: created.unitId,
        commonAreaName: input.commonAreaName ?? null,
        category: input.category,
        deviceSerialOrImei: input.deviceSerialOrImei ?? null,
        initialDiagnosis: input.initialDiagnosis ?? null,
        permissionToEnter: input.permissionToEnter,
        hasPetsAlert: input.hasPetsAlert,
        preferredTimeWindow: input.preferredTimeWindow ?? null,
        priority: input.priority,
        slaDueAt: input.slaDueAt ?? null,
        assignedStaffId: input.assignedStaffId ?? null,
        etaAt: input.etaAt ?? null,
        partsConsumedJson: JSON.stringify(input.partsConsumed),
        laborCostMinor: input.laborCostMinor,
        partsCostMinor: input.partsCostMinor,
        mediaUrlsJson: JSON.stringify(input.mediaUrls),
        commentsThreadJson: JSON.stringify(input.commentsThread),
        residentRating1to5: input.residentRating1to5 ?? null,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        status: input.status,
        customFields: customFieldsJson,
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'services.work_orders.upsert',
        requestHash,
        responseJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'services.work_orders.upsert',
        resourceKind: 'srv_work_order',
        resourceId: workOrderId,
        targetPartyId: created.partyId ?? undefined,
        snapshotAfterJson: responseJson,
        nowSec,
      }),
    ]);

    return created;
  },
});
