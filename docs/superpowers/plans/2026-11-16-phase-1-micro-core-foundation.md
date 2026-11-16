# Phase 1: Micro-Core Foundation Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir y verificar en `workerd` real los cimientos del Micro-Core (`@shac/kernel`, `@shac/db-d1`, `@shac/mod-iam` y `@shac/node-worker`) cumpliendo `< 200 KiB gzip` y autenticación WebCrypto `< 1.5 ms` CPU.

**Architecture:** Monorepo `pnpm` con paquetes ES Modules puros (`"sideEffects": false`). Cada caso de uso se define una sola vez mediante `defineCommand` en `@shac/kernel`, atravesando una cadena lineal (`profileLoader` -> `moduleGate` -> `authMiddleware` WebCrypto/KV) y exponiéndose simultáneamente como ruta tipada Hono RPC (`/api/*`) y herramienta MCP stateless (`/mcp` vía `createMcpHandler`). La persistencia relacional reside en Cloudflare D1 con Drizzle ORM filtrada obligatoriamente por `tenantId` y subárbol `orgPath`.

**Tech Stack:** TypeScript 5.8+, `pnpm` workspaces, Cloudflare Workers (`compatibility_date: "2026-11-01"`), `hono`, `zod`, `drizzle-orm` (SQLite/D1), `agents` (`createMcpHandler`), React 19 + Vite (`@cloudflare/vite-plugin`) + TanStack Router/Query (`offlineFirst`) + Tailwind CSS v4 + `shadcn/ui` (`@shac/ui`), `vitest` 4.1+ con `@cloudflare/vitest-plugin`, `wrangler`, `knip`.

**Spec:** `SPEC.md` (v2.2.0), `DATA_MODEL.md` (v2.2.0), `DESIGN.md` (v2.2.0) y `docs/superpowers/specs/2026-11-16-multi-market-storage-architecture.md`.

## Global Constraints

- Cero rutas absolutas dependientes del sistema operativo; usar exclusivamente rutas relativas al repositorio.
- Cero contenedores DI dinámicos (`awilix`, `tsyringe`), cero `pbkdf2Sync` / `bcrypt` JS, cero `McpAgent` basado en DO, cero `@cloudflare/vitest-pool-workers` legado.
- Todos los paquetes declaran `"type": "module"` y `"sideEffects": false`.
- Máximo `300` líneas por archivo fuente; máximo `50–200` líneas y `3` archivos de implementación por iteración.
- Importes monetarios y tasas exclusivamente como enteros (`Minor`, `Bps`, `Micros`).
- Toda consulta D1 de negocio filtra por `tenantId` y valida pertenencia a `ctx.orgPath`; máximo `<= 2` sentencias SQL por endpoint de lectura usando `db.batch()`.
- Bundle de Fase 1 en `wrangler deploy --dry-run` estrictamente `< 200 KiB gzip`.
- Identidad Git obligatoria en cada commit: `David Castillo <vikruzdavid@gmail.com>`.

## Review Focus

1. **Acceso cruzado entre inquilinos o fuera del subárbol organizacional (`orgPath`):** Un token válido del `tenant_a` o de la sucursal `/root/branch-2` intentando leer/mutar registros de `tenant_b` o `/root/branch-1` debe recibir `403 FORBIDDEN_ORG_SCOPE` o `404 NOT_FOUND` sin filtrar existencia (cubierto en Task 4 y Task 5).
2. **Invocación de comando perteneciente a un módulo apagado en `TenantMarketProfile`:** Tanto por HTTP (`/api/...`) como por MCP (`/mcp`), si `command.moduleId` no está en `profile.activeModules`, `moduleGate` debe responder `403 MODULE_NOT_ENABLED` con `0` lecturas en D1 (cubierto en Task 3 y Task 6).
3. **Expiración y trazabilidad dual de PINs de Delegación Temporal (6 dígitos):** Un PIN delegado vencido o usado desde otra organización debe rechazarse con `401 INVALID_DELEGATION_PIN`, y uno vigente debe poblar `ctx.actor.type === 'delegated_staff'` y `ctx.actor.delegatedById` (cubierto en Task 2 y Task 5).
4. ** Ausencia o corrupción de `profile:current` en `CONFIG_KV`:** Si un nodo recién aprovisionado aún no tiene clave en `CONFIG_KV` o el JSON es inválido, `profileLoader` debe fallar cerrado (`503 PROFILE_UNAVAILABLE`) y jamás abrir todos los módulos por defecto (cubierto en Task 3).
5. **Reintentos duplicados en mutaciones críticas (`clientMutationId`):** Repetir un comando de creación de organización o llave API con el mismo `clientMutationId` debe devolver exactamente el resultado original sin duplicar filas (cubierto en Task 5).

