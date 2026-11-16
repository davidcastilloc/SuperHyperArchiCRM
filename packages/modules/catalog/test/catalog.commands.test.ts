import { env } from 'cloudflare:test';
import { wrapD1WithCounter } from '@shac/db-d1';
import { beforeAll, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import {
  catalogLabelsBatchCommand,
  catalogPricingQuoteCommand,
  catalogProductsListCommand,
  catalogProductsUpsertCommand,
  catalogRatesUpsertCommand,
  modCatalogManifest,
} from '../src/index.js';
import {
  applySqlScript,
  makeCatalogCtx,
  seedFiveLayerPricingFixture,
  seedTenantsAndOrgs,
} from './test-helpers.js';

describe('@shac/mod-catalog D1 workerd commands', () => {
  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await seedTenantsAndOrgs(env.DB);
  });

  it('registers modCatalogManifest with 5 MCP-exposed catalog commands', () => {
    expect(modCatalogManifest.id).toBe('catalog');
    expect(modCatalogManifest.commands.map((c) => c.id)).toEqual([
      'catalog.products.upsert',
      'catalog.products.list',
      'catalog.pricing.quote',
      'catalog.rates.upsert',
      'catalog.labels.batch',
    ]);
    for (const cmd of modCatalogManifest.commands) {
      expect(cmd.moduleId).toBe('catalog');
      expect(cmd.mcp.expose).toBe(true);
    }
  });

  it('upserts product + default variant, replays idempotently, and lists with queryCount <= 2', async () => {
    const ctx = makeCatalogCtx(env.DB);
    const payload = catalogProductsUpsertCommand.inputSchema.parse({
      clientMutationId: 'cat-mut-prod-1',
      sku: 'AMOX-500-CAJA',
      name: 'Amoxicilina 500mg',
      basePriceMinor: 1000,
      costPriceMinor: 600,
      primaryCurrency: 'USD',
      taxRateBps: 1600,
      defaultVariant: {
        sku: 'AMOX-500-BOX12',
        presentationName: 'CAJA',
        uomFactorMicros: 12_000_000,
        overridePriceMinor: 11_200,
      },
    });

    const created = await catalogProductsUpsertCommand.handler(ctx, payload);
    expect(created.created).toBe(true);
    expect(created.product.sku).toBe('AMOX-500-CAJA');
    expect(created.defaultVariant?.uomFactorMicros).toBe(12_000_000);

    const replay = await catalogProductsUpsertCommand.handler(ctx, payload);
    expect(replay).toEqual(created);

    await expect(
      catalogProductsUpsertCommand.handler(ctx, { ...payload, basePriceMinor: 1050 }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });

    const counted = wrapD1WithCounter(env.DB);
    const countedCtx = makeCatalogCtx(counted.db);
    const listed = await catalogProductsListCommand.handler(
      countedCtx,
      catalogProductsListCommand.inputSchema.parse({ search: 'AMOX' }),
    );
    expect(counted.getQueryCount()).toBeLessThanOrEqual(2);
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.id).toBe(created.product.id);
  });

  it('quotes 5-layer cascade, rejects < margin floor (422), converts BCV rateMicros & tracks Omnibus', async () => {
    const ctx = makeCatalogCtx(env.DB);
    const nowSec = Math.floor(Date.now() / 1000);

    const prod = await catalogProductsUpsertCommand.handler(
      ctx,
      catalogProductsUpsertCommand.inputSchema.parse({
        clientMutationId: 'cat-mut-prod-quote',
        sku: 'HARINA-PAN-1KG',
        name: 'Harina Maiz Blanco 1kg',
        basePriceMinor: 1500,
        costPriceMinor: 1000,
        taxRateBps: 0,
        defaultVariant: {
          sku: 'HARINA-PAN-BULTO20',
          presentationName: 'BULTO',
          uomFactorMicros: 20_000_000,
          overridePriceMinor: 28_000,
        },
      }),
    );

    await catalogRatesUpsertCommand.handler(
      ctx,
      catalogRatesUpsertCommand.inputSchema.parse({
        clientMutationId: 'cat-mut-rate-bcv',
        fromCurrency: 'USD',
        toCurrency: 'VES',
        rateMicros: 52_500_000,
        source: 'BCV',
        effectiveAt: nowSec - 60,
      }),
    );

    await seedFiveLayerPricingFixture(ctx.db, prod.product.id, nowSec);

    const q1 = await catalogPricingQuoteCommand.handler(
      ctx,
      catalogPricingQuoteCommand.inputSchema.parse({
        productId: prod.product.id,
        partyId: 'pty_vip',
        channelId: 'pos',
        secondaryCurrency: 'VES',
        asOfSec: nowSec,
      }),
    );
    expect(q1.appliedLayer).toBe('CONTRACT_1TO1');
    expect(q1.unitPriceMinor).toBe(1150);
    expect(q1.secondaryUnitPriceMinor).toBe(60_375);
    expect(q1.lowest30dMinor).toBe(1500);
    expect(q1.isBelow30dLowest).toBe(true);

    const q2 = await catalogPricingQuoteCommand.handler(
      ctx,
      catalogPricingQuoteCommand.inputSchema.parse({
        productId: prod.product.id,
        partyId: 'pty_b2b',
        channelId: 'pos',
        asOfSec: nowSec,
      }),
    );
    expect(q2.appliedLayer).toBe('GROUP_TARIFF');
    expect(q2.unitPriceMinor).toBe(1250);

    const q3 = await catalogPricingQuoteCommand.handler(
      ctx,
      catalogPricingQuoteCommand.inputSchema.parse({
        productId: prod.product.id,
        channelId: 'pos',
        asOfSec: nowSec,
      }),
    );
    expect(q3.appliedLayer).toBe('PROMOTION_CHANNEL');
    expect(q3.unitPriceMinor).toBe(1350);

    const q4 = await catalogPricingQuoteCommand.handler(
      ctx,
      catalogPricingQuoteCommand.inputSchema.parse({
        productId: prod.product.id,
        variantId: prod.defaultVariant?.id,
        asOfSec: nowSec,
      }),
    );
    expect(q4.appliedLayer).toBe('VARIANT_UOM');
    expect(q4.unitPriceMinor).toBe(28_000);

    const q5 = await catalogPricingQuoteCommand.handler(
      ctx,
      catalogPricingQuoteCommand.inputSchema.parse({
        productId: prod.product.id,
        asOfSec: nowSec,
      }),
    );
    expect(q5.appliedLayer).toBe('BASE_PRICE');
    expect(q5.unitPriceMinor).toBe(1500);

    await expect(
      catalogPricingQuoteCommand.handler(
        ctx,
        catalogPricingQuoteCommand.inputSchema.parse({
          productId: prod.product.id,
          partyId: 'pty_liq',
          allowBelowCost: false,
          asOfSec: nowSec,
        }),
      ),
    ).rejects.toMatchObject({ code: 'BELOW_MARGIN_FLOOR', status: 422 });

    const allowedLoss = await catalogPricingQuoteCommand.handler(
      ctx,
      catalogPricingQuoteCommand.inputSchema.parse({
        productId: prod.product.id,
        partyId: 'pty_liq',
        asOfSec: nowSec,
      }),
    );
    expect(allowedLoss.unitPriceMinor).toBe(800);
    expect(allowedLoss.marginBps).toBe(-2500);
  });

  it('creates dual-currency label batches and enforces strict tenant & org isolation', async () => {
    const ctxA = makeCatalogCtx(env.DB, { tenantId: 'ten_a' });
    const ctxB = makeCatalogCtx(env.DB, { tenantId: 'ten_b' });

    const batch = await catalogLabelsBatchCommand.handler(
      ctxA,
      catalogLabelsBatchCommand.inputSchema.parse({
        clientMutationId: 'cat-mut-lbl-1',
        templateCode: 'SHELF_DUAL_CURRENCY',
        secondaryCurrency: 'VES',
        items: [{ sku: 'HARINA-PAN-1KG', qtyCopies: 6 }],
      }),
    );
    expect(batch.rateMicrosSnapshot).toBe(52_500_000);
    expect(batch.items[0]?.pricePrimaryMinor).toBe(1500);
    expect(batch.items[0]?.priceSecondaryMinor).toBe(78_750);

    const listB = await catalogProductsListCommand.handler(
      ctxB,
      catalogProductsListCommand.inputSchema.parse({}),
    );
    expect(listB.total).toBe(0);

    const listedA = await catalogProductsListCommand.handler(
      ctxA,
      catalogProductsListCommand.inputSchema.parse({}),
    );
    const prodAId = listedA.items[0]!.id;

    await expect(
      catalogPricingQuoteCommand.handler(
        ctxB,
        catalogPricingQuoteCommand.inputSchema.parse({ productId: prodAId }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await expect(
      catalogLabelsBatchCommand.handler(
        ctxB,
        catalogLabelsBatchCommand.inputSchema.parse({
          clientMutationId: 'cat-mut-lbl-cross',
          rateMicros: 52_500_000,
          items: [{ productId: prodAId, sku: 'HARINA-PAN-1KG', qtyCopies: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await expect(
      catalogProductsUpsertCommand.handler(
        ctxA,
        catalogProductsUpsertCommand.inputSchema.parse({
          clientMutationId: 'cat-mut-bad-org',
          orgId: 'org_a_other',
          sku: 'FORBIDDEN-ORG-SKU',
          name: 'Blocked',
          basePriceMinor: 500,
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ORG_SCOPE', status: 403 });
  });
});
