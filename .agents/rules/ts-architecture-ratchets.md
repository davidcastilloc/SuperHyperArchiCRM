---
description: Ratchets de arquitectura TypeScript, aislamiento multi-tenant, precisión financiera y límites de escala D1
globs: "**/*.{ts,tsx}"
---
1. **Techo estricto por archivo:** Ningún archivo `.ts` o `.tsx` en `packages/**` o `apps/*/src/**` puede superar las **320 líneas** post-format.
2. **Aislamiento Multi-Tenant Único:** Prohibido mantener lógica propia en `packages/modules/*/src/lib/scope-helpers.ts` o `scope.ts`. Todo módulo debe delegar en `packages/db-d1/src/scope.ts` (`ScopedD1Database` / `assertTenantScope`).
3. **Prohibido IEEE-754 en Dinero:** Prohibido usar flotantes (`Math.round(v * 100)`) en flujos contables, POS, WMS, precios o rentas. Todo cálculo monetario usa `Money` (`bigint`) y `allocateByRatios` desde `@shac/kernel`.
4. **Cero Nombres Cronológicos Nuevos:** Prohibido crear nuevos archivos `phaseN-*`. Los registros existentes (`phase7-registry.ts`, `phase8-registry.ts`) se mantienen únicamente como barriles delgados de compatibilidad ($\le 25$ líneas) que delegan a `command-registry.ts`.
5. **Límite de Parámetros SQL en Cloudflare D1:** Prohibido exceder **90 parámetros ligados (`?`)** por sentencia SQL en D1 (obligatorio usar `chunkRowsForD1Insert` / `chunkIdsForD1InClause`).
6. **Paginación O(1) sin `OFFSET`:** Prohibido usar paginación `OFFSET` en listados de alto volumen; usar `buildCursorPage` ($O(1)$).
