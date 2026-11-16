import { env } from 'cloudflare:test';
import { comInvoicesAndFiscal, kernelActionLogs } from '@shac/db-d1';
import { sha256Hex } from '@shac/kernel';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import migration0001Sql from '../../../db-d1/migrations/0001_phase1_iam_core.sql?raw';
import migration0002Sql from '../../../db-d1/migrations/0002_phase2_universal_trunk.sql?raw';
import migration0003Sql from '../../../db-d1/migrations/0003_phase3_pos_wms_regional.sql?raw';
import {
  modRegionalManifest,
  regionalFiscalStampCommand,
  regionalTaxIdValidateCommand,
  validateSpeiClabe,
} from '../src/index.js';
import {
  applySqlScript,
  makeRegionalCtx,
  seedRegionalTenantsAndRefs,
} from './test-helpers.js';

describe('@shac/mod-regional D1 workerd commands', () => {
  beforeAll(async () => {
    await applySqlScript(env.DB, migration0001Sql);
    await applySqlScript(env.DB, migration0002Sql);
    await applySqlScript(env.DB, migration0003Sql);
    await seedRegionalTenantsAndRefs(env.DB);
  });

  it('registers modRegionalManifest with MCP-exposed tax_id.validate & fiscal.stamp', () => {
    expect(modRegionalManifest.id).toBe('regional');
    expect(modRegionalManifest.commands.map((c) => c.id)).toEqual([
      'regional.tax_id.validate',
      'regional.fiscal.stamp',
    ]);
    expect(regionalTaxIdValidateCommand.method).toBe('POST');
    expect(regionalTaxIdValidateCommand.path).toBe('/api/regional/tax-id/validate');
    expect(regionalTaxIdValidateCommand.requiredPermission).toBe('regional.tax_id.read');
    expect(regionalTaxIdValidateCommand.mcp.expose).toBe(true);
    expect(regionalTaxIdValidateCommand.mcp.readOnlyHint).toBe(true);

    expect(regionalFiscalStampCommand.method).toBe('POST');
    expect(regionalFiscalStampCommand.path).toBe('/api/regional/fiscal/stamp');
    expect(regionalFiscalStampCommand.requiredPermission).toBe('regional.fiscal.write');
    expect(regionalFiscalStampCommand.mcp.expose).toBe(true);
  });

  it('executes regional.tax_id.validate for ve/co/mx/us and throws 422 INVALID_TAX_ID', async () => {
    const ctx = makeRegionalCtx(env.DB, { regionPack: 've' });

    const veRes = await regionalTaxIdValidateCommand.handler(
      ctx,
      regionalTaxIdValidateCommand.inputSchema.parse({
        taxIdType: 'RIF',
        taxIdNumber: 'j-40123456-7',
      }),
    );
    expect(veRes.normalized).toBe('J401234567');
    expect(veRes.taxIdHash).toBe(await sha256Hex('J401234567'));

    const coRes = await regionalTaxIdValidateCommand.handler(
      ctx,
      regionalTaxIdValidateCommand.inputSchema.parse({
        regionPack: 'co',
        taxIdType: 'NIT',
        taxIdNumber: '890900608-9',
      }),
    );
    expect(coRes.normalized).toBe('8909006089');
    expect(coRes.checkDigit).toBe('9');

    const mxRes = await regionalTaxIdValidateCommand.handler(
      ctx,
      regionalTaxIdValidateCommand.inputSchema.parse({
        regionPack: 'mx',
        taxIdType: 'RFC',
        taxIdNumber: 'XAXX010101000',
      }),
    );
    expect(mxRes.normalized).toBe('XAXX010101000');

    const usRes = await regionalTaxIdValidateCommand.handler(
      ctx,
      regionalTaxIdValidateCommand.inputSchema.parse({
        regionPack: 'us',
        taxIdType: 'EIN',
        taxIdNumber: '12-3456789',
      }),
    );
    expect(usRes.formatted).toBe('12-3456789');

    await expect(
      regionalTaxIdValidateCommand.handler(
        ctx,
        regionalTaxIdValidateCommand.inputSchema.parse({
          regionPack: 'co',
          taxIdType: 'NIT',
          taxIdNumber: '890900608-0',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TAX_ID', status: 422 });
  });

  it('stamps ve, co (SHA-384 CUFE), mx (CFDI/OXXO/SPEI), and us (B2B exempt) into D1', async () => {
    const ctx = makeRegionalCtx(env.DB, { regionPack: 've' });

    const veStamped = await regionalFiscalStampCommand.handler(
      ctx,
      regionalFiscalStampCommand.inputSchema.parse({
        clientMutationId: 'mut_stamp_ve_1',
        regionPack: 've',
        invoiceNumber: 'FAC-VE-1001',
        partyId: 'pty_a',
        currency: 'VES',
        exchangeRateMicros: 45_000_000,
        subtotalMinor: 20_000,
        islrWithholdingBps: 200,
        issuerTaxId: 'J-40123456-7',
        issuerTaxIdType: 'RIF',
        customerTaxId: 'V-18.444.555',
        customerTaxIdType: 'CEDULA',
        lines: [
          { subtotalMinor: 10_000, taxRateBps: 1600 },
          { subtotalMinor: 10_000, taxRateBps: 800 },
        ],
      }),
    );
    expect(veStamped.taxMinor).toBe(2_400);
    expect(veStamped.withholdingMinor).toBe(400);
    expect(veStamped.totalMinor).toBe(22_400);
    expect(veStamped.netPayableMinor).toBe(22_000);
    expect(veStamped.hkaPrinterZReport).toBeTruthy();

    const coStamped = await regionalFiscalStampCommand.handler(
      ctx,
      regionalFiscalStampCommand.inputSchema.parse({
        clientMutationId: 'mut_stamp_co_1',
        regionPack: 'co',
        invoiceNumber: 'FE-CO-2001',
        partyId: 'pty_a',
        currency: 'COP',
        subtotalMinor: 50_000,
        issuerTaxId: '890900608-9',
        issuerTaxIdType: 'NIT',
        customerTaxId: '1020304050',
        customerTaxIdType: 'CC',
      }),
    );
    expect(coStamped.taxMinor).toBe(9_500);
    expect(coStamped.dianCufeSha384).toMatch(/^[0-9a-f]{96}$/);
    expect(coStamped.fiscalQrPayload).toContain(coStamped.dianCufeSha384 ?? '');

    const mxStamped = await regionalFiscalStampCommand.handler(
      ctx,
      regionalFiscalStampCommand.inputSchema.parse({
        clientMutationId: 'mut_stamp_mx_1',
        regionPack: 'mx',
        invoiceNumber: 'CFDI-MX-3001',
        currency: 'MXN',
        subtotalMinor: 100_000,
        issuerTaxId: 'ABC010203AB1',
        issuerTaxIdType: 'RFC',
      }),
    );
    expect(mxStamped.taxMinor).toBe(16_000);
    expect(mxStamped.satCfdiUuid).toMatch(
      /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/,
    );
    expect(mxStamped.mxPayments?.oxxoPayReference).toMatch(/^\d{14}$/);
    expect(validateSpeiClabe(mxStamped.mxPayments?.speiClabe ?? '')).toBe(
      mxStamped.mxPayments?.speiClabe,
    );

    const usExempt = await regionalFiscalStampCommand.handler(
      ctx,
      regionalFiscalStampCommand.inputSchema.parse({
        clientMutationId: 'mut_stamp_us_exempt_1',
        regionPack: 'us',
        invoiceNumber: 'INV-US-4001',
        currency: 'USD',
        subtotalMinor: 25_000,
        us: {
          jurisdictionCode: 'US-CA-LA',
          jurisdictionTaxRateBps: 950,
          isTaxExempt: true,
          b2bExemptionCertificate: 'CA-RESALE-7711',
        },
      }),
    );
    expect(usExempt.taxMinor).toBe(0);
    expect(usExempt.totalMinor).toBe(25_000);
    expect(usExempt.usSalesTax?.statutoryTaxRateBps).toBe(950);

    const [persistedCo] = await ctx.db
      .select()
      .from(comInvoicesAndFiscal)
      .where(
        and(
          eq(comInvoicesAndFiscal.tenantId, 'ten_a'),
          eq(comInvoicesAndFiscal.id, coStamped.id),
        ),
      );
    expect(persistedCo?.dianCufeSha384).toBe(coStamped.dianCufeSha384);

    const [actionLog] = await ctx.db
      .select()
      .from(kernelActionLogs)
      .where(
        and(
          eq(kernelActionLogs.tenantId, 'ten_a'),
          eq(kernelActionLogs.resourceId, coStamped.id),
        ),
      );
    expect(actionLog?.commandId).toBe('regional.fiscal.stamp');
  });

  it('enforces idempotency replay/409 conflict, integer inputs, and tenant/org isolation (404/403)', async () => {
    const ctx = makeRegionalCtx(env.DB, { regionPack: 'us' });
    const payload = regionalFiscalStampCommand.inputSchema.parse({
      clientMutationId: 'mut_stamp_idem_1',
      regionPack: 'us',
      invoiceNumber: 'INV-US-IDEM-1',
      currency: 'USD',
      subtotalMinor: 10_000,
      us: { jurisdictionCode: 'US-TX', jurisdictionTaxRateBps: 825 },
    });

    const first = await regionalFiscalStampCommand.handler(ctx, payload);
    expect(first.taxMinor).toBe(825);

    const replayed = await regionalFiscalStampCommand.handler(ctx, payload);
    expect(replayed).toEqual(first);

    await expect(
      regionalFiscalStampCommand.handler(ctx, { ...payload, subtotalMinor: 12_000 }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });

    await expect(
      regionalFiscalStampCommand.handler(ctx, {
        ...payload,
        clientMutationId: 'mut_stamp_dup_inv',
      }),
    ).rejects.toMatchObject({ code: 'INVOICE_NUMBER_ALREADY_EXISTS', status: 409 });

    expect(() =>
      regionalFiscalStampCommand.inputSchema.parse({
        clientMutationId: 'mut_float',
        invoiceNumber: 'INV-FLOAT',
        subtotalMinor: 100.5,
      }),
    ).toThrow();

    await expect(
      regionalFiscalStampCommand.handler(ctx, {
        ...payload,
        clientMutationId: 'mut_cross_tenant_org',
        invoiceNumber: 'INV-XT-1',
        orgId: 'org_b',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await expect(
      regionalFiscalStampCommand.handler(ctx, {
        ...payload,
        clientMutationId: 'mut_sibling_org',
        invoiceNumber: 'INV-SIB-1',
        orgId: 'org_a_other',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ORG_SCOPE', status: 403 });

    await expect(
      regionalFiscalStampCommand.handler(ctx, {
        ...payload,
        clientMutationId: 'mut_cross_tenant_party',
        invoiceNumber: 'INV-XTP-1',
        partyId: 'pty_b',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    await expect(
      regionalFiscalStampCommand.handler(ctx, {
        ...payload,
        clientMutationId: 'mut_sibling_party',
        invoiceNumber: 'INV-SIBP-1',
        partyId: 'pty_a_other',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ORG_SCOPE', status: 403 });

    await expect(
      regionalFiscalStampCommand.handler(ctx, {
        ...payload,
        clientMutationId: 'mut_cross_tenant_order',
        invoiceNumber: 'INV-XTO-1',
        orderId: 'ord_b',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
