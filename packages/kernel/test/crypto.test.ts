import { describe, expect, it } from 'vitest';
import {
  generateEd25519KeyPair,
  hashPasswordPbkdf2,
  sha256Hex,
  signJwtEdDsa,
  verifyJwtEdDsa,
  verifyPasswordPbkdf2,
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
});
