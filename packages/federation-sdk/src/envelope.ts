import { AppError, sha256Hex } from '@shac/kernel';
import { z } from 'zod';

export const ANTI_REPLAY_WINDOW_MS = 300_000;

export const FederationEventTypeSchema = z.enum([
  'CATALOG_OFFER_UPSERTED',
  'CATALOG_OFFER_WITHDRAWN',
  'B2B_RFQ_REQUESTED',
  'B2B_PO_SUBMITTED',
  'B2B_PO_ACCEPTED',
  'B2B_PO_BACKORDERED',
  'B2B_SHIPMENT_DISPATCHED',
  'B2B_EPOD_CONFIRMED',
]);

export type FederationEventType = z.infer<typeof FederationEventTypeSchema>;

export const FederationEnvelopeSchema = z.object({
  envelopeId: z.string().min(1),
  protocolVersion: z.literal('1.0'),
  senderDid: z.string().min(1),
  recipientDid: z.string().min(1),
  eventType: FederationEventTypeSchema,
  issuedAt: z.number().int(),
  payloadHashSha256: z.string().min(1),
  signatureEd25519: z.string().min(1),
  payload: z.record(z.unknown()),
});

export type FederationEnvelope = z.infer<typeof FederationEnvelopeSchema>;

export interface SignFederationEnvelopeInput {
  envelopeId: string;
  senderDid: string;
  recipientDid: string;
  eventType: FederationEventType;
  payload: Record<string, unknown>;
  issuedAt?: number;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Produces deterministic JSON with lexicographically sorted object keys.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 'null' : serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const pairs: string[] = [];
  for (const key of keys) {
    const entry = record[key];
    if (entry === undefined) continue;
    pairs.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
  }
  return `{${pairs.join(',')}}`;
}

export async function computePayloadSha256Hex(
  payload: Record<string, unknown>,
): Promise<string> {
  return sha256Hex(canonicalJson(payload));
}

function buildSigningBytes(envelope: {
  envelopeId: string;
  protocolVersion: '1.0';
  senderDid: string;
  recipientDid: string;
  eventType: FederationEventType;
  issuedAt: number;
  payloadHashSha256: string;
}): Uint8Array {
  return encoder.encode(
    canonicalJson({
      envelopeId: envelope.envelopeId,
      protocolVersion: envelope.protocolVersion,
      senderDid: envelope.senderDid,
      recipientDid: envelope.recipientDid,
      eventType: envelope.eventType,
      issuedAt: envelope.issuedAt,
      payloadHashSha256: envelope.payloadHashSha256,
    }),
  );
}

export async function signFederationEnvelope(
  input: SignFederationEnvelopeInput,
  privateKeyJwk: JsonWebKey,
): Promise<FederationEnvelope> {
  const issuedAt = input.issuedAt ?? Date.now();
  const payloadHashSha256 = await computePayloadSha256Hex(input.payload);

  const signingBytes = buildSigningBytes({
    envelopeId: input.envelopeId,
    protocolVersion: '1.0',
    senderDid: input.senderDid,
    recipientDid: input.recipientDid,
    eventType: input.eventType,
    issuedAt,
    payloadHashSha256,
  });

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    signingBytes as Uint8Array<ArrayBuffer>,
  );

  return FederationEnvelopeSchema.parse({
    envelopeId: input.envelopeId,
    protocolVersion: '1.0',
    senderDid: input.senderDid,
    recipientDid: input.recipientDid,
    eventType: input.eventType,
    issuedAt,
    payloadHashSha256,
    signatureEd25519: toBase64Url(new Uint8Array(signature)),
    payload: input.payload,
  });
}

export async function verifyFederationEnvelope(
  rawEnvelope: unknown,
  senderPublicKeyJwk: JsonWebKey,
  nowMs: number = Date.now(),
): Promise<FederationEnvelope> {
  const parsed = FederationEnvelopeSchema.safeParse(rawEnvelope);
  if (!parsed.success) {
    throw new AppError(
      'INVALID_ENVELOPE',
      400,
      'Malformed federation envelope',
      parsed.error.flatten(),
    );
  }
  const envelope = parsed.data;

  if (Math.abs(nowMs - envelope.issuedAt) > ANTI_REPLAY_WINDOW_MS) {
    throw new AppError(
      'REPLAY_WINDOW_EXCEEDED',
      401,
      'Envelope issuedAt is outside the 300s anti-replay window',
    );
  }

  const expectedHash = await computePayloadSha256Hex(envelope.payload);
  if (expectedHash !== envelope.payloadHashSha256) {
    throw new AppError(
      'PAYLOAD_HASH_MISMATCH',
      401,
      'Envelope payload SHA-256 hash mismatch',
    );
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromBase64Url(envelope.signatureEd25519);
  } catch {
    throw new AppError(
      'INVALID_SIGNATURE',
      401,
      'Malformed Ed25519 signature encoding',
    );
  }

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    senderPublicKeyJwk,
    { name: 'Ed25519' },
    false,
    ['verify'],
  );

  const signingBytes = buildSigningBytes(envelope);
  const valid = await crypto.subtle.verify(
    'Ed25519',
    publicKey,
    signatureBytes as Uint8Array<ArrayBuffer>,
    signingBytes as Uint8Array<ArrayBuffer>,
  );

  if (!valid) {
    throw new AppError(
      'INVALID_SIGNATURE',
      401,
      'Invalid Ed25519 envelope signature',
    );
  }

  return envelope;
}
