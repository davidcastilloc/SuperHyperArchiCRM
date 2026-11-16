import { describe, expect, it } from 'vitest';
import {
  computeClabeCheckDigit,
  computeRegionalFiscalBreakdown,
  sha384Hex,
  validateSpeiClabe,
} from '../src/fiscal-engines.js';
import {
  computeCoNitCheckDigit,
  validateRegionalTaxId,
} from '../src/tax-ids.js';

describe('@shac/mod-regional tax-ids & fiscal engines on workerd', () => {
  it('validates ve RIF/CEDULA, co NIT Modulo-11/CC, mx RFC 12/13, us EIN & rejects 422 INVALID_TAX_ID', () => {
    const rif = validateRegionalTaxId('ve', 'RIF', 'j-40123456-7');
    expect(rif.normalized).toBe('J401234567');
    expect(rif.formatted).toBe('J-40123456-7');

    const cedula = validateRegionalTaxId('ve', 'CEDULA', 'V-18.444.555');
    expect(cedula.normalized).toBe('V18444555');
    expect(cedula.formatted).toBe('V-18444555');

    // Known real-world DIAN Modulo-11 check digits: 890900608-9, 899999068-1, 900123456-8
    expect(computeCoNitCheckDigit('890900608')).toBe(9);
    expect(computeCoNitCheckDigit('899999068')).toBe(1);
    const nit = validateRegionalTaxId('co', 'NIT', '900.123.456-8');
    expect(nit.normalized).toBe('9001234568');
    expect(nit.formatted).toBe('900123456-8');
    expect(nit.checkDigit).toBe('8');

    const cc = validateRegionalTaxId('co', 'CC', '1.020.304.050');
    expect(cc.normalized).toBe('1020304050');

    const rfcMoral = validateRegionalTaxId('mx', 'RFC', 'abc010203ab1');
    expect(rfcMoral.normalized).toBe('ABC010203AB1');
    const rfcFisica = validateRegionalTaxId('mx', 'RFC', 'XAXX010101000');
    expect(rfcFisica.normalized).toBe('XAXX010101000');

    const ein = validateRegionalTaxId('us', 'EIN', '12-3456789');
    expect(ein.normalized).toBe('123456789');
    expect(ein.formatted).toBe('12-3456789');

    expect(() => validateRegionalTaxId('ve', 'RIF', 'X-40123456-7')).toThrowError(
      expect.objectContaining({ code: 'INVALID_TAX_ID', status: 422 }),
    );
    expect(() => validateRegionalTaxId('co', 'NIT', '900123456-0')).toThrowError(
      expect.objectContaining({ code: 'INVALID_TAX_ID', status: 422 }),
    );
    expect(() => validateRegionalTaxId('mx', 'RFC', 'INVALID')).toThrowError(
      expect.objectContaining({ code: 'INVALID_TAX_ID', status: 422 }),
    );
    expect(() => validateRegionalTaxId('us', 'EIN', '123-45-6789')).toThrowError(
      expect.objectContaining({ code: 'INVALID_TAX_ID', status: 422 }),
    );
    expect(() => validateRegionalTaxId('co', 'RFC', 'XAXX010101000')).toThrowError(
      expect.objectContaining({ code: 'INVALID_TAX_ID', status: 422 }),
    );
  });

  it('computes ve IVA 1600/800/0 bps, ISLR withholding, and HKA thermal Z summary', async () => {
    const ve = await computeRegionalFiscalBreakdown({
      regionPack: 've',
      invoiceNumber: 'FAC-VE-001',
      issueDateSec: 1_763_300_000,
      currency: 'VES',
      exchangeRateMicros: 45_250_000,
      subtotalMinor: 30_000,
      discountMinor: 0,
      islrWithholdingBps: 300,
      issuerTaxId: 'J401234567',
      customerTaxId: 'V18444555',
      lines: [
        { subtotalMinor: 10_000, taxRateBps: 1600 },
        { subtotalMinor: 10_000, taxRateBps: 800 },
        { subtotalMinor: 10_000, taxRateBps: 0 },
      ],
      ve: { printerSerial: 'HKA-80-99', zReportNumber: 'Z-0042' },
    });

    expect(ve.taxMinor).toBe(2_400);
    expect(ve.withholdingMinor).toBe(900);
    expect(ve.totalMinor).toBe(32_400);
    expect(ve.netPayableMinor).toBe(31_500);
    expect(ve.balanceDueMinor).toBe(31_500);
    expect(ve.veSummary?.baseGeneralMinor).toBe(10_000);
    expect(ve.veSummary?.ivaGeneralMinor).toBe(1_600);
    expect(ve.veSummary?.baseReducedMinor).toBe(10_000);
    expect(ve.veSummary?.ivaReducedMinor).toBe(800);
    expect(ve.veSummary?.baseExemptMinor).toBe(10_000);
    expect(ve.veSummary?.printerSerial).toBe('HKA-80-99');
    expect(ve.hkaPrinterZReport).toBeTruthy();

    await expect(
      computeRegionalFiscalBreakdown({
        regionPack: 've',
        invoiceNumber: 'FAC-VE-BAD',
        currency: 'VES',
        subtotalMinor: 10_000,
        taxRateBps: 1900,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TAX_RATE', status: 422 });
  });

  it('computes co IVA 1900 bps + WebCrypto SHA-384 CUFE & QR payload in workerd', async () => {
    const co = await computeRegionalFiscalBreakdown({
      regionPack: 'co',
      invoiceNumber: 'FE-CO-100',
      issueDateSec: 1_763_300_000,
      currency: 'COP',
      subtotalMinor: 100_000,
      discountMinor: 10_000,
      issuerTaxId: '9001234568',
      customerTaxId: '1020304050',
    });

    expect(co.taxableBaseMinor).toBe(90_000);
    expect(co.appliedTaxRateBps).toBe(1900);
    expect(co.taxMinor).toBe(17_100);
    expect(co.totalMinor).toBe(107_100);
    expect(co.dianCufeSha384).toMatch(/^[0-9a-f]{96}$/);
    expect(co.fiscalQrPayload).toContain(`CUFE=${co.dianCufeSha384}`);
    expect(co.fiscalQrPayload).toContain('catalogo-vpfe.dian.gov.co');

    const directHash = await sha384Hex('test-workerd-sha384');
    expect(directHash).toHaveLength(96);
  });

  it('computes mx IVA 1600 bps + CFDI 4.0 UUID/QR + 14-digit OXXO + 18-digit Banxico SPEI CLABE', async () => {
    const mx = await computeRegionalFiscalBreakdown({
      regionPack: 'mx',
      invoiceNumber: 'CFDI-MX-55',
      issueDateSec: 1_763_300_000,
      currency: 'MXN',
      subtotalMinor: 50_000,
      issuerTaxId: 'ABC010203AB1',
      customerTaxId: 'XAXX010101000',
    });

    expect(mx.appliedTaxRateBps).toBe(1600);
    expect(mx.taxMinor).toBe(8_000);
    expect(mx.totalMinor).toBe(58_000);
    expect(mx.satCfdiUuid).toMatch(
      /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/,
    );
    expect(mx.mxPayments?.oxxoPayReference).toMatch(/^\d{14}$/);
    expect(mx.mxPayments?.speiClabe).toMatch(/^\d{18}$/);
    const clabe = mx.mxPayments?.speiClabe ?? '';
    expect(validateSpeiClabe(clabe)).toBe(clabe);
    expect(Number(clabe[17])).toBe(computeClabeCheckDigit(clabe.slice(0, 17)));
    expect(mx.fiscalQrPayload).toContain(`id=${mx.satCfdiUuid}`);
    expect(mx.fiscalQrPayload).toContain('verificacfdi.facturaelectronica.sat.gob.mx');
  });

  it('computes us jurisdiction Sales Tax bps and B2B tax exemption override', async () => {
    const taxable = await computeRegionalFiscalBreakdown({
      regionPack: 'us',
      invoiceNumber: 'INV-US-1',
      issueDateSec: 1_763_300_000,
      currency: 'USD',
      subtotalMinor: 10_000,
      us: {
        jurisdictionCode: 'US-NY-NYC',
        jurisdictionTaxRateBps: 887,
        isTaxExempt: false,
      },
    });
    expect(taxable.appliedTaxRateBps).toBe(887);
    expect(taxable.taxMinor).toBe(887);
    expect(taxable.totalMinor).toBe(10_887);
    expect(taxable.usSalesTax?.isTaxExempt).toBe(false);

    const exempt = await computeRegionalFiscalBreakdown({
      regionPack: 'us',
      invoiceNumber: 'INV-US-2',
      issueDateSec: 1_763_300_000,
      currency: 'USD',
      subtotalMinor: 10_000,
      us: {
        jurisdictionCode: 'US-NY-NYC',
        jurisdictionTaxRateBps: 887,
        isTaxExempt: true,
        b2bExemptionCertificate: 'NY-ST120-9988',
      },
    });
    expect(exempt.statutoryTaxRateBps).toBe(887);
    expect(exempt.appliedTaxRateBps).toBe(0);
    expect(exempt.taxMinor).toBe(0);
    expect(exempt.totalMinor).toBe(10_000);
    expect(exempt.usSalesTax?.isTaxExempt).toBe(true);
    expect(exempt.usSalesTax?.b2bExemptionCertificate).toBe('NY-ST120-9988');
  });
});
