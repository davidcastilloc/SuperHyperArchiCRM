import { AppError, type ActorType } from './contracts.js';

export interface JwtActorClaims {
  sub: string;
  tenantId: string;
  orgId: string;
  orgPath: string;
  actorType: ActorType;
  perms: string[];
  delegatedById?: string;
  iat?: number;
  exp?: number;
}

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = 'SHA-256';
const PBKDF2_KEY_BITS = 256;
const SALT_BYTES = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new AppError('INVALID_HEX', 400, 'Malformed hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const parsed = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(parsed)) {
      throw new AppError('INVALID_HEX', 400, 'Malformed hex byte');
    }
    bytes[i] = parsed;
  }
  return bytes;
}

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

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

async function derivePbkdf2Bits(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as Uint8Array<ArrayBuffer>,
      iterations,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    PBKDF2_KEY_BITS,
  );
  return new Uint8Array(derived);
}

export async function hashPasswordPbkdf2(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derivePbkdf2Bits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`;
}

export async function verifyPasswordPbkdf2(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false;
  }
  const iterations = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(iterations) || iterations < 1) {
    return false;
  }
  try {
    const salt = fromHex(parts[2] ?? '');
    const expected = fromHex(parts[3] ?? '');
    const actual = await derivePbkdf2Bits(password, salt, iterations);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function generateEd25519KeyPair(): Promise<{
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;

  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', keyPair.publicKey) as Promise<JsonWebKey>,
    crypto.subtle.exportKey('jwk', keyPair.privateKey) as Promise<JsonWebKey>,
  ]);

  return { publicKeyJwk, privateKeyJwk };
}

export async function signJwtEdDsa(
  payload: JwtActorClaims,
  privateKeyJwk: JsonWebKey,
  ttlSeconds: number,
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const claims: JwtActorClaims = {
    ...payload,
    iat: payload.iat ?? nowSec,
    exp: payload.exp ?? nowSec + ttlSeconds,
  };

  const headerSegment = toBase64Url(
    encoder.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })),
  );
  const payloadSegment = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${headerSegment}.${payloadSegment}`;

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
    encoder.encode(signingInput),
  );

  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyJwtEdDsa(
  token: string,
  publicKeyJwk: JsonWebKey,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<JwtActorClaims> {
  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new AppError('INVALID_TOKEN', 401, 'Malformed JWT');
  }
  const [headerSeg, payloadSeg, sigSeg] = segments;
  if (!headerSeg || !payloadSeg || !sigSeg) {
    throw new AppError('INVALID_TOKEN', 401, 'Malformed JWT segments');
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromBase64Url(sigSeg);
  } catch {
    throw new AppError('INVALID_TOKEN', 401, 'Invalid JWT signature encoding');
  }

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'Ed25519' },
    false,
    ['verify'],
  );

  const valid = await crypto.subtle.verify(
    'Ed25519',
    publicKey,
    signatureBytes as Uint8Array<ArrayBuffer>,
    encoder.encode(`${headerSeg}.${payloadSeg}`),
  );

  if (!valid) {
    throw new AppError('INVALID_TOKEN', 401, 'Invalid JWT signature');
  }

  let claims: JwtActorClaims;
  try {
    claims = JSON.parse(
      decoder.decode(fromBase64Url(payloadSeg)),
    ) as JwtActorClaims;
  } catch {
    throw new AppError('INVALID_TOKEN', 401, 'Invalid JWT payload');
  }

  if (typeof claims.exp !== 'number' || claims.exp <= nowSec) {
    throw new AppError('TOKEN_EXPIRED', 401, 'JWT has expired');
  }

  return claims;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(new Uint8Array(digest));
}
