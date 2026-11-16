# AGENTS.md — Manual Operativo para Agentes de Código (SuperHyperArchiCRM)

**Documento Compañero Obligatorio:** `SPEC.md` (v2.0.0)  
**Metodología:** Spec-Driven Development (SDD) + Organic, Outcome & Receipt-Driven Development (ODD / RDD)  
**Entornos Soportados:** Google Antigravity, Claude Code, Gemini CLI, Codex, Neovim / Terminal Multi-Instancia (Windows, macOS, Linux)

---

## 1. Jerarquía de Verdad y Sincronización Multi-Instancia

Ningún agente debe depender de la memoria conversacional de una sesión previa. Toda la memoria del proyecto vive versionada en Git bajo esta jerarquía estricta:

1. **`SPEC.md` (Raíz):** Define la arquitectura invariante del **Núcleo Universal + 4 Packs Compilables por Familia** (`commerce-wms`, `spaces-stays`, `cases-practice`, `physical-iot`), los **9 Presets de Mercado en KV**, el Control Plane de flota y el Hub Federado B2B/B2C. Si una instrucción contradice una invariante de `SPEC.md`, detente y pide confirmación explícita antes de escribir código.
2. **`docs/superpowers/specs/` y `docs/superpowers/plans/`:** Especificaciones detalladas por pilar e hitos activos con checkboxes `- [ ]` / `- [x]`, sincronizados vía Git entre estaciones de trabajo.
3. **`docs/superpowers/DECISIONS.md`:** Registro cronológico conciso (ADR) de decisiones arquitectónicas y hallazgos críticos.
4. **Cero Rutas Absolutas de Sistema Operativo y Cero Symlinks:** Queda estrictamente prohibido escribir rutas dependientes del SO (unidades locales o directorios de usuario) en documentación, planes, configuraciones o código versionado. Usa siempre rutas relativas a la raíz del repositorio.
5. **Identidad Git y Regla de Remotos (`origin` vs. `upstream`):**
   - Verifica antes de cada commit que `git config user.name` sea `"David Castillo"` y `git config user.email` sea `"vikruzdavid@gmail.com"`, creando commits pequeños y atómicos (`feat(kernel): ...`, `fix(actor-branch): ...`, `docs(specs): ...`).
   - `origin` (`https://github.com/davidcastilloc/SuperHyperArchiCRM.git`, rama `main`) aloja exclusivamente el monorepo 100% Cloudflare (`@shac/*`). Nunca hagas `git push` sin instrucción explícita del usuario.
   - `upstream` ([open-mercato/open-mercato](https://github.com/open-mercato/open-mercato)) y los repositorios hermanos de cosecha actúan estrictamente como **referencia de dominio de solo lectura**; queda prohibido ejecutar `git merge upstream/main` sobre el Micro-Core.

---

## 2. Fase 0 Bloqueante: Auditar Disco Antes de Escribir (`Inspect First, Merge Deltas Only`)

Queda **estrictamente prohibido** sobrescribir archivos existentes a ciegas basándose en suposiciones. Antes de modificar cualquier paquete:

1. Ejecuta una inspección quirúrgica de solo lectura (`git status -sb`, `git log -n 5 --oneline`, búsquedas puntuales con `rg -n` evitando directorios pesados como `node_modules`, `dist`, `build`, `.wrangler`, `.svelte-kit`, y lectura directa de `package.json`, `pnpm-workspace.yaml`, `wrangler.jsonc` y los archivos objetivo).
2. Identifica qué *bindings*, esquemas Drizzle, rutas o pruebas existen actualmente en el árbol local.
3. Aplica **únicamente deltas quirúrgicos**, preservando configuraciones previas, *bindings* de Cloudflare y pruebas existentes.

---

## 3. Límites por Iteración y Prevención de Degradación de Contexto (*Zero Context Rot*)

Para mantener precisión máxima y cero regresiones silenciosas, cada turno o subtarea delegada a un agente debe cumplir cuatro cotas físicas:

| Regla de Acotación | Límite Duro | Acción Obligatoria si la Tarea lo Supera |
| :--- | :--- | :--- |
| **Volumen por iteración** | **50 a 200 líneas** netas agregadas/modificadas | Dividir el trabajo en sub-pasos secuenciales verificados individualmente en terminal |
| **Alcance de archivos por paso** | Máximo **3 archivos de implementación** + sus archivos `.test.ts` | Completar y verificar el primer corte vertical antes de abrir el siguiente paquete |
| **Tamaño máximo por archivo fuente** | **300 líneas** por archivo `.ts` o `.svelte` | Al llegar a `260` líneas, realizar primero un commit estructural puro (*Tidy First*) extrayendo submódulos cohesivos sin cambiar comportamiento |
| **Ejecución multi-agente en paralelo** | **1 `git worktree` aislado por agente** | Crear árbol independiente (`git worktree add ../wt-<tarea> -b feat/<tarea>`) para evitar colisiones de compilación o pisado de archivos |

### Asignación Eficiente de Modelos (*Model Tiering*)

- **Razonamiento Arquitectónico y Concurrencia:** Usar modelos frontera para diseñar esquemas SQLite duales (D1 vs. Durable Object), lógica FEFO/bloqueo de espacios/idempotencia en `BranchInventoryDO`, aislamiento fiduciario Trust/IOLTA, criptografía Ed25519 del Hub Federado y diagnóstico de fallos complejos.
- **Implementación Acotada y Mantenimiento:** Usar modelos rápidos/económicos para generar comandos CRUD tipados que sigan un `CommandSpec` ya aprobado, vistas SvelteKit repetitivas, pruebas unitarias adicionales y corrección de avisos de linter.

---

## 4. Guardia contra APIs Obsoletas y Anti-Patrones Prohibidos

La siguiente tabla tiene carácter de **bloqueo automático** en revisión de código:

| Prohibido en SuperHyperArchiCRM (Legacy / Bloqueante) | Patrón Obligatorio 2026 en SuperHyperArchiCRM | Motivo Técnico Verificado |
| :--- | :--- | :--- |
| `McpAgent` basado en Durable Object por sesión | `createMcpHandler` desde `agents/mcp/server` (MCP SDK v2 stateless) | `McpAgent` está deprecado; `createMcpHandler` evita desperdiciar instancias de Durable Objects por sesión |
| `@cloudflare/vitest-pool-workers` (Vitest 2/3) | `@cloudflare/vitest-plugin` con **Vitest 4.1+** | Estándar oficial vigente para probar D1, KV, Queues y Durable Objects sobre `workerd` |
| Workers Sites o configuración legacy de Pages | **Workers Static Assets** con `not_found_handling: "single-page-application"` | Sirve la SPA SvelteKit gratis desde CDN sin invocar cómputo del Worker |
| Contenedores DI dinámicos (`awilix`, `tsyringe`, decoradores OOP) | Funciones puras ES Modules (`"sideEffects": false`) + `ExecutionContext` explícito | Evita sobrecosto de 25–28 ms CPU/req y permite *tree-shaking* limpio por Pack de Familia |
| `crypto.pbkdf2Sync`, `bcrypt` JS o `fs` de Node | `crypto.subtle` asíncrono (Web Crypto API) + caché de sesión en `SESSION_KV` | `pbkdf2Sync` consume ~207 ms de CPU y aborta en el límite de 10 ms CPU del plan Free |
| Bucles `await db.select()` por ítem o `SELECT ... FOR UPDATE` | `db.batch([...])` en D1 y `ctx.storage.transactionSync` en `BranchInventoryDO` | Evita tormentas N+1 y serializa descuentos FEFO, cajas y reservas de espacios en `< 1 ms` |
| Condicionales `if (tenantId === 'x')` o ramas Git por edición | `TenantMarketProfile` en `CONFIG_KV` + packs declarativos en `editions/*` + `v_cf_*` en D1 | Garantiza un único tronco para los 9 mercados y upgrades en caliente en `< 60 s` |
| Números en punto flotante (`number` decimal) para dinero o tasas | Enteros en unidades menores (`basePriceMinor`), puntos básicos (`taxRateBps`) y micro-tasas (`exchangeRateMicros`) | Elimina errores de redondeo IEEE-754 en cobros mixtos multimoneda, arqueos ciegos, lotes y cuentas Trust/IOLTA |
| Mezclar monedas en una misma cuenta de caja/banco | Validación estricta `account.currency === payment.currency` en cada asiento | Impide descuadres contables en economías bimonetarias/trimonetarias (`BS` / `USD` / `EUR`) |

---

## 5. Reglas de Seguridad Multi-Tenant, Fiduciaria y Base de Datos

1. **Filtro Obligatorio de Inquilino y Sucursal:** Toda consulta Drizzle sobre tablas de negocio en D1 **debe** incluir `eq(table.tenantId, ctx.tenantId)` y validar que `orgId` pertenezca al subárbol autorizado `ctx.orgPath`. Queda prohibido exponer helpers de repositorio que reciban solo un `id` sin `tenantId`.
2. **Aislamiento de Fondos en Custodia y Notas Confidenciales:** Los saldos de anticipos fiduciarios (`Trust/IOLTA` o depósitos *escrow* de arrendamiento) nunca pueden sumarse al disponible operativo ni sobregirarse por cliente. En portales externos (`external_portal`), toda nota o adjunto con `isConfidential = true` debe filtrarse a nivel de consulta SQL.
3. **Migraciones D1 Estrictamente Aditivas (*Expand-Only*):** Ninguna migración SQL automática puede contener `DROP TABLE`, `DROP COLUMN` ni renombrados destructivos, preservando compatibilidad con actualizaciones en caliente y recuperación por **D1 Time Travel**.
4. **Idempotencia Obligatoria en Mutaciones Físicas y Financieras:** Todo comando que descuente stock, registre un cobro POS, bloquee una habitación/unidad, emita un pase de acceso, procese un mensaje de `Cloudflare Queues` o reciba un `FederationEnvelope` debe exigir una clave de idempotencia (`clientMutationId` o `envelopeId`) y verificarla dentro de la misma transacción SQLite.

---

## 6. Desarrollo Guiado por Recibos (`RDD`): Comandos de Verificación Obligatorios

**Regla de Cierre Innegociable:** Ningún agente puede reportar una tarea como completada ni marcar `- [x]` en un plan sin haber ejecutado los comandos correspondientes en terminal real y comprobado código de salida `0`. Quedan prohibidos tests falsos (mocks que solo prueban mocks) o implementaciones incompletas (`TODO`).

### 6.1 Batería Estándar tras Cada Iteración (50–200 líneas)

```bash
# 1. Verificación estricta de tipos en todo el monorepo (Hono RPC + Drizzle + SvelteKit)
pnpm -r typecheck

# 2. Detección de exportaciones huérfanas, archivos muertos y dependencias no usadas
pnpm dlx knip --strict

# 3. Ejecución de pruebas reales sobre runtime workerd (D1 + Durable Objects + KV + Queues)
pnpm --filter <paquete-afectado> test:run
```

### 6.2 Batería de Presupuesto de Borde y Empaquetado (Antes de Cerrar un Módulo, Pack o Fase)

```bash
# 4. Compilación real en seco con Wrangler para auditar peso total y gzip del Worker
pnpm --filter @shac/node-worker exec wrangler deploy --dry-run --outdir .wrangler/dist

# Presupuesto obligatorio en la salida de Wrangler:
# - Edición individual por Pack (retail-pos / distro-wms / hospitality-pms / clinic-practice / legal-psa / industrial-gate): gzip < 500 KiB
# - Binario completo Omni-Enterprise (los 4 Packs unidos): gzip < 1024 KiB (tope Free: 3072 KiB)

# 5. Guardia de seguridad sobre migraciones SQL generadas para D1 (debe retornar 0 coincidencias)
! rg -i "DROP TABLE|DROP COLUMN" packages/db-d1/migrations/
```

### 6.3 Recibos Específicos de Rendimiento y Concurrencia

- **Presupuesto de consultas D1 por endpoint:** Todo test de integración de lectura/listado en D1 debe envolver el binding con un contador de sentencias y afirmar `expect(queryCount).toBeLessThanOrEqual(2)` usando `db.batch()`.
- **Prueba de fuego en `BranchInventoryDO`:** Cualquier cambio en `@shac/actor-branch`, `@shac/mod-wms`, `@shac/mod-pos` o `@shac/mod-spaces` debe pasar el test de ráfaga concurrente (`Promise.all` con 25 a 50 operaciones simultáneas contra el mismo lote o habitación/unidad) verificando saldo `>= 0`, cero dobles reservas, orden **FEFO** respetado y cero duplicados ante reintento del mismo `clientMutationId`.

---

## 7. Checklist Canónico para Implementar un Nuevo Comando o Módulo

1. **Inspeccionar contratos vivos:** Lee `SPEC.md` y `packages/kernel/src/contracts.ts` para reutilizar tipos monetarios enteros, paginación por cursor y códigos de error estándar.
2. **Modelar esquema SQLite (si aplica):** Declara las tablas en `@shac/db-d1` (datos maestros/históricos) o en `@shac/actor-branch` (estado caliente por sede), con índices compuestos encabezados por `tenant_id`.
3. **Escribir el `CommandSpec` puro (`< 150` líneas):** Define `inputSchema` y `outputSchema` en Zod, asigna `requiredPermission`, configura `mcp: { expose: true, ... }` y escribe el `handler` puro sin estado global.
4. **Registrar en el `ModuleManifest` y Pack:** Exporta el comando manteniendo `"sideEffects": false` para no romper la poda estática entre ediciones.
5. **Escribir pruebas reales de aislamiento y borde:** Cubre en `.test.ts`: (a) caso exitoso, (b) intento de acceso cruzado desde otro `tenantId` (`404`/`403`), (c) módulo apagado en `TenantMarketProfile` (`403 MODULE_NOT_ENABLED`), y (d) idempotencia en reintentos.
6. **Emitir Recibo RDD y Handoff Atómico:** Ejecuta los comandos de la Sección 6, marca `- [x]` en `docs/superpowers/plans/<plan>.md`, registra cualquier decisión no obvia en `docs/superpowers/DECISIONS.md` y crea el commit atómico.
