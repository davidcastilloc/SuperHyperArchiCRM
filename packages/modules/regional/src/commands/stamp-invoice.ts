import {
  buildActionLogInsert,
  buildIdempotencyInsert,
  checkIdempotency,
  comInvoicesAndFiscal,
  type ShacD1Database,
} from '@shac/db-d1';
import { AppError, defineCommand, sha256Hex } from '@shac/kernel';
import { and, eq } from 'drizzle-orm';
import { computeRegionalFiscalBreakdown } from '../fiscal-engines.js';
import { validateRegionalTaxId } from '../tax-ids.js';
import {
  stampInvoiceInputSchema,
  stampInvoiceOutputSchema,
  type StampInvoiceOutput,
} from './stamp-schemas.js';
import { assertOptionalRefScope, resolveTargetOrg } from './stamp-scope.js';

export const regionalFiscalStampCommand = defineCommand<
  typeof stampInvoiceInputSchema,
  StampInvoiceOutput,
  ShacD1Database
>({
  id: 'regional.fiscal.stamp',
  moduleId: 'regional',
  method: 'POST',
  path: '/api/regional/fiscal/stamp',
  summary: 'Compute regional tax breakdown and stamp an invoice in com_invoices_and_fiscal',
  requiredPermission: 'regional.fiscal.write',
  mcp: {
    expose: true,
    idempotentHint: true,
    description:
      'Compute regional taxes/CUFE/CFDI/OXXO/SPEI/HKA Z and persist fiscal invoice idempotently',
  },
  inputSchema: stampInvoiceInputSchema,
  outputSchema: stampInvoiceOutputSchema,
  async handler(ctx, input) {
    const requestHash = await sha256Hex(
      JSON.stringify({
        commandId: 'regional.fiscal.stamp',
        ...input,
        clientMutationId: undefined,
      }),
    );

    const replay = await checkIdempotency(
      ctx.db,
      ctx.tenantId,
      input.clientMutationId,
      requestHash,
      stampInvoiceOutputSchema,
    );
    if (replay) return replay;

    const targetOrgId = await resolveTargetOrg(ctx, input.orgId);
    await assertOptionalRefScope(ctx, input.partyId, input.orderId);

    const targetPack = input.regionPack ?? ctx.profile.regionPack;
    const issuerTaxId =
      input.issuerTaxId && input.issuerTaxIdType
        ? validateRegionalTaxId(targetPack, input.issuerTaxIdType, input.issuerTaxId).normalized
        : input.issuerTaxId;
    const customerTaxId =
      input.customerTaxId && input.customerTaxIdType
        ? validateRegionalTaxId(targetPack, input.customerTaxIdType, input.customerTaxId).normalized
        : input.customerTaxId;

    const nowSec = Math.floor(Date.now() / 1000);
    const parsedDateMs = input.issueDate ? Date.parse(input.issueDate) : Number.NaN;
    const issueDateSec =
      input.issueDateSec ?? (Number.isFinite(parsedDateMs) ? Math.floor(parsedDateMs / 1000) : nowSec);

    const breakdown = await computeRegionalFiscalBreakdown({
      regionPack: targetPack,
      invoiceNumber: input.invoiceNumber,
      issueDateSec,
      currency: input.currency,
      exchangeRateMicros: input.exchangeRateMicros,
      subtotalMinor: input.subtotalMinor,
      discountMinor: input.discountMinor,
      taxRateBps: input.taxRateBps,
      withholdingBps: input.withholdingBps,
      islrWithholdingBps: input.islrWithholdingBps,
      paidMinor: input.paidMinor,
      issuerTaxId,
      customerTaxId,
      lines: input.lines,
      ve: input.ve,
      co: input.co,
      mx: input.mx,
      us: input.us,
    });

    const dupRows = await ctx.db
      .select({ id: comInvoicesAndFiscal.id })
      .from(comInvoicesAndFiscal)
      .where(
        and(
          eq(comInvoicesAndFiscal.tenantId, ctx.tenantId),
          eq(comInvoicesAndFiscal.invoiceNumber, breakdown.invoiceNumber),
        ),
      )
      .limit(1);
    if (dupRows[0]) {
      throw new AppError(
        'INVOICE_NUMBER_ALREADY_EXISTS',
        409,
        `Invoice number '${breakdown.invoiceNumber}' is already stamped`,
      );
    }

    const invoiceId = crypto.randomUUID();
    const issueDate =
      input.issueDate ?? new Date(breakdown.issueDateSec * 1000).toISOString().slice(0, 10);
    const status = 'stamped';

    const customFieldsPayload = {
      ...(input.customFields ?? {}),
      ...(breakdown.veSummary ? { veSummary: breakdown.veSummary } : {}),
      ...(breakdown.coDian ? { coDian: breakdown.coDian } : {}),
      ...(breakdown.mxPayments ? { mxPayments: breakdown.mxPayments } : {}),
      ...(breakdown.usSalesTax ? { usSalesTax: breakdown.usSalesTax } : {}),
    };

    const output: StampInvoiceOutput = {
      id: invoiceId,
      tenantId: ctx.tenantId,
      orgId: targetOrgId,
      invoiceNumber: breakdown.invoiceNumber,
      orderId: input.orderId ?? null,
      partyId: input.partyId ?? null,
      issueDate,
      dueDate: input.dueDate ?? null,
      regionPack: breakdown.regionPack,
      currency: breakdown.currency,
      exchangeRateMicros: breakdown.exchangeRateMicros,
      subtotalMinor: breakdown.subtotalMinor,
      discountMinor: breakdown.discountMinor,
      taxableBaseMinor: breakdown.taxableBaseMinor,
      appliedTaxRateBps: breakdown.appliedTaxRateBps,
      statutoryTaxRateBps: breakdown.statutoryTaxRateBps,
      isTaxExempt: breakdown.isTaxExempt,
      taxMinor: breakdown.taxMinor,
      withholdingBps: breakdown.withholdingBps,
      withholdingMinor: breakdown.withholdingMinor,
      totalMinor: breakdown.totalMinor,
      netPayableMinor: breakdown.netPayableMinor,
      paidMinor: breakdown.paidMinor,
      balanceDueMinor: breakdown.balanceDueMinor,
      fiscalControlNumber: breakdown.fiscalControlNumber,
      dianCufeSha384: breakdown.dianCufeSha384,
      satCfdiUuid: breakdown.satCfdiUuid,
      fiscalQrPayload: breakdown.fiscalQrPayload,
      hkaPrinterZReport: breakdown.hkaPrinterZReport,
      status,
      veSummary: breakdown.veSummary,
      coDian: breakdown.coDian,
      mxPayments: breakdown.mxPayments,
      usSalesTax: breakdown.usSalesTax,
      createdAt: nowSec,
    };

    const outputJson = JSON.stringify(output);
    await ctx.db.batch([
      ctx.db.insert(comInvoicesAndFiscal).values({
        id: invoiceId,
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        invoiceNumber: breakdown.invoiceNumber,
        orderId: input.orderId ?? null,
        bookingOrLeaseId: input.bookingOrLeaseId ?? null,
        caseOrEncounterId: input.caseOrEncounterId ?? null,
        partyId: input.partyId ?? null,
        issueDate,
        dueDate: input.dueDate ?? null,
        currency: breakdown.currency,
        exchangeRateMicros: breakdown.exchangeRateMicros,
        subtotalMinor: breakdown.subtotalMinor,
        discountMinor: breakdown.discountMinor,
        taxMinor: breakdown.taxMinor,
        withholdingMinor: breakdown.withholdingMinor,
        totalMinor: breakdown.totalMinor,
        paidMinor: breakdown.paidMinor,
        balanceDueMinor: breakdown.balanceDueMinor,
        regionPack: breakdown.regionPack,
        fiscalControlNumber: breakdown.fiscalControlNumber,
        dianCufeSha384: breakdown.dianCufeSha384,
        satCfdiUuid: breakdown.satCfdiUuid,
        fiscalQrPayload: breakdown.fiscalQrPayload,
        hkaPrinterZReport: breakdown.hkaPrinterZReport,
        isConsolidated24h: input.isConsolidated24h,
        consolidationClosesAt: input.consolidationClosesAt ?? null,
        pdfR2Key: input.pdfR2Key ?? null,
        status,
        customFields: JSON.stringify(customFieldsPayload),
        version: 1,
        createdAt: nowSec,
        updatedAt: nowSec,
      }),
      buildIdempotencyInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        clientMutationId: input.clientMutationId,
        commandId: 'regional.fiscal.stamp',
        requestHash,
        responseJson: outputJson,
        nowSec,
      }),
      buildActionLogInsert(ctx.db, {
        tenantId: ctx.tenantId,
        orgId: targetOrgId,
        actor: ctx.actor,
        commandId: 'regional.fiscal.stamp',
        resourceKind: 'com_invoices_and_fiscal',
        resourceId: invoiceId,
        targetPartyId: input.partyId ?? null,
        snapshotAfterJson: outputJson,
        nowSec,
      }),
    ]);

    return output;
  },
});
