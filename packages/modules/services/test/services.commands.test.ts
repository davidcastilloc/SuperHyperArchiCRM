import { env } from 'cloudflare:test';
import { srvWarrantyClaimsRma, srvWorkOrders } from '@shac/db-d1';
import { AppError } from '@shac/kernel';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  modServicesManifest,
  servicesRmaClaimCommand,
  servicesWorkOrdersUpsertCommand,
} from '../src/index.js';
import { makeServicesCtx, setupServicesD1 } from './test-helpers.js';

describe('@shac/mod-services commands on workerd', () => {
  beforeAll(async () => {
    await setupServicesD1(env.DB);
  });

  it('exposes modServicesManifest with id services and 4 MCP-enabled commands', () => {
    expect(modServicesManifest.id).toBe('services');
    expect(modServicesManifest.commands.map((c) => c.id)).toEqual([
      'services.work_orders.upsert',
      'services.rma.claim',
      'services.claims.list',
      'services.evv.record',
    ]);
    for (const cmd of modServicesManifest.commands) {
      expect(cmd.mcp?.expose).toBe(true);
    }
  });

  it('upserts work orders (create + update), replays idempotently in <= 2 D1 queries, and enforces 404/403 isolation', async () => {
    const { ctx, counted } = makeServicesCtx(env.DB);

    const created = await servicesWorkOrdersUpsertCommand.handler(
      ctx,
      servicesWorkOrdersUpsertCommand.inputSchema.parse({
        clientMutationId: 'wo-create-1',
        ticketNumber: 'WO-2026-001',
        orderKind: 'tech_repair',
        partyId: 'party_1',
        category: 'ELECTRONICS',
        deviceSerialOrImei: 'IMEI-99887766',
        initialDiagnosis: 'Screen flicker & battery swell',
        priority: 'HIGH',
        laborCostMinor: 4500,
        partsCostMinor: 12000,
      }),
    );

    expect(created.ticketNumber).toBe('WO-2026-001');
    expect(created.version).toBe(1);
    expect(created.laborCostMinor).toBe(4500);
    expect(created.partsCostMinor).toBe(12000);
    expect(created.status).toBe('OPEN');

    counted.resetQueryCount();
    const replayed = await servicesWorkOrdersUpsertCommand.handler(
      ctx,
      servicesWorkOrdersUpsertCommand.inputSchema.parse({
        clientMutationId: 'wo-create-1',
        ticketNumber: 'WO-2026-001',
        orderKind: 'tech_repair',
        partyId: 'party_1',
        category: 'ELECTRONICS',
        deviceSerialOrImei: 'IMEI-99887766',
        initialDiagnosis: 'Screen flicker & battery swell',
        priority: 'HIGH',
        laborCostMinor: 4500,
        partsCostMinor: 12000,
      }),
    );
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(replayed.id).toBe(created.id);

    await expect(
      servicesWorkOrdersUpsertCommand.handler(
        ctx,
        servicesWorkOrdersUpsertCommand.inputSchema.parse({
          clientMutationId: 'wo-create-1',
          ticketNumber: 'WO-2026-001',
          laborCostMinor: 9999,
        }),
      ),
    ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });

    const updated = await servicesWorkOrdersUpsertCommand.handler(
      ctx,
      servicesWorkOrdersUpsertCommand.inputSchema.parse({
        clientMutationId: 'wo-update-1',
        id: created.id,
        status: 'COMPLETED',
        laborCostMinor: 5000,
        partsCostMinor: 12000,
      }),
    );
    expect(updated.id).toBe(created.id);
    expect(updated.version).toBe(2);
    expect(updated.status).toBe('COMPLETED');
    expect(updated.laborCostMinor).toBe(5000);

    const dbRows = await ctx.db
      .select()
      .from(srvWorkOrders)
      .where(eq(srvWorkOrders.id, created.id));
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]?.version).toBe(2);

    await expect(
      servicesWorkOrdersUpsertCommand.handler(
        ctx,
        servicesWorkOrdersUpsertCommand.inputSchema.parse({
          clientMutationId: 'wo-missing-1',
          id: 'wo_does_not_exist',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });

    const { ctx: ten2Ctx } = makeServicesCtx(env.DB, {
      tenantId: 'ten_2',
      orgId: 'org_2',
      orgPath: '/org_2',
    });
    await expect(
      servicesWorkOrdersUpsertCommand.handler(
        ten2Ctx,
        servicesWorkOrdersUpsertCommand.inputSchema.parse({
          clientMutationId: 'wo-cross-tenant-1',
          id: created.id,
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      servicesWorkOrdersUpsertCommand.handler(
        ctx,
        servicesWorkOrdersUpsertCommand.inputSchema.parse({
          clientMutationId: 'wo-cross-branch-party',
          partyId: 'party_south',
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('creates RMA claims, enforces idempotency in <= 2 queries, and isolates 404/403 parties', async () => {
    const { ctx, counted } = makeServicesCtx(env.DB);

    const claim = await servicesRmaClaimCommand.handler(
      ctx,
      servicesRmaClaimCommand.inputSchema.parse({
        clientMutationId: 'rma-create-1',
        claimNumber: 'RMA-2026-001',
        partyId: 'party_1',
        priority: 'URGENT',
        advanceReplacement: true,
        lines: [
          {
            sku: 'BAT-PRO-15',
            serialNumber: 'SN-12345',
            qty: 1,
            reason: 'DOA cell',
          },
        ],
        vendorRecoveryStatus: 'SUBMITTED',
        vendorRecoveredMinor: 8500,
      }),
    );

    expect(claim.claimNumber).toBe('RMA-2026-001');
    expect(claim.advanceReplacement).toBe(true);
    expect(claim.vendorRecoveredMinor).toBe(8500);
    expect(claim.status).toBe('REQUESTED');

    counted.resetQueryCount();
    const replayed = await servicesRmaClaimCommand.handler(
      ctx,
      servicesRmaClaimCommand.inputSchema.parse({
        clientMutationId: 'rma-create-1',
        claimNumber: 'RMA-2026-001',
        partyId: 'party_1',
        priority: 'URGENT',
        advanceReplacement: true,
        lines: [
          {
            sku: 'BAT-PRO-15',
            serialNumber: 'SN-12345',
            qty: 1,
            reason: 'DOA cell',
          },
        ],
        vendorRecoveryStatus: 'SUBMITTED',
        vendorRecoveredMinor: 8500,
      }),
    );
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(replayed.id).toBe(claim.id);

    const dbClaims = await ctx.db
      .select()
      .from(srvWarrantyClaimsRma)
      .where(eq(srvWarrantyClaimsRma.id, claim.id));
    expect(dbClaims).toHaveLength(1);

    await expect(
      servicesRmaClaimCommand.handler(
        ctx,
        servicesRmaClaimCommand.inputSchema.parse({
          clientMutationId: 'rma-missing-party',
          partyId: 'party_missing',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      servicesRmaClaimCommand.handler(
        ctx,
        servicesRmaClaimCommand.inputSchema.parse({
          clientMutationId: 'rma-cross-tenant',
          partyId: 'party_ten2',
        }),
      ),
    ).rejects.toBeInstanceOf(AppError);

    const svcMod = await import('../src/index.js');
    expect('servicesClaimsListCommand' in svcMod).toBe(true);
    const { servicesClaimsListCommand } = svcMod as typeof import('../src/index.js') & {
      servicesClaimsListCommand: {
        inputSchema: { parse: (v: unknown) => unknown };
        handler: (c: typeof ctx, i: never) => Promise<{
          claims: Array<{ claimNumber: string }>;
          workOrders: Array<{ ticketNumber: string }>;
        }>;
      };
    };

    counted.resetQueryCount();
    const listRes = await servicesClaimsListCommand.handler(
      ctx,
      servicesClaimsListCommand.inputSchema.parse({ limit: 25 }) as never,
    );
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(listRes.claims.some((c) => c.claimNumber === 'RMA-2026-001')).toBe(true);
    expect(listRes.workOrders.some((w) => w.ticketNumber === 'WO-2026-001')).toBe(true);
  });
});