---

## File Structure

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` — Configuración raíz del monorepo, scripts `typecheck`, `test:run` y `knip`.
- `packages/kernel/package.json`, `packages/kernel/tsconfig.json`
- `packages/kernel/src/contracts.ts` — Tipos canónicos (`EditionPresetId`, `RegionPackId`, `TenantMarketProfile`, `ExecutionContext`, `CommandSpec`, `ModuleManifest`, `AppError`).
- `packages/kernel/src/crypto.ts` — Funciones WebCrypto asíncronas (`hashPasswordPbkdf2`, `verifyPasswordPbkdf2`, `signJwtEdDsa`, `verifyJwtEdDsa`, `sha256Hex`).
- `packages/kernel/src/pipeline.ts` — `createProfileLoader`, `enforceModuleGate`, `authenticateRequest`, `defineCommand`, `defineModule`.
- `packages/kernel/src/index.ts` — Re-exportación limpia sin efectos secundarios.
- `packages/db-d1/package.json`, `packages/db-d1/tsconfig.json`
- `packages/db-d1/src/schema/iam.ts` — Tablas Drizzle D1 (`iam_tenants`, `iam_organizations`, `iam_users`, `iam_api_keys`, `iam_delegation_pins`, `kernel_idempotency_keys`, `kernel_action_logs`).
- `packages/db-d1/src/scope.ts` — Guardias de alcance `assertOrgScope(ctx, targetOrgPath)` y wrapper de conteo de queries `withQueryBudget`.
- `packages/db-d1/migrations/0001_phase1_iam_core.sql` — Migración inicial estrictamente aditiva (`CREATE TABLE IF NOT EXISTS`).
- `packages/modules/iam/package.json`, `packages/modules/iam/tsconfig.json`
- `packages/modules/iam/src/commands/organizations.ts` — Comandos `iam.orgs.create` e `iam.orgs.list` (`db.batch()`).
- `packages/modules/iam/src/commands/delegation.ts` — Comandos `iam.delegation.issuePin` e `iam.apiKeys.create`.
- `packages/modules/iam/src/index.ts` — `iamModule` (`ModuleManifest`).
- `apps/node-worker/package.json`, `apps/node-worker/tsconfig.json`, `apps/node-worker/wrangler.jsonc`, `apps/node-worker/vitest.config.ts`
- `apps/node-worker/src/cors.ts` — Middleware CORS adaptativo por `CORS_ALLOWED_ORIGINS` (`< 70` líneas, `OPTIONS` en `< 0.2 ms` sin tocar D1/KV).
- `apps/node-worker/src/router.ts` — Adaptador Hono RPC + `createMcpHandler` stateless unificado.
- `apps/node-worker/src/index.ts` — Entrypoint del Worker (`fetch` + stub mínimo `BranchInventoryDO` para enlace de bindings).
- `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/src/styles/globals.css`, `packages/ui/src/components/ShacAppShell.tsx`, `packages/ui/src/components/AuthBranchGate.tsx`, `packages/ui/src/index.ts` — Sistema de diseño `DESIGN.md` en React 19 + Tailwind v4 + `shadcn/ui`.
- `apps/web-spa/package.json`, `apps/web-spa/tsconfig.json`, `apps/web-spa/vite.config.ts`, `apps/web-spa/index.html`, `apps/web-spa/src/main.tsx`, `apps/web-spa/src/lib/rpc.ts`, `apps/web-spa/src/lib/queryClient.ts` — SPA React 19 + Vite (`@cloudflare/vite-plugin`) + TanStack Router + TanStack Query (`offlineFirst` + IndexedDB).

---

### Task 1: Bootstrap del Monorepo `pnpm` y Contratos de `@shac/kernel`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- Create: `packages/kernel/package.json`, `packages/kernel/tsconfig.json`, `packages/kernel/src/contracts.ts`, `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/contracts.test.ts`

**Interfaces:**
- Consumes: Ninguna (raíz fundacional).
- Produces:
  - `defineCommand<TIn extends z.ZodTypeAny, TOut>(spec: CommandSpec<TIn, TOut>): CommandSpec<TIn, TOut>`
  - `defineModule(manifest: ModuleManifest): ModuleManifest`
  - `AppError` (`code`, `status`, `message`) y tipos `TenantMarketProfile`, `ExecutionContext`, `CommandSpec`, `ModuleManifest`.

- [ ] **Step 1: Crear configuración raíz del workspace y escribir el test fallido en `packages/kernel/test/contracts.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, defineCommand, defineModule } from '../src/index.js';

