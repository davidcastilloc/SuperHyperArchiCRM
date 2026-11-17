import { describe, expect, it } from 'vitest';
import {
  assertBranchScope,
  assertOrgScope,
  assertTenantScope,
  wrapD1WithCounter,
} from '../src/index.js';

describe('@shac/db-d1 tenant & org subtree guard', () => {
  it('allows exact org and child orgs, blocks sibling orgs and cross-tenant access', () => {
    const ctx = { tenantId: 'ten_a', orgPath: '/root/north' };
    expect(() => assertOrgScope(ctx, 'ten_a', '/root/north')).not.toThrow();
    expect(() => assertOrgScope(ctx, 'ten_a', '/root/north/store-1')).not.toThrow();
    expect(() => assertOrgScope(ctx, 'ten_a', '/root/north-east')).toThrow(/FORBIDDEN_ORG_SCOPE/);
    expect(() => assertOrgScope(ctx, 'ten_b', '/root/north')).toThrow(/NOT_FOUND/);
  });

  it('handles root orgPath "/" and trailing slashes safely', () => {
    const rootCtx = { tenantId: 'ten_a', orgPath: '/' };
    expect(() => assertOrgScope(rootCtx, 'ten_a', '/')).not.toThrow();
    expect(() => assertOrgScope(rootCtx, 'ten_a', '/branch-1')).not.toThrow();
    expect(() => assertOrgScope(rootCtx, 'ten_a', '')).toThrow(/FORBIDDEN_ORG_SCOPE/);

    const trailingCtx = { tenantId: 'ten_a', orgPath: '/root/north/' };
    expect(() => assertOrgScope(trailingCtx, 'ten_a', '/root/north/store-1')).not.toThrow();
    expect(() => assertOrgScope(trailingCtx, 'ten_a', '/root/north-east')).toThrow(/FORBIDDEN_ORG_SCOPE/);
  });
});

describe('@shac/db-d1 wrapD1WithCounter', () => {
  it('counts prepared statements, batch statements, and exec calls', async () => {
    const makeStmt = (): D1PreparedStatement => {
      const stmt = {
        bind: () => stmt,
        first: async () => null,
        run: async () => ({ success: true, meta: {} as D1Meta, results: [] }),
        all: async () => ({ success: true, meta: {} as D1Meta, results: [] }),
        raw: async () => [],
      };
      return stmt as unknown as D1PreparedStatement;
    };

    const fakeD1 = {
      prepare: () => makeStmt(),
      batch: async (stmts: D1PreparedStatement[]) =>
        stmts.map(() => ({ success: true, meta: {} as D1Meta, results: [] })),
      exec: async () => ({ count: 1, duration: 1 }),
      dump: async () => new ArrayBuffer(0),
    } as unknown as D1Database;

    const { db, getQueryCount } = wrapD1WithCounter(fakeD1);
    expect(getQueryCount()).toBe(0);

    await db.prepare('SELECT 1').bind('a').first();
    expect(getQueryCount()).toBe(1);

    await db.batch([db.prepare('SELECT 1'), db.prepare('SELECT 2')]);
    expect(getQueryCount()).toBe(3);

    await db.exec('SELECT 1');
    expect(getQueryCount()).toBe(4);
  });
});

describe('@shac/db-d1 tenant and branch scope guards', () => {
  it('enforces orgId and branchId presence', () => {
    expect(() => assertTenantScope(null)).toThrow('TENANT_SCOPE_MISSING_ORG_ID');
    expect(() => assertTenantScope({ orgId: '   ' })).toThrow('TENANT_SCOPE_MISSING_ORG_ID');

    expect(assertTenantScope({ orgId: ' org_1 ' })).toEqual({
      orgId: 'org_1',
      branchId: null,
      actorId: 'system',
      roles: [],
    });

    expect(() => assertBranchScope({ orgId: 'org_1' })).toThrow(
      'TENANT_SCOPE_MISSING_BRANCH_ID',
    );
    expect(assertBranchScope({ orgId: 'org_1', branchId: 'br_1', actorId: 'usr_1' })).toEqual({
      orgId: 'org_1',
      branchId: 'br_1',
      actorId: 'usr_1',
      roles: [],
    });
  });
});
