import { z } from 'zod';

export const spacesRackListInputSchema = z.object({
  orgId: z.string().min(1).optional(),
  spaceCategory: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
});

export const spacesRackUnitItemSchema = z.object({
  unitId: z.string(),
  unitNumber: z.string(),
  floorLabel: z.string().nullable(),
  buildingSection: z.string().nullable(),
  currentStatus: z.string(),
  unitTypeId: z.string(),
  unitTypeCode: z.string(),
  unitTypeName: z.string(),
  spaceCategory: z.string(),
  baseRateMinor: z.number().int().nonnegative(),
  monthlyRentMinor: z.number().int().nonnegative(),
});

export const spacesRackBookingItemSchema = z.object({
  bookingId: z.string(),
  confirmationCode: z.string(),
  unitId: z.string().nullable(),
  partyId: z.string(),
  sourceChannel: z.string(),
  status: z.string(),
  scheduledStart: z.number().int(),
  scheduledEnd: z.number().int(),
  totalMinor: z.number().int().nonnegative(),
});

export const spacesRackListOutputSchema = z.object({
  orgId: z.string(),
  units: z.array(spacesRackUnitItemSchema),
  activeBookings: z.array(spacesRackBookingItemSchema),
  metrics: z.object({
    roomRevenueMinor: z.number().int().nonnegative(),
    occupiedUnits: z.number().int().nonnegative(),
    totalAvailableUnits: z.number().int().nonnegative(),
    adrMinor: z.number().int().nonnegative(),
    revParMinor: z.number().int().nonnegative(),
    occupancyBps: z.number().int().nonnegative(),
  }),
});

export const spacesBookingsReserveInputSchema = z.object({
  clientMutationId: z.string().min(1),
  orgId: z.string().min(1).optional(),
  unitId: z.string().min(1),
  partyId: z.string().min(1),
  partyNameMasked: z.string().min(1).default('Guest'),
  slotBucket: z.string().min(1),
  lockKind: z
    .enum(['STAY', 'APPOINTMENT', 'AMENITY', 'MAINTENANCE_BLOCK'])
    .default('STAY'),
  bookingKind: z.string().min(1).default('hotel_stay'),
  sourceChannel: z
    .enum([
      'DIRECT',
      'WALK_IN',
      'BOOKING_COM',
      'AIRBNB',
      'EXPEDIA',
      'CORPORATE',
    ])
    .default('DIRECT'),
  scheduledStart: z.number().int().nonnegative(),
  scheduledEnd: z.number().int().nonnegative(),
  adultsCount: z.number().int().positive().default(1),
  childrenCount: z.number().int().nonnegative().default(0),
  rateMinor: z.number().int().nonnegative().optional(),
  currency: z.string().min(3).max(8).optional(),
  specialRequests: z.string().optional(),
  expiresAtMs: z.number().int().nonnegative().nullable().optional(),
});

export const spacesBookingsReserveOutputSchema = z.object({
  ok: z.literal(true),
  bookingId: z.string(),
  confirmationCode: z.string(),
  folioId: z.string(),
  folioNumber: z.string(),
  unitId: z.string(),
  slotBucket: z.string(),
  status: z.string(),
  totalMinor: z.number().int().nonnegative(),
  currency: z.string(),
  lockOutboxSeqId: z.number().int().nonnegative(),
});

export const spacesBookingsTransitionInputSchema = z.object({
  clientMutationId: z.string().min(1),
  orgId: z.string().min(1).optional(),
  bookingId: z.string().min(1),
  action: z.enum(['CHECK_IN', 'CHECK_OUT', 'CANCEL']),
  checkInChecklist: z.record(z.string(), z.unknown()).optional(),
  assignedToStaffId: z.string().min(1).optional(),
  housekeepingPriority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    .default('MEDIUM'),
});

export const spacesBookingsTransitionOutputSchema = z.object({
  ok: z.literal(true),
  bookingId: z.string(),
  unitId: z.string().nullable(),
  previousStatus: z.string(),
  status: z.string(),
  unitStatus: z.string().nullable(),
  housekeepingTaskId: z.string().nullable(),
});

export const spacesWaitlistManageInputSchema = z.object({
  clientMutationId: z.string().min(1),
  orgId: z.string().min(1).optional(),
  action: z.enum(['ADD', 'PROMOTE', 'CANCEL']),
  waitlistId: z.string().min(1).optional(),
  partyId: z.string().min(1).optional(),
  preferredStaffId: z.string().min(1).optional(),
  unitTypeId: z.string().min(1).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  preferredDates: z.array(z.string()).default([]),
  preferredSlots: z.array(z.string()).default([]),
  reason: z.string().optional(),
});

export const spacesWaitlistManageOutputSchema = z.object({
  ok: z.literal(true),
  waitlistId: z.string(),
  status: z.string(),
  priority: z.string(),
});
