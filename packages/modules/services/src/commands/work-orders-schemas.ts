import { z } from 'zod';

export const workOrderStatusSchema = z.enum([
  'OPEN',
  'DIAGNOSING',
  'IN_PROGRESS',
  'WAITING_PARTS',
  'COMPLETED',
  'CANCELLED',
]);

export const upsertWorkOrderInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  id: z.string().min(1).optional(),
  orgId: z.string().min(1).optional(),
  ticketNumber: z.string().min(1).max(64).optional(),
  orderKind: z
    .enum(['tech_repair', 'facility_maintenance', 'field_service', 'preventive'])
    .default('tech_repair'),
  partyId: z.string().min(1).nullable().optional(),
  unitId: z.string().min(1).nullable().optional(),
  commonAreaName: z.string().max(120).nullable().optional(),
  category: z.string().min(1).max(64).default('GENERAL'),
  deviceSerialOrImei: z.string().max(128).nullable().optional(),
  initialDiagnosis: z.string().max(4000).nullable().optional(),
  permissionToEnter: z.boolean().default(false),
  hasPetsAlert: z.boolean().default(false),
  preferredTimeWindow: z.string().max(64).nullable().optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  slaDueAt: z.number().int().positive().nullable().optional(),
  assignedStaffId: z.string().min(1).nullable().optional(),
  etaAt: z.number().int().positive().nullable().optional(),
  partsConsumed: z.array(z.record(z.unknown())).default([]),
  laborCostMinor: z.number().int().nonnegative().default(0),
  partsCostMinor: z.number().int().nonnegative().default(0),
  mediaUrls: z.array(z.string()).default([]),
  commentsThread: z.array(z.record(z.unknown())).default([]),
  residentRating1to5: z.number().int().min(1).max(5).nullable().optional(),
  startedAt: z.number().int().positive().nullable().optional(),
  completedAt: z.number().int().positive().nullable().optional(),
  status: workOrderStatusSchema.default('OPEN'),
  customFields: z.record(z.unknown()).default({}),
});

export const workOrderOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  ticketNumber: z.string(),
  orderKind: z.string(),
  partyId: z.string().nullable(),
  unitId: z.string().nullable(),
  category: z.string(),
  priority: z.string(),
  laborCostMinor: z.number().int().nonnegative(),
  partsCostMinor: z.number().int().nonnegative(),
  status: workOrderStatusSchema,
  version: z.number().int().positive(),
  customFields: z.record(z.unknown()),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
