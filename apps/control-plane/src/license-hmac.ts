import {
  signHmacSha256Hex,
  verifyHmacSha256ConstantTime,
} from '@shac/kernel';

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
  const message = buildCanonicalMessage(payload);
  const hmacSignature = await signHmacSha256Hex(secret, message);
  return {
    licenseId: payload.licenseId,
    deploymentId: payload.deploymentId,
    hardwareFingerprint: payload.hardwareFingerprint,
    editionPreset: payload.editionPreset ?? 'omni-enterprise',
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    revokedAt: payload.revokedAt ?? null,
    hmacSignature,
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

  if (!secret || !license.hmacSignature) {
    return { ...base, valid: false, reason: 'INVALID_SIGNATURE' };
  }

  const message = buildCanonicalMessage(license);
  const ok = await verifyHmacSha256ConstantTime(
    secret,
    message,
    license.hmacSignature,
  );

  if (!ok) {
    return { ...base, valid: false, reason: 'INVALID_SIGNATURE' };
  }

  return { ...base, valid: true, reason: 'OK' };
}
