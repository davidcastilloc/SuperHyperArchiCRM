export interface ApplianceLicensePayload {
  licenseId: string;
  deploymentId: string;
  hardwareFingerprint: string;
  editionPreset?: string;
  issuedAt: number;
  expiresAt: number | null;
  revokedAt?: number | null;
}

export interface SignedApplianceLicense extends ApplianceLicensePayload {
  hmacSignature: string;
  revokedAt: number | null;
}

export type LicenseVerifyReason =
  | 'OK'
  | 'REVOKED'
  | 'HARDWARE_MISMATCH'
  | 'EXPIRED'
  | 'INVALID_SIGNATURE';

export interface LicenseVerifyResult {
  valid: boolean;
  reason: LicenseVerifyReason;
  licenseId: string;
  deploymentId: string;
}

const encoder = new TextEncoder();

function buildCanonicalMessage(payload: ApplianceLicensePayload): string {
  return [
    'shac-license-v1',
    payload.licenseId,
    payload.deploymentId,
    payload.hardwareFingerprint,
    payload.editionPreset ?? 'omni-enterprise',
    String(payload.issuedAt),
    payload.expiresAt === null ? 'perpetual' : String(payload.expiresAt),
  ].join('|');
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Signs an offline-verifiable appliance license using WebCrypto HMAC-SHA256.
 */
export async function signApplianceLicense(
  payload: ApplianceLicensePayload,
  secret: string,
): Promise<SignedApplianceLicense> {
  if (!secret) {
    throw new Error('HMAC secret must not be empty');
  }
  const key = await importHmacKey(secret);
  const message = buildCanonicalMessage(payload);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return {
    licenseId: payload.licenseId,
    deploymentId: payload.deploymentId,
    hardwareFingerprint: payload.hardwareFingerprint,
    editionPreset: payload.editionPreset ?? 'omni-enterprise',
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    revokedAt: payload.revokedAt ?? null,
    hmacSignature: bytesToHex(new Uint8Array(sigBuffer)),
  };
}

/**
 * Verifies an appliance license using constant-time WebCrypto HMAC-SHA256.
 * Rejects revoked, hardware-mismatched, expired, or tampered licenses.
 */
export async function verifyApplianceLicense(
  license: SignedApplianceLicense,
  secret: string,
  expectedFingerprint: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<LicenseVerifyResult> {
  const base = {
    licenseId: license.licenseId,
    deploymentId: license.deploymentId,
  };

  if (license.revokedAt !== null && license.revokedAt !== undefined) {
    return { ...base, valid: false, reason: 'REVOKED' };
  }

  if (license.hardwareFingerprint !== expectedFingerprint) {
    return { ...base, valid: false, reason: 'HARDWARE_MISMATCH' };
  }

  if (license.expiresAt !== null && nowSec >= license.expiresAt) {
    return { ...base, valid: false, reason: 'EXPIRED' };
  }

  const sigBytes = hexToBytes(license.hmacSignature);
  if (!sigBytes || !secret) {
    return { ...base, valid: false, reason: 'INVALID_SIGNATURE' };
  }

  const key = await importHmacKey(secret);
  const message = buildCanonicalMessage(license);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    encoder.encode(message),
  );

  if (!ok) {
    return { ...base, valid: false, reason: 'INVALID_SIGNATURE' };
  }

  return { ...base, valid: true, reason: 'OK' };
}
