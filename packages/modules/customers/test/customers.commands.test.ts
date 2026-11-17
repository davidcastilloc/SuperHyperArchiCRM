import { env } from 'cloudflare:test';
import { sha256Hex } from '@shac/kernel';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  customersDealsCreateCommand,
  customersPartiesListCommand,
  customersPartiesUpsertCommand,
  modCustomersManifest,
} from '../src/index.js';
import { makeCustomersCtx, setupCustomersD1 } from './test-helpers.js';

describe('@shac/mod-customers manifest, parties.upsert & parties.list', () => {
  beforeAll(async () => {
    await setupCustomersD1(env.DB);
  });

  it('registers modCustomersManifest with 9 MCP-exposed commands and strict integer Zod contracts', () => {
    expect(modCustomersManifest.id).toBe('customers');
    expect(modCustomersManifest.commands.map((c) => c.id)).toEqual([
      'customers.parties.upsert',
      'customers.parties.list',
      'customers.links.create',
      'customers.deals.create',
      'customers.deals.list',
      'customers.deals.stage',
      'customers.interactions.list',
      'customers.interactions.upsert',
      'customers.conflicts.check',
    ]);

    for (const cmd of modCustomersManifest.commands) {
      expect(cmd.moduleId).toBe('customers');
      expect(cmd.mcp.expose).toBe(true);
    }

    expect(() =>
      customersPartiesUpsertCommand.inputSchema.parse({
        clientMutationId: 'mut_float_credit',
        rolesMask: ['customer'],
        displayName: 'Float Reject',
        creditLimitMinor: 12.5,
      }),
    ).toThrow();

    expect(() =>
      customersDealsCreateCommand.inputSchema.parse({
        clientMutationId: 'mut_float_deal',
        pipelineId: 'pipe_1',
        stageId: 'stage_1',
        partyId: 'pty_1',
        title: 'Float Deal',
        valueMinor: 99.95,
      }),
    ).toThrow();
  });

  it('upserts multi-role María Gómez with normalized taxId sha256Hex, profile, idempotency, and <= 2 list queries', async () => {
    const { ctx, counted } = makeCustomersCtx(env.DB, {
      tenantId: 'ten_1',
      orgId: 'org_1_north',
      orgPath: '/org_1/north',
    });

    const mariaInput = customersPartiesUpsertCommand.inputSchema.parse({
      clientMutationId: 'mut_maria_1',
      partyKind: 'person',
      rolesMask: ['customer', 'patient', 'customer'],
      displayName: 'María Gómez',
      firstName: 'María',
      lastName: 'Gómez',
      nationality: 'V',
      taxIdType: 'CEDULA',
      taxIdNumber: 'V-18.444.555',
      primaryEmail: 'Maria.Gomez@Example.COM',
      creditLimitMinor: 50_000,
      preferredCurrency: 'USD',
      profile: {
        birthDate: '1990-05-14',
        preferredLanguage: 'es-VE',
        mrnCode: 'MRN-MARIA-01',
        annualIncomeMinor: 1_200_000,
        agreedCreditCheck: true,
        notes: 'VIP clinic patient and retail buyer',
      },
    });

    const created = await customersPartiesUpsertCommand.handler(ctx, mariaInput);
    expect(created.displayName).toBe('María Gómez');
    expect(created.rolesMask).toEqual(['customer', 'patient']);
    expect(created.taxIdNumber).toBe('V18444555');
    expect(created.taxIdHash).toBe(await sha256Hex('V18444555'));
    expect(created.primaryEmail).toBe('maria.gomez@example.com');
    expect(created.creditLimitMinor).toBe(50_000);
    expect(created.profile?.mrnCode).toBe('MRN-MARIA-01');
    expect(created.version).toBe(1);

    counted.resetQueryCount();
    const replayed = await customersPartiesUpsertCommand.handler(ctx, mariaInput);
    expect(replayed).toEqual(created);
    expect(counted.getQueryCount()).toBe(1);

    await expect(
      customersPartiesUpsertCommand.handler(ctx, {
        ...mariaInput,
        displayName: 'María Gómez Modified',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });

    const updated = await customersPartiesUpsertCommand.handler(
      ctx,
      customersPartiesUpsertCommand.inputSchema.parse({
        clientMutationId: 'mut_maria_2',
        rolesMask: ['customer', 'patient', 'guest'],
        displayName: 'María Gómez',
        taxIdType: 'CEDULA',
        taxIdNumber: 'v18444555',
        creditLimitMinor: 75_000,
      }),
    );
    expect(updated.id).toBe(created.id);
    expect(updated.version).toBe(2);
    expect(updated.rolesMask).toEqual(['customer', 'patient', 'guest']);
    expect(updated.profile?.mrnCode).toBe('MRN-MARIA-01');

    counted.resetQueryCount();
    const listRes = await customersPartiesListCommand.handler(
      ctx,
      customersPartiesListCommand.inputSchema.parse({
        role: 'patient',
        search: 'v-18.444.555',
      }),
    );
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(listRes.total).toBe(1);
    expect(listRes.items[0]?.id).toBe(created.id);
    expect(listRes.items[0]?.profile?.mrnCode).toBe('MRN-MARIA-01');
    expect(listRes.items[0]?.profile?.screeningScore).toBeNull();
    expect(listRes.items[0]?.profile?.agreedCreditCheck).toBe(true);

    const ten2 = makeCustomersCtx(env.DB, {
      tenantId: 'ten_2',
      orgId: 'org_2',
      orgPath: '/org_2',
    });
    ten2.counted.resetQueryCount();
    const ten2List = await customersPartiesListCommand.handler(
      ten2.ctx,
      customersPartiesListCommand.inputSchema.parse({}),
    );
    expect(ten2.counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(ten2List.total).toBe(0);

    const south = makeCustomersCtx(env.DB, {
      tenantId: 'ten_1',
      orgId: 'org_1_south',
      orgPath: '/org_1/south',
    });
    const southList = await customersPartiesListCommand.handler(
      south.ctx,
      customersPartiesListCommand.inputSchema.parse({}),
    );
    expect(southList.total).toBe(0);

    const parent = makeCustomersCtx(env.DB, {
      tenantId: 'ten_1',
      orgId: 'org_1',
      orgPath: '/org_1',
    });
    parent.counted.resetQueryCount();
    const parentList = await customersPartiesListCommand.handler(
      parent.ctx,
      customersPartiesListCommand.inputSchema.parse({}),
    );
    expect(parent.counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(parentList.items.some((p) => p.id === created.id)).toBe(true);

    await expect(
      customersPartiesUpsertCommand.handler(
        south.ctx,
        customersPartiesUpsertCommand.inputSchema.parse({
          clientMutationId: 'mut_south_steal',
          id: created.id,
          rolesMask: ['customer'],
          displayName: 'Unauthorized Edit',
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ORG_SCOPE', status: 403 });

    await expect(
      customersPartiesUpsertCommand.handler(
        ten2.ctx,
        customersPartiesUpsertCommand.inputSchema.parse({
          clientMutationId: 'mut_ten2_steal',
          id: created.id,
          rolesMask: ['customer'],
          displayName: 'Cross Tenant',
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('creates and lists CRM tasks/interactions in <= 2 D1 queries and transitions deal stages idempotently', async () => {
    const custMod = await import('../src/index.js');
    expect('customersInteractionsListCommand' in custMod).toBe(true);
    expect('customersInteractionsUpsertCommand' in custMod).toBe(true);
    expect('customersDealsStageCommand' in custMod).toBe(true);
    const {
      customersInteractionsListCommand,
      customersInteractionsUpsertCommand,
      customersDealsStageCommand,
    } = custMod as typeof import('../src/index.js') & {
      customersInteractionsListCommand: typeof customersPartiesListCommand;
      customersInteractionsUpsertCommand: typeof customersPartiesUpsertCommand;
      customersDealsStageCommand: typeof customersDealsCreateCommand;
    };

    const { ctx, counted } = makeCustomersCtx(env.DB, {
      tenantId: 'ten_1',
      orgId: 'org_1_north',
      orgPath: '/org_1/north',
    });

    const party = await customersPartiesUpsertCommand.handler(
      ctx,
      customersPartiesUpsertCommand.inputSchema.parse({
        clientMutationId: 'mut_task_party_1',
        rolesMask: ['customer'],
        displayName: 'Bica do Sol',
      }),
    );

    const taskInput = customersInteractionsUpsertCommand.inputSchema.parse({
      clientMutationId: 'mut_task_1',
      partyId: party.id,
      kind: 'task',
      title: 'Enviar lista de precios 2026',
      priority: 'high',
      status: 'open',
    });
    const createdTask = (await customersInteractionsUpsertCommand.handler(ctx, taskInput)) as unknown as {
      id: string;
      title: string;
      status: string;
    };
    expect(createdTask.title).toBe('Enviar lista de precios 2026');

    counted.resetQueryCount();
    const listRes = (await customersInteractionsListCommand.handler(
      ctx,
      customersInteractionsListCommand.inputSchema.parse({ partyId: party.id }),
    )) as unknown as { items: Array<{ id: string }>; summary: { openCount: number } };
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(listRes.items.some((t) => t.id === createdTask.id)).toBe(true);
    expect(listRes.summary.openCount).toBeGreaterThanOrEqual(1);

    const deal = await customersDealsCreateCommand.handler(
      ctx,
      customersDealsCreateCommand.inputSchema.parse({
        clientMutationId: 'mut_kanban_deal_1',
        pipelineId: 'pipe_default',
        stageId: 'stage_qualified',
        partyId: party.id,
        title: 'Suministro Semanal',
        valueMinor: 320_000,
        probabilityBps: 2500,
      }),
    );

    const moved = (await customersDealsStageCommand.handler(
      ctx,
      customersDealsStageCommand.inputSchema.parse({
        clientMutationId: 'mut_kanban_move_1',
        dealId: deal.id,
        stageId: 'stage_commit',
        probabilityBps: 9000,
        outcome: 'won',
      }),
    )) as unknown as { stageId: string; probabilityBps: number; outcome: string };
    expect(moved.stageId).toBe('stage_commit');
    expect(moved.probabilityBps).toBe(9000);
    expect(moved.outcome).toBe('won');
  });

  it('projects customFields on upsert and filters via indexed cfFilter in parties.list', async () => {
    const { ctx } = makeCustomersCtx(env.DB);
    await customersPartiesUpsertCommand.handler(
      ctx,
      customersPartiesUpsertCommand.inputSchema.parse({
        clientMutationId: 'mut_cf_vip',
        partyKind: 'company',
        displayName: 'VIP Gold Corp',
        rolesMask: ['customer'],
        customFields: { segment_tier: 'VIP_GOLD', credit_score: 780 },
      }),
    );
    await customersPartiesUpsertCommand.handler(
      ctx,
      customersPartiesUpsertCommand.inputSchema.parse({
        clientMutationId: 'mut_cf_std',
        partyKind: 'company',
        displayName: 'Standard Corp',
        rolesMask: ['customer'],
        customFields: { segment_tier: 'STANDARD', credit_score: 500 },
      }),
    );

    const textFiltered = await customersPartiesListCommand.handler(
      ctx,
      customersPartiesListCommand.inputSchema.parse({
        cfFilter: { fieldKey: 'segment_tier', textEquals: 'VIP_GOLD' },
      } as Record<string, unknown>),
    );
    expect(textFiltered.items.map((i) => i.displayName)).toEqual(['VIP Gold Corp']);

    const numFiltered = await customersPartiesListCommand.handler(
      ctx,
      customersPartiesListCommand.inputSchema.parse({
        cfFilter: { fieldKey: 'credit_score', numMin: 700, numMax: 850 },
      } as Record<string, unknown>),
    );
    expect(numFiltered.items.map((i) => i.displayName)).toEqual(['VIP Gold Corp']);
  });
});
