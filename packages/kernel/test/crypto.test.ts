import { describe, expect, it } from 'vitest';
import {
  canonicalizeJson,
  canonicalJsonSha256Hex,
  generateEd25519KeyPair,
  hashPasswordPbkdf2,
  sha256Hex,
  signHmacSha256Hex,
  signJwtEdDsa,
  verifyHmacSha256ConstantTime,
  verifyJwtEdDsa,
  verifyPasswordPbkdf2,
  verifyTimestampWindow,
} from '../src/index.js';

describe('@shac/kernel WebCrypto primitives', () => {
  it('hashes and verifies password asynchronously with constant-time comparison', async () => {
    const hash = await hashPasswordPbkdf2('CorrectHorseBatteryStaple!');
    expect(await verifyPasswordPbkdf2('CorrectHorseBatteryStaple!', hash)).toBe(true);
    expect(await verifyPasswordPbkdf2('WrongPassword!', hash)).toBe(false);
  });

  it('signs and verifies Ed25519 JWT and rejects expired or tampered tokens', async () => {
    const keys = await generateEd25519KeyPair();
    const token = await signJwtEdDsa(
      {
        sub: 'usr_1',
        tenantId: 'ten_1',
        orgId: 'org_1',
        orgPath: '/org_1',
        actorType: 'staff',
        perms: ['iam.read'],
      },
      keys.privateKeyJwk,
      60,
    );
    const claims = await verifyJwtEdDsa(token, keys.publicKeyJwk);
    expect(claims.sub).toBe('usr_1');
    await expect(
      verifyJwtEdDsa(token, keys.publicKeyJwk, Math.floor(Date.now() / 1000) + 120),
    ).rejects.toThrow();

    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.invalid_sig`;
    await expect(verifyJwtEdDsa(tampered, keys.publicKeyJwk)).rejects.toThrow();
    expect((await sha256Hex('mk_live_test')).length).toBe(64);
  });

  it('canonicalizes JSON, hashes deterministically, verifies HMAC in constant time and timestamp window', async () => {
    expect(canonicalizeJson({ b: 2, a: 1, c: undefined })).toBe('{"a":1,"b":2}');
    const h1 = await canonicalJsonSha256Hex({ b: 2, a: 1 });
    const h2 = await canonicalJsonSha256Hex({ a: 1, b: 2 });
    expect(h1).toBe(h2);

    const sig = await signHmacSha256Hex('secret-key', 'hello-shac');
    expect(await verifyHmacSha256ConstantTime('secret-key', 'hello-shac', sig)).toBe(true);
    expect(await verifyHmacSha256ConstantTime('wrong-key', 'hello-shac', sig)).toBe(false);
    expect(await verifyHmacSha256ConstantTime('secret-key', 'hello-shac', 'not-hex')).toBe(false);

    expect(verifyTimestampWindow(100_000, 150_000, 300_000)).toBe(true);
    expect(verifyTimestampWindow(100_000, 500_000, 300_000)).toBe(false);
    expect(verifyTimestampWindow(Number.NaN, 100_000)).toBe(false);
  });
});