describe('@shac/kernel contracts', () => {
  it('registers typed command and preserves MCP metadata', () => {
    const ping = defineCommand({
      id: 'system.ping',
      moduleId: 'iam',
      method: 'GET',
      path: '/system/ping',
      summary: 'Health check',
      requiredPermission: 'system.read',
      mcp: { expose: true, readOnlyHint: true },
      inputSchema: z.object({ echo: z.string().min(1) }),
      outputSchema: z.object({ ok: z.literal(true), echo: z.string() }),
      handler: async (_ctx, input) => ({ ok: true as const, echo: input.echo }),
    });
    const mod = defineModule({ id: 'iam', version: '1.0.0', commands: [ping] });
    expect(mod.commands[0]?.id).toBe('system.ping');
    expect(new AppError('MODULE_NOT_ENABLED', 403, 'Disabled').status).toBe(403);
  });
});
```

- [ ] **Step 2: Instalar dependencias mínimas y verificar que el test falla**

Run: `pnpm install && pnpm --filter @shac/kernel test:run`
Expected: FAIL porque `../src/index.js` aún no exporta `defineCommand`, `defineModule` ni `AppError`.

- [ ] **Step 3: Implementar `packages/kernel/src/contracts.ts` y `packages/kernel/src/index.ts`**

Implementar todos los tipos exactos de `SPEC.md` §4.1 más la clase `AppError extends Error` y las funciones identidad tipadas `defineCommand` y `defineModule` en `< 160` líneas con `"sideEffects": false`.

- [ ] **Step 4: Ejecutar recibos de tipos, tests y `knip`**

Run: `pnpm -r typecheck && pnpm --filter @shac/kernel test:run`
Expected: PASS con código de salida `0`.

- [ ] **Step 5: Marcar `[x]` y crear commit atómico**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json packages/kernel docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md
git commit -m "feat(kernel): bootstrap pnpm workspace and core command contracts"
```

---

### Task 2: Primitivas WebCrypto Asíncronas (PBKDF2, EdDSA JWT y SHA-256)

**Files:**
- Create: `packages/kernel/src/crypto.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/crypto.test.ts`

**Interfaces:**
- Consumes: `AppError` desde `packages/kernel/src/contracts.ts`.
- Produces:
  - `hashPasswordPbkdf2(password: string): Promise<string>`
  - `verifyPasswordPbkdf2(password: string, stored: string): Promise<boolean>`
  - `generateEd25519KeyPair(): Promise<{ publicKeyJwk: JsonWebKey; privateKeyJwk: JsonWebKey }>`
  - `signJwtEdDsa(payload: JwtActorClaims, privateKeyJwk: JsonWebKey, ttlSeconds: number): Promise<string>`
  - `verifyJwtEdDsa(token: string, publicKeyJwk: JsonWebKey, nowSec?: number): Promise<JwtActorClaims>`
  - `sha256Hex(input: string): Promise<string>`

- [ ] **Step 1: Escribir el test fallido en `packages/kernel/test/crypto.test.ts`**

```ts
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
      { sub: 'usr_1', tenantId: 'ten_1', orgId: 'org_1', orgPath: '/org_1', actorType: 'staff', perms: ['iam.read'] },
      keys.privateKeyJwk,
      60,
    );
    const claims = await verifyJwtEdDsa(token, keys.publicKeyJwk);
    expect(claims.sub).toBe('usr_1');
    await expect(verifyJwtEdDsa(token, keys.publicKeyJwk, Math.floor(Date.now() / 1000) + 120)).rejects.toThrow();
    expect((await sha256Hex('mk_live_test')).length).toBe(64);
  });
});
```

- [ ] **Step 2: Ejecutar test para confirmar fallo**

Run: `pnpm --filter @shac/kernel test:run`
Expected: FAIL por exportaciones faltantes en `crypto.ts`.

- [ ] **Step 3: Implementar `packages/kernel/src/crypto.ts` usando exclusivamente `crypto.subtle`**

