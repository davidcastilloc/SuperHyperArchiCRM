import {
  assertOrgScope,
  buildActionLogInsert,
  buildIdempotencyInsert,
  catCurrenciesAndRates,
  checkIdempotency,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const upsertRateInputSchema = z.object({
  clientMutationId: z.string().min(1).max(128),
  id: z.string().min(1).optional(),
  fromCurrency: z.string().trim().min(3).max(8),
  toCurrency: z.string().trim().min(3).max(8),
  rateMicros: z.number().int().positive(),
  buyRateMicros: z.number().int().positive().nullable().optional(),
  sellRateMicros: z.number().int().positive().nullable().optional(),
  source: z.enum(['BCV', 'DOLAR_API', 'CENTRAL_BANK', 'MANUAL']).default('BCV'),
  effectiveAt: z.number().int().positive().optional(),
  isActive: z.boolean().default(true),
});

const upsertRateOutputSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  orgId: z.string(),
  fromCurrency: z.string(),
  toCurrency: z.string(),
  rateMicros: z.number().int().positive(),
  buyRateMicros: z.number().int().nullable(),
  sellRateMicros: z.number().int().nullable(),
  source: z.string(),
  effectiveAt: z.number().int(),
  isActive: z.boolean(),
});

export const catalogRatesUpsertCommand = defineCommand<
  typeof upsertRateInputSchema,
  z.infer<typeof upsertRateOutputSchema>,
  ShacD1Database
>({
  id: 'catalog.rates.upsert',
  moduleId: 'catalog',
  method: 'POST',
  path: '/api/catalog/rates',
  summary: 'Upsert a currency exchange rate in integer micros (e.g. BCV)',
  requiredPermission: 'catalog.rates.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description: 'Record an integer FX rate (rateMicros) for currency conversion',
  },
  inputSchema: upsertRateInputSchema,
  outputSchema: upsertRateOutputSchema,
  async handler(ctx, input) {
    const fromCurrency = input.fromCurrency.toUpperCase();
    const toCurrency = input.toCurrency.toUpperCase();
    if (fromCurrency === toCurrency) {
      throw new AppError(
        'INVALID_CURRENCY_PAIR',
        400,
        'fromCurrency and toCurrency must differ',
      );
    }

    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'catalog.rates.upsert',
        ...input,
        fromCurrency,
        toCurrency,
      }),
    );
    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      upsertRateOutputSchema,
    );
    if (replay) return replay;

    assertOrgScope(ctx, ctx.tenantId, ctx.orgPath);

    let existingVersion = 0;
    let existingCreatedAt: number | null = null;
    if (input.id) {
      const existingRows = await ctx.db
        .select()
        .from(catCurrenciesAndRates)
        .where(eq(catCurrenciesAndRates.id, input.id))
        .limit(1);
      const existing = existingRows[0];
      if (existing && existing.tenantId !== ctx.tenantId) {
        throw new AppError('NOT_FOUND', 404, 'Rate record not found');
      }
      if (existing) {
        existingVersion = existing.version;
        existingCreatedAt = existing.createdAt;
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const effectiveAt = input.effectiveAt ?? nowSec;
    const rateId = input.id ?? crypto.randomUUID();

    const output: z.infer<typeof upsertRateOutputSchema> = {
      id: rateId,
      tenantId: ctx.tenantId,
      orgId: ctx.orgId,
      fromCurrency,
      toCurrency,
      rateMicros: input.rateMicros,
      buyRateMicros: input.buyRateMicros ?? null,
      sellRateMicros: input.sellRateMicros ?? null,
      source: input.source,
      effectiveAt,
      isActive: input.isActive,
    };

    const writeRateOp =
      existingVersion > 0
        ? ctx.db
            .update(catCurrenciesAndRates)
            .set({ ...output, version: existingVersion + 1, updatedAt: nowSec })
            .where(
              and(
                eq(catCurrenciesAndRates.tenantId, ctx.tenantId),
                eq(catCurrenciesAndRates.id, rateId),
              ),
            )
        : ctx.db.insert(catCurrenciesAndRates).values({
            ...output,
            createdAt: existingCreatedAt ?? nowSec,
            updatedAt: nowSec,
          });

    const responseJson = JSON.stringify(output);
    const idempotencyOp = buildIdempotencyInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: ctx.orgId,
      clientMutationId: input.clientMutationId,
      commandId: 'catalog.rates.upsert',
      requestHash,
      responseJson,
      nowSec,
    });
    const actionLogOp = buildActionLogInsert(ctx.db, {
      tenantId: ctx.tenantId,
      orgId: ctx.orgId,
      actor: ctx.actor,
      commandId: 'catalog.rates.upsert',
      resourceKind: 'cat_currency_rate',
      resourceId: rateId,
      snapshotAfterJson: responseJson,
      nowSec,
    });

    if (input.isActive) {
      const deactivateOp = ctx.db
        .update(catCurrenciesAndRates)
        .set({ isActive: false, updatedAt: nowSec })
        .where(
          and(
            eq(catCurrenciesAndRates.tenantId, ctx.tenantId),
            eq(catCurrenciesAndRates.fromCurrency, fromCurrency),
            eq(catCurrenciesAndRates.toCurrency, toCurrency),
            eq(catCurrenciesAndRates.isActive, true),
          ),
        );
      await ctx.db.batch([deactivateOp, writeRateOp, idempotencyOp, actionLogOp]);
    } else {
      await ctx.db.batch([writeRateOp, idempotencyOp, actionLogOp]);
    }
    return output;
  },
});
