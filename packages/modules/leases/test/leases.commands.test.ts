import { env } from 'cloudflare:test';
import { leaseContractsAndRenewals } from '@shac/db-d1';
import { AppError } from '@shac/kernel';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  computeSplitRentShares,
  leasesApplicationsSubmitCommand,
  leasesCommunityPostCommand,
  leasesContractsActivateCommand,
  leasesContractsRenewOrVacateCommand,
  modLeasesManifest,
} from '../src/index.js';
import { makeLeasesCtx, setupLeasesD1 } from './test-helpers.js';

describe('@shac/mod-leases commands on workerd', () => {
  beforeAll(async () => {
    await setupLeasesD1(env.DB);
  });

  it('computes exact BigInt Split Rent shares with deterministic remainder', () => {
    const shares3 = computeSplitRentShares(100_001, [
      { partyId: 'p1', shareBps: 3333 },
      { partyId: 'p2', shareBps: 3333 },
      { partyId: 'p3', shareBps: 3334 },
    ]);
    expect(shares3.map((s) => s.amountMinor)).toEqual([33_330, 33_330, 33_341]);
    expect(shares3.reduce((acc, s) => acc + s.amountMinor, 0)).toBe(100_001);

    const shares2 = computeSplitRentShares(101, [
      { partyId: 'p1', shareBps: 5000 },
      { partyId: 'p2', shareBps: 5000 },
    ]);
    expect(shares2.map((s) => s.amountMinor)).toEqual([51, 50]);

    expect(() =>
      computeSplitRentShares(100_000, [
        { partyId: 'p1', shareBps: 5000 },
        { partyId: 'p2', shareBps: 4999 },
      ]),
    ).toThrowError(AppError);
  });

  it('exposes manifest with 4 MCP-enabled commands', () => {
    expect(modLeasesManifest.id).toBe('leases');
    expect(modLeasesManifest.commands.map((c) => c.id)).toEqual([
      'leases.applications.submit',
      'leases.contracts.activate',
      'leases.contracts.renew_or_vacate',
      'leases.community.post',
    ]);
    for (const cmd of modLeasesManifest.commands) {
      expect(cmd.mcp?.expose).toBe(true);
    }
  });

  it('submits leasing application and enforces idempotency (replay + 409 conflict)', async () => {
    const { ctx } = makeLeasesCtx(env.DB);
    const input = {
      clientMutationId: 'mut-app-1',
      applicantPartyId: 'party_1',
      targetUnitId: 'unit_101',
      applicationKind: 'NEW_LEASE' as const,
      desiredMoveIn: 1764000000,
      termMonths: 12,
      proposedRentMinor: 120_000,
      screeningScore: 780,
      stepsTimeline: [{ step: 'submitted', at: 1763300000 }],
      coApplicant: { name: 'Luis Roommate' },
      petSummary: { dogs: 1 },
      customFields: { source: 'portal' },
    };

    const created = await leasesApplicationsSubmitCommand.handler(ctx, input);
    expect(created.status).toBe('SUBMITTED');
    expect(created.proposedRentMinor).toBe(120_000);

    const replayed = await leasesApplicationsSubmitCommand.handler(ctx, input);
    expect(replayed.id).toBe(created.id);

    await expect(
      leasesApplicationsSubmitCommand.handler(ctx, {
        ...input,
        proposedRentMinor: 125_000,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('activates lease with escrow, Autopay, Split Rent, renewal_offer, and vacate_notice', async () => {
    const { ctx } = makeLeasesCtx(env.DB);
    const contract = await leasesContractsActivateCommand.handler(ctx, {
      clientMutationId: 'mut-lease-1',
      leaseNumber: 'LSE-2026-101',
      unitId: 'unit_101',
      primaryPartyId: 'party_1',
      occupants: [{ partyId: 'party_1' }, { partyId: 'party_2' }],
      startDate: 1764000000,
      endDate: 1795536000,
      monthlyRentMinor: 100_001,
      recurringBreakdown: { wifiMinor: 4000, waterMinor: 2500 },
      securityDepositEscrowMinor: 200_000,
      gracePeriodDays: 5,
      lateFeeMinor: 5000,
      autopayEnabled: true,
      autopayDayOfMonth: 3,
      splitRentShares: [
        { partyId: 'party_1', shareBps: 3333, label: 'Primary' },
        { partyId: 'party_2', shareBps: 3333, label: 'Roommate' },
        { partyId: 'party_1', shareBps: 3334, label: 'Parking' },
      ],
      customFields: {},
    });

    expect(contract.status).toBe('ACTIVE');
    expect(contract.securityDepositEscrowMinor).toBe(200_000);
    expect(contract.autopayEnabled).toBe(true);
    expect(contract.autopayDayOfMonth).toBe(3);
    expect(contract.splitRentShares.map((s) => s.amountMinor)).toEqual([
      33_330, 33_330, 33_341,
    ]);

    const renewal = await leasesContractsRenewOrVacateCommand.handler(ctx, {
      clientMutationId: 'mut-renew-1',
      leaseId: contract.id,
      action: 'renewal_offer',
      newStartDate: 1795536000,
      newEndDate: 1827072000,
      newMonthlyRentMinor: 105_000,
      renewalIncentives: { concessionMinor: 10_000 },
    });
    expect(renewal.recordKind).toBe('renewal_offer');
    expect(renewal.status).toBe('OFFERED');

    const vacate = await leasesContractsRenewOrVacateCommand.handler(ctx, {
      clientMutationId: 'mut-vacate-1',
      leaseId: contract.id,
      action: 'vacate_notice',
      intendedMoveOut: 1795536000,
      forwardingAddress: 'Av. Principal 123, Caracas',
      moveInOutInspectionR2Key: 'inspections/lse-2026-101.pdf',
    });
    expect(vacate.status).toBe('VACATE_NOTICE');

    const rows = await ctx.db
      .select()
      .from(leaseContractsAndRenewals)
      .where(eq(leaseContractsAndRenewals.id, contract.id));
    expect(rows[0]?.status).toBe('VACATE_NOTICE');
    expect(JSON.parse(rows[0]?.vacateNoticeJson ?? '{}')).toMatchObject({
      forwardingAddress: 'Av. Principal 123, Caracas',
    });
  });

  it('publishes condo_community_hub posts', async () => {
    const { ctx } = makeLeasesCtx(env.DB);
    const post = await leasesCommunityPostCommand.handler(ctx, {
      clientMutationId: 'mut-hub-1',
      itemKind: 'pet_registration',
      partyId: 'party_1',
      unitId: 'unit_101',
      title: 'Golden Retriever - Max',
      bodyOrDetails: { rabiesTag: 'RB-9921', isServiceAnimal: false },
      priority: 'NORMAL',
      status: 'ACTIVE',
      customFields: {},
    });
    expect(post.itemKind).toBe('pet_registration');
    expect(post.title).toBe('Golden Retriever - Max');
  });

  it('enforces 404 and 403 multi-tenant and org-subtree isolation', async () => {
    const { ctx: northCtx } = makeLeasesCtx(env.DB);
    const { ctx: ten2Ctx } = makeLeasesCtx(env.DB, {
      tenantId: 'ten_2',
      orgId: 'org_2',
      orgPath: '/org_2',
    });

    await expect(
      leasesApplicationsSubmitCommand.handler(northCtx, {
        clientMutationId: 'mut-iso-404',
        applicantPartyId: 'party_missing',
        targetUnitId: 'unit_101',
        applicationKind: 'NEW_LEASE',
        desiredMoveIn: 1764000000,
        termMonths: 12,
        proposedRentMinor: 100_000,
        stepsTimeline: [],
        coApplicant: {},
        petSummary: {},
        customFields: {},
      }),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      leasesApplicationsSubmitCommand.handler(northCtx, {
        clientMutationId: 'mut-iso-403-branch',
        applicantPartyId: 'party_1',
        targetUnitId: 'unit_south',
        applicationKind: 'NEW_LEASE',
        desiredMoveIn: 1764000000,
        termMonths: 12,
        proposedRentMinor: 100_000,
        stepsTimeline: [],
        coApplicant: {},
        petSummary: {},
        customFields: {},
      }),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      leasesCommunityPostCommand.handler(ten2Ctx, {
        clientMutationId: 'mut-iso-404-tenant',
        itemKind: 'announcement',
        partyId: 'party_1',
        title: 'Cross-tenant attempt',
        bodyOrDetails: {},
        priority: 'NORMAL',
        status: 'ACTIVE',
        customFields: {},
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