Usar `PBKDF2` con `SHA-256` (100,000 iteraciones asíncronas en hilo nativo), comparación XOR de longitud constante para evitar ataques de timing y firma `Ed25519` estándar sobre Base64URL sin librerías Node externas.

- [ ] **Step 4: Verificar tipos y tests**

Run: `pnpm -r typecheck && pnpm --filter @shac/kernel test:run`
Expected: PASS con código de salida `0`.

- [ ] **Step 5: Marcar `[x]` y crear commit atómico**

```bash
git add packages/kernel docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md
git commit -m "feat(kernel): implement async WebCrypto PBKDF2 and Ed25519 JWT primitives"
```

---

### Task 3: Cadena de Guardia (`profileLoader`, `moduleGate` y `authenticateRequest`)

**Files:**
- Create: `packages/kernel/src/pipeline.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/pipeline.test.ts`

**Interfaces:**
- Consumes: `TenantMarketProfile`, `ExecutionContext`, `CommandSpec`, `AppError`, `verifyJwtEdDsa`, `sha256Hex`.
- Produces:
  - `createProfileLoader(ttlMs?: number): { load(kv: KVNamespace): Promise<TenantMarketProfile>; invalidate(): void }`
  - `enforceModuleGate(profile: TenantMarketProfile, moduleId: string): void`
  - `authenticateRequest(headers: Headers, sessionKv: KVNamespace, publicKeyJwk: JsonWebKey): Promise<ExecutionContext['actor'] & { tenantId: string; orgId: string; orgPath: string }>`

- [ ] **Step 1: Escribir tests de guardia en `packages/kernel/test/pipeline.test.ts` cubriendo Review Focus #2, #3 y #4**

Probar: (a) caché en memoria de `60 s` evitando lecturas repetidas a KV, (b) fallo cerrado `503 PROFILE_UNAVAILABLE` cuando `CONFIG_KV` devuelve `null` o JSON corrupto, (c) `403 MODULE_NOT_ENABLED` cuando `moduleId` no está en `activeModules`, y (d) resolución de `Bearer <jwt>`, `Bearer mk_live_<key>` y cabecera `X-Delegation-Pin` válida/expirada en `SESSION_KV`.

- [ ] **Step 2: Ejecutar test para confirmar fallo**

Run: `pnpm --filter @shac/kernel test:run`
Expected: FAIL porque `pipeline.ts` no existe.

- [ ] **Step 3: Implementar `packages/kernel/src/pipeline.ts` y exportar desde `index.ts`**

Validar estructura mínima de `TenantMarketProfile` con Zod al hidratar desde KV (una sola vez cada `60 s`) y validar expiración estricta de sesiones de delegación (`delegatedById`).

- [ ] **Step 4: Ejecutar recibos de tipos y tests**

Run: `pnpm -r typecheck && pnpm --filter @shac/kernel test:run`
Expected: PASS (`exit code 0`).

- [ ] **Step 5: Marcar `[x]` y crear commit atómico**

```bash
git add packages/kernel docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md
git commit -m "feat(kernel): add profileLoader cache, moduleGate, and multi-mode auth pipeline"
```

---

### Task 4: Esquema D1 Inicial, Alcance Jerárquico y Presupuesto de Queries (`@shac/db-d1`)

**Files:**
- Create: `packages/db-d1/package.json`, `packages/db-d1/tsconfig.json`, `packages/db-d1/src/schema/iam.ts`
- Create: `packages/db-d1/src/scope.ts`, `packages/db-d1/src/index.ts`, `packages/db-d1/migrations/0001_phase1_iam_core.sql`
- Test: `packages/db-d1/test/scope.test.ts`

**Interfaces:**
- Consumes: `AppError`, `ExecutionContext` desde `@shac/kernel`.
- Produces:
  - Tablas Drizzle: `iamTenants`, `iamOrganizations`, `iamUsers`, `iamApiKeys`, `iamDelegationPins`, `kernelIdempotencyKeys`, `kernelActionLogs`.
  - `assertOrgScope(ctx: Pick<ExecutionContext, 'tenantId' | 'orgPath'>, targetTenantId: string, targetOrgPath: string): void`
  - `createD1Client(d1: D1Database): DrizzleD1Database`
  - `wrapD1WithCounter(d1: D1Database): { db: D1Database; getQueryCount(): number }`

