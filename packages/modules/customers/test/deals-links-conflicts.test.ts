import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  customersConflictsCheckCommand,
  customersDealsCreateCommand,
  customersLinksCreateCommand,
  customersPartiesUpsertCommand,
} from '../src/index.js';
import { makeCustomersCtx, setupCustomersD1 } from './test-helpers.js';

describe('@shac/mod-customers links, deals & conflict checks on workerd D1', () => {
  beforeAll(async () => {
    await setupCustomersD1(env.DB);
  });

  it('creates party links, integer deals, and conflict checks with tenant/org isolation', async () => {
    const north = makeCustomersCtx(env.DB, {
      tenantId: 'ten_1',
      orgId: 'org_1_north',
      orgPath: '/org_1/north',
    });

    const clinic = await customersPartiesUpsertCommand.handler(
      north.ctx,
      customersPartiesUpsertCommand.inputSchema.parse({
        clientMutationId: 'mut_clinic_1',
        partyKind: 'company',
        rolesMask: ['customer', 'vendor'],
        displayName: 'Clínica Salud Global C.A.',
        taxIdType: 'RIF',
        taxIdNumber: 'J-30123456-7',
        creditLimitMinor: 500_000,
      }),
    );

    const rep = await customersPartiesUpsertCommand.handler(
      north.ctx,
      customersPartiesUpsertCommand.inputSchema.parse({
        clientMutationId: 'mut_rep_1',
        partyKind: 'person',
        rolesMask: ['legal_client'],
        displayName: 'Carlos Mendoza',
        taxIdType: 'CEDULA',
        taxIdNumber: 'V-15.111.222',
      }),
    );

    const linkInput = customersLinksCreateCommand.inputSchema.parse({
      clientMutationId: 'mut_link_1',
      fromPartyId: clinic.id,
      toPartyId: rep.id,
      linkType: 'company_contact',
      roleTitle: 'Director Médico',
      isPrimary: true,
      sharePercentageBps: 5_000,
    });
    const link = await customersLinksCreateCommand.handler(north.ctx, linkInput);
    expect(link.fromPartyId).toBe(clinic.id);
    expect(link.toPartyId).toBe(rep.id);
    expect(link.sharePercentageBps).toBe(5_000);

    expect(await customersLinksCreateCommand.handler(north.ctx, linkInput)).toEqual(
      link,
    );

    await expect(
      customersLinksCreateCommand.handler(
        north.ctx,
        customersLinksCreateCommand.inputSchema.parse({
          clientMutationId: 'mut_link_dup',
          fromPartyId: clinic.id,
          toPartyId: rep.id,
          linkType: 'company_contact',
        }),
      ),
    ).rejects.toMatchObject({ code: 'LINK_ALREADY_EXISTS', status: 409 });

    await expect(
      customersLinksCreateCommand.handler(
        north.ctx,
        customersLinksCreateCommand.inputSchema.parse({
          clientMutationId: 'mut_link_self',
          fromPartyId: clinic.id,
          toPartyId: clinic.id,
          linkType: 'company_contact',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PARTY_LINK', status: 400 });

    const dealInput = customersDealsCreateCommand.inputSchema.parse({
      clientMutationId: 'mut_deal_1',
      pipelineId: 'pipe_b2b',
      stageId: 'proposal',
      partyId: clinic.id,
      contactPartyId: rep.id,
      title: 'Suministro Anual Equipos Médicos',
      valueMinor: 250_000,
      currency: 'USD',
      probabilityBps: 7_500,
    });
    const deal = await customersDealsCreateCommand.handler(north.ctx, dealInput);
    expect(deal.valueMinor).toBe(250_000);
    expect(deal.probabilityBps).toBe(7_500);
    expect(await customersDealsCreateCommand.handler(north.ctx, dealInput)).toEqual(
      deal,
    );

    const deal2 = await customersDealsCreateCommand.handler(
      north.ctx,
      customersDealsCreateCommand.inputSchema.parse({
        clientMutationId: 'mut_deal_2',
        pipelineId: 'pipe_b2b',
        stageId: 'qualified',
        partyId: clinic.id,
        title: 'Consumibles Mensuales',
        valueMinor: 45_000,
      }),
    );
    expect(deal2.contactPartyId).toBeNull();
    expect(deal2.valueMinor).toBe(45_000);

    const ten2 = makeCustomersCtx(env.DB, {
      tenantId: 'ten_2',
      orgId: 'org_2',
      orgPath: '/org_2',
    });
    await expect(
      customersLinksCreateCommand.handler(
        ten2.ctx,
        customersLinksCreateCommand.inputSchema.parse({
          clientMutationId: 'mut_link_ten2',
          fromPartyId: clinic.id,
          toPartyId: rep.id,
          linkType: 'company_contact',
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await expect(
      customersDealsCreateCommand.handler(
        ten2.ctx,
        customersDealsCreateCommand.inputSchema.parse({
          clientMutationId: 'mut_deal_ten2',
          pipelineId: 'pipe_b2b',
          stageId: 'proposal',
          partyId: clinic.id,
          title: 'Cross Tenant Deal',
          valueMinor: 1000,
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await expect(
      customersConflictsCheckCommand.handler(
        ten2.ctx,
        customersConflictsCheckCommand.inputSchema.parse({
          candidatePartyId: rep.id,
          matterTitle: 'Cross Tenant Conflict',
          searchedTerms: ['Clínica'],
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    const conflictInput = customersConflictsCheckCommand.inputSchema.parse({
      clientMutationId: 'mut_conflict_1',
      candidatePartyId: rep.id,
      matterTitle: 'Contrato Clínica vs Tercero',
      searchedTerms: ['j301234567'],
    });
    const conflictHit = await customersConflictsCheckCommand.handler(
      north.ctx,
      conflictInput,
    );
    expect(conflictHit.riskStatus).toBe('potential_conflict');
    expect(conflictHit.matchedParties[0]?.partyId).toBe(clinic.id);
    expect(
      await customersConflictsCheckCommand.handler(north.ctx, conflictInput),
    ).toEqual(conflictHit);

    const conflictClear = await customersConflictsCheckCommand.handler(
      north.ctx,
      customersConflictsCheckCommand.inputSchema.parse({
        matterTitle: 'Nuevo Cliente Limpio',
        searchedTerms: ['Empresa Inexistente XYZ'],
      }),
    );
    expect(conflictClear.riskStatus).toBe('clear');
    expect(conflictClear.matchedParties).toEqual([]);
  });
});