- [ ] **Step 1: Escribir el test fallido en `packages/db-d1/test/scope.test.ts` (Review Focus #1)**

```ts
import { describe, expect, it } from 'vitest';
import { assertOrgScope } from '../src/index.js';

describe('@shac/db-d1 tenant & org subtree guard', () => {
  it('allows exact org and child orgs, blocks sibling orgs and cross-tenant access', () => {
    const ctx = { tenantId: 'ten_a', orgPath: '/root/north' };
    expect(() => assertOrgScope(ctx, 'ten_a', '/root/north')).not.toThrow();
    expect(() => assertOrgScope(ctx, 'ten_a', '/root/north/store-1')).not.toThrow();
    expect(() => assertOrgScope(ctx, 'ten_a', '/root/north-east')).toThrow(/FORBIDDEN_ORG_SCOPE/);
    expect(() => assertOrgScope(ctx, 'ten_b', '/root/north')).toThrow(/NOT_FOUND/);
  });
});
```

- [ ] **Step 2: Instalar `drizzle-orm` en `@shac/db-d1` y verificar fallo inicial**

Run: `pnpm install && pnpm --filter @shac/db-d1 test:run`
Expected: FAIL por archivos aún no implementados.

- [ ] **Step 3: Implementar esquema Drizzle (`iam.ts`), guardias (`scope.ts`) y migración aditiva (`0001_phase1_iam_core.sql`)**

Cuidar que `assertOrgScope` verifique límite de segmento exacto (`targetOrgPath === ctx.orgPath || targetOrgPath.startsWith(ctx.orgPath + '/')`) para impedir el bug clásico de prefijo parcial (`/root/north` vs `/root/north-east`).

- [ ] **Step 4: Verificar tipos, tests y guardia SQL sin `DROP`**

Run: `pnpm -r typecheck && pnpm --filter @shac/db-d1 test:run`
Expected: PASS (`exit code 0`), y `0` apariciones de `DROP TABLE` o `DROP COLUMN` en `packages/db-d1/migrations/`.

- [ ] **Step 5: Marcar `[x]` y crear commit atómico**

```bash
git add pnpm-lock.yaml packages/db-d1 docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md
git commit -m "feat(db-d1): add additive IAM SQLite schema, org subtree guard, and query counter"
```

---

### Task 5: Módulo `@shac/mod-iam` (Organizaciones con `db.batch()`, API Keys y PINs de Delegación)

**Files:**
- Create: `packages/modules/iam/package.json`, `packages/modules/iam/tsconfig.json`, `packages/modules/iam/src/commands/organizations.ts`
- Create: `packages/modules/iam/src/commands/delegation.ts`, `packages/modules/iam/src/index.ts`
- Test: `packages/modules/iam/test/iam.commands.test.ts`

**Interfaces:**
- Consumes: `@shac/kernel` (`defineCommand`, `defineModule`, `sha256Hex`, `AppError`) y `@shac/db-d1` (tablas IAM + `assertOrgScope`).
- Produces:
  - `iamModule: ModuleManifest` (`id: 'iam'`, comandos: `iam.orgs.create`, `iam.orgs.list`, `iam.apiKeys.create`, `iam.delegation.issuePin`).

- [ ] **Step 1: Escribir tests unitarios/contrato de comandos en `packages/modules/iam/test/iam.commands.test.ts`**

Cubrir metadatos MCP (`expose: true`, `readOnlyHint: true` en `iam.orgs.list`) y validación Zod de inputs (TTL permitido en `issuePin`: `'4h' | '8h' | '24h'`, `clientMutationId` obligatorio en escrituras).

- [ ] **Step 2: Ejecutar test para verificar fallo**

Run: `pnpm install && pnpm --filter @shac/mod-iam test:run`
Expected: FAIL por módulo no implementado.

- [ ] **Step 3: Implementar `organizations.ts`, `delegation.ts` e `index.ts`**

- `iam.orgs.list`: Ejecuta `ctx.db.batch([itemsQuery, countQuery])` filtrando siempre por `eq(iamOrganizations.tenantId, ctx.tenantId)` y prefijo de subárbol `ctx.orgPath` (`<= 2` sentencias en 1 roundtrip).
- `iam.orgs.create`: Verifica `kernelIdempotencyKeys` por `(tenantId, clientMutationId)` antes de insertar y escribe registro en `kernelActionLogs`.
- `iam.delegation.issuePin`: Genera PIN criptográfico de 6 dígitos (`crypto.getRandomValues`), persiste hash SHA-256 en D1 y registra sesión temporal en `SESSION_KV` con `expirationTtl`.

- [ ] **Step 4: Verificar tipos y tests**

Run: `pnpm -r typecheck && pnpm --filter @shac/mod-iam test:run`
Expected: PASS (`exit code 0`).

- [ ] **Step 5: Marcar `[x]` y crear commit atómico**

```bash
git add pnpm-lock.yaml packages/modules/iam docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md
git commit -m "feat(mod-iam): implement batched organizations, API keys, and 6-digit delegation PINs"
```

---

### Task 6: Worker `@shac/node-worker` (Hono RPC + CORS Adaptativo + `createMcpHandler` Stateless + Suite `@cloudflare/vitest-plugin` + Presupuesto `< 200 KiB`)

**Files:**
- Create: `apps/node-worker/package.json`, `apps/node-worker/tsconfig.json`, `apps/node-worker/wrangler.jsonc`, `apps/node-worker/vitest.config.ts`
- Create: `apps/node-worker/src/cors.ts`, `apps/node-worker/src/router.ts`, `apps/node-worker/src/index.ts`
- Test: `apps/node-worker/test/worker.integration.test.ts`

**Interfaces:**
- Consumes: `@shac/kernel`, `@shac/db-d1`, `@shac/mod-iam`, `hono`, `agents/mcp/server` (`createMcpHandler`).
- Produces:
  - Default Worker export (`{ fetch }`) + clase `BranchInventoryDO` (stub limpio listo para Fase 2) + tipo exportado `AppRouter` para cliente Hono RPC.

- [ ] **Step 1: Escribir prueba de integración real sobre `workerd` en `apps/node-worker/test/worker.integration.test.ts`**

Usando `cloudflare:test` (`env.DB`, `env.CONFIG_KV`, `env.SESSION_KV`) con `@cloudflare/vitest-plugin`:
1. Aplicar `0001_phase1_iam_core.sql` sobre `env.DB` y sembrar `profile:current` en `env.CONFIG_KV`.
2. Verificar `POST /api/iam/orgs` + `GET /api/iam/orgs` autenticado con JWT Ed25519: afirmar `status === 200`, `queryCount <= 2`, e idempotencia exacta al repetir el mismo `clientMutationId` (Review Focus #5).
3. Verificar aislamiento multi-tenant: token de `ten_2` no ve organizaciones de `ten_1` (Review Focus #1).
4. Apagar `'iam'` en `CONFIG_KV` y verificar `403 MODULE_NOT_ENABLED` con `queryCount === 0` (Review Focus #2).
5. Invocar `/mcp` (`tools/list` y `tools/call` sobre `iam.orgs.list`) verificando simetría REST <-> MCP stateless.

- [ ] **Step 2: Instalar dependencias de `apps/node-worker` y confirmar fallo inicial**

Run: `pnpm install && pnpm --filter @shac/node-worker test:run`
Expected: FAIL porque `src/router.ts` y `src/index.ts` aún no están implementados.

- [ ] **Step 3: Implementar `apps/node-worker/src/router.ts` y `apps/node-worker/src/index.ts`**

Montar todos los `CommandSpec` de los módulos registrados en rutas Hono (`/api/...`) y construir el servidor MCP stateless por petición con `createMcpHandler` compartiendo exactamente la misma cadena `profileLoader` -> `moduleGate` -> `authenticateRequest`.

- [ ] **Step 4: Ejecutar batería completa de recibos RDD de Cierre de Fase 1**

Run:
```bash
pnpm -r typecheck
pnpm dlx knip --strict
pnpm -r test:run
pnpm --filter @shac/node-worker exec wrangler deploy --dry-run --outdir .wrangler/dist
```
Expected:
- `typecheck`, `knip --strict` y `test:run` con código de salida `0`.
- Salida de `wrangler deploy --dry-run` reportando tamaño `gzip` **menor a `200 KiB`**.

- [ ] **Step 5: Marcar `[x]`, actualizar `docs/superpowers/DECISIONS.md` si aplica y crear commit atómico**

```bash
git add pnpm-lock.yaml package.json apps/node-worker docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md
git commit -m "feat(node-worker): wire Hono RPC, adaptive CORS, and stateless MCP handler with workerd suite"
```

---

### Task 7: Sistema UI `@shac/ui` (Tokens Tailwind v4 + `ShacAppShell` + `AuthBranchGate`)

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/src/styles/globals.css`
- Create: `packages/ui/src/components/ShacAppShell.tsx`, `packages/ui/src/components/AuthBranchGate.tsx`, `packages/ui/src/index.ts`
- Test: `packages/ui/test/ui.smoke.test.tsx`

**Interfaces:**
- Consumes: `MarketVocabulary`, `TenantMarketProfile` desde `@shac/kernel`.
- Produces: `ShacAppShell`, `AuthBranchGate`, `globals.css` (`@theme inline`, `.dark`, `data-density="touch" | "compact"`).

- [ ] **Step 1: Escribir prueba de renderizado y densidad táctil en `packages/ui/test/ui.smoke.test.tsx`**

Verificar que `AuthBranchGate` renderiza selector de sucursal y teclado numérico táctil de 6 dígitos (`min-h-14` / `56px`), y que `ShacAppShell` refleja `SyncStatusPill` (`En línea` vs `Offline`).

- [ ] **Step 2: Ejecutar test para confirmar fallo inicial**

Run: `pnpm install && pnpm --filter @shac/ui test:run`
Expected: FAIL porque los componentes aún no existen.

- [ ] **Step 3: Implementar `globals.css`, `ShacAppShell.tsx`, `AuthBranchGate.tsx` e `index.ts`**

Usar React 19 puro (sin `forwardRef`), atributos `data-slot` y tokens exactos de `DESIGN.md` (`#2563EB`, `#059669`, `Plus Jakarta Sans` + `JetBrains Mono`).

- [ ] **Step 4: Verificar tipos y tests**

Run: `pnpm -r typecheck && pnpm --filter @shac/ui test:run`
Expected: PASS (`exit code 0`).

- [ ] **Step 5: Marcar `[x]` y crear commit atómico**

```bash
git add pnpm-lock.yaml packages/ui docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md
git commit -m "feat(ui): add Tailwind v4 design tokens, ShacAppShell, and bimodal AuthBranchGate"
```

---

### Task 8: SPA `@shac/web-spa` (React 19 + Vite + TanStack Router + TanStack Query `offlineFirst` + Hono RPC)

**Files:**
- Create: `apps/web-spa/package.json`, `apps/web-spa/tsconfig.json`, `apps/web-spa/vite.config.ts`, `apps/web-spa/index.html`
- Create: `apps/web-spa/src/lib/rpc.ts`, `apps/web-spa/src/lib/queryClient.ts`, `apps/web-spa/src/main.tsx`
- Test: `apps/web-spa/test/spa.offline.test.ts`

**Interfaces:**
- Consumes: `@shac/ui` (`ShacAppShell`, `AuthBranchGate`) y tipo `AppRouter` desde `@shac/node-worker`.
- Produces: Build estático en `apps/web-spa/dist` servido por Workers Static Assets.

- [ ] **Step 1: Escribir test de cliente RPC y persistencia `offlineFirst` en `apps/web-spa/test/spa.offline.test.ts`**

Verificar configuración `networkMode: 'offlineFirst'` en `createShacQueryClient()` y construcción del cliente tipado `createRpcClient(baseUrl)`.

- [ ] **Step 2: Ejecutar test para confirmar fallo**

Run: `pnpm install && pnpm --filter @shac/web-spa test:run`
Expected: FAIL por archivos aún no implementados.

- [ ] **Step 3: Implementar `vite.config.ts`, `src/lib/rpc.ts`, `src/lib/queryClient.ts`, `src/main.tsx` e `index.html`**

Integrar `hc<AppRouter>`, `@tanstack/react-router` y `@tanstack/react-query` con persistencia IndexedDB.

- [ ] **Step 4: Ejecutar batería completa de cierre de Fase 1**

Run:
```bash
pnpm -r typecheck
pnpm dlx knip --strict
pnpm -r test:run
pnpm --filter @shac/web-spa build
pnpm --filter @shac/node-worker exec wrangler deploy --dry-run --outdir .wrangler/dist
! rg -i "DROP TABLE|DROP COLUMN" packages/db-d1/migrations/
```
Expected: Todo con código de salida `0` y Worker `gzip < 200 KiB`.

- [ ] **Step 5: Marcar `[x]` y crear commit atómico**

```bash
git add pnpm-lock.yaml apps/web-spa docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md
git commit -m "feat(web-spa): bootstrap React 19 Vite SPA with TanStack Router, offlineFirst Query, and Hono RPC"
```
