# AGENTS.md — Manual Operativo para Agentes de Código (SuperHyperArchiCRM)

**Documentos Compañeros Obligatorios:** `SPEC.md` (v2.2.0), `DATA_MODEL.md` (v2.2.0) y `DESIGN.md` (v2.2.0)  
**Metodología:** Spec-Driven Development (SDD) + Organic, Outcome & Receipt-Driven Development (ODD / RDD)  
**Entornos Soportados:** Google Antigravity, Claude Code, Gemini CLI, Codex, Neovim / Terminal Multi-Instancia (Windows, macOS, Linux)

---

## 1. Jerarquía de Verdad y Sincronización Multi-Instancia

Ningún agente debe depender de la memoria conversacional de una sesión previa. Toda la memoria del proyecto vive versionada en Git (y espejada en Google Drive) bajo esta jerarquía estricta:

1. **`SPEC.md`, `DATA_MODEL.md` y `DESIGN.md` (Raíz):** Definen la arquitectura invariante del **Motor Único All-in-One** (`< 1024 KiB gzip`, con App Store instantáneo en `CONFIG_KV`), las **116 tablas canónicas** (`108` en D1 + `8` en `BranchInventoryDO`), el modelo de almacenamiento en **5 Capas Físicas**, el sistema visual en **React 19 + Vite + TanStack Router/Query + Tailwind v4 + `shadcn/ui`**, el Control Plane de flota y el Hub Federado B2B/B2C. Si una instrucción contradice una invariante de estos documentos, detente y pide confirmación explícita antes de escribir código.
2. **`docs/superpowers/specs/` y `docs/superpowers/plans/`:** Especificaciones detalladas (incluyendo `2026-11-16-multi-market-storage-architecture.md`) e hitos activos con checkboxes `- [ ]` / `- [x]`, sincronizados vía Git entre estaciones de trabajo.
3. **`docs/superpowers/DECISIONS.md`:** Registro cronológico conciso (ADR) de decisiones arquitectónicas y hallazgos críticos.
4. **Cero Rutas Absolutas de Sistema Operativo y Cero Symlinks:** Queda estrictamente prohibido escribir rutas dependientes del SO (unidades locales o directorios de usuario) en documentación, planes, configuraciones o código versionado. Usa siempre rutas relativas a la raíz del repositorio.
5. **Identidad Git y Regla de Remotos (`origin` vs. `upstream`):**
   - Verifica antes de cada commit que `git config user.name` sea `"David Castillo"` y `git config user.email` sea `"vikruzdavid@gmail.com"`, creando commits pequeños y atómicos (`feat(kernel): ...`, `fix(actor-branch): ...`, `docs(specs): ...`).
   - `origin` (`https://github.com/davidcastilloc/SuperHyperArchiCRM.git`, rama `main`) aloja exclusivamente el monorepo 100% Cloudflare (`@shac/*`). Nunca hagas `git push` sin instrucción explícita del usuario.
   - `upstream` ([open-mercato/open-mercato](https://github.com/open-mercato/open-mercato)) y los repositorios hermanos de cosecha actúan estrictamente como **referencia de dominio y primitivas UI MIT de solo lectura**; queda prohibido ejecutar `git merge upstream/main` sobre el Micro-Core.

---

## 2. Fase 0 Bloqueante: Auditar Disco y Drive Antes de Escribir (`Inspect First, Merge Deltas Only`)

Queda **estrictamente prohibido** sobrescribir archivos existentes a ciegas basándose en suposiciones. Antes de modificar cualquier paquete o documento:

1. Ejecuta una inspección quirúrgica de solo lectura (`git status -sb`, `git log -n 5 --oneline`, búsquedas puntuales con `rg -n` evitando directorios pesados como `node_modules`, `dist`, `build`, `.wrangler`, y lectura directa de `package.json`, `pnpm-workspace.yaml`, `wrangler.jsonc` y los archivos objetivo).
2. Identifica qué *bindings*, esquemas Drizzle, rutas, componentes `@shac/ui` o pruebas existen actualmente en el árbol local.
3. Aplica **únicamente deltas quirúrgicos**, preservando configuraciones previas, *bindings* de Cloudflare y pruebas existentes.

---

## 3. Límites por Iteración y Prevención de Degradación de Contexto (*Zero Context Rot*)

Para mantener precisión máxima y cero regresiones silenciosas, cada turno o subtarea delegada a un agente debe cumplir cuatro cotas físicas:

| Regla de Acotación | Límite Duro | Acción Obligatoria si la Tarea lo Supera |
| :--- | :--- | :--- |
| **Volumen por iteración** | **50 a 200 líneas** netas agregadas/modificadas | Dividir el trabajo en sub-pasos secuenciales verificados individualmente en terminal |
| **Alcance de archivos por paso** | Máximo **3 archivos de implementación** + sus archivos `.test.ts` | Completar y verificar el primer corte vertical antes de abrir el siguiente paquete |
| **Tamaño máximo por archivo fuente** | **300 líneas** por archivo `.ts` o `.tsx` | Al llegar a `260` líneas, realizar primero un commit estructural puro (*Tidy First*) extrayendo submódulos cohesivos sin cambiar comportamiento |
| **Ejecución multi-agente en paralelo** | **1 `git worktree` aislado por agente** | Crear árbol independiente (`git worktree add ../wt-<tarea> -b feat/<tarea>`) para evitar colisiones de compilación o pisado de archivos |

### Asignación Eficiente de Modelos (*Model Tiering*)

- **Razonamiento Arquitectónico y Concurrencia:** Usar modelos frontera para diseñar esquemas SQLite duales (D1 vs. Durable Object), lógica FEFO/bloqueo de espacios/idempotencia en `BranchInventoryDO`, aislamiento fiduciario Trust/IOLTA, criptografía Ed25519 del Hub Federado y diagnóstico de fallos complejos.
- **Implementación Acotada y Mantenimiento:** Usar modelos rápidos/económicos para generar comandos CRUD tipados que sigan un `CommandSpec` ya aprobado, vistas React 19 + `shadcn/ui` repetitivas o adaptación de componentes MIT desde `../base/open-mercato/packages/ui`, pruebas unitarias adicionales y corrección de avisos de linter.

---

## 4. Guardia contra APIs Obsoletas y Anti-Patrones Prohibidos

La siguiente tabla tiene carácter de **bloqueo automático** en revisión de código:

| Prohibido en SuperHyperArchiCRM (Legacy / Bloqueante) | Patrón Obligatorio 2026 en SuperHyperArchiCRM | Motivo Técnico Verificado |
| :--- | :--- | :--- |
| `McpAgent` basado en Durable Object por sesión | `createMcpHandler` desde `agents/mcp/server` (MCP SDK v2 stateless) | `McpAgent` está deprecado; `createMcpHandler` evita desperdiciar instancias de Durable Objects por sesión |
| `@cloudflare/vitest-pool-workers` (Vitest 2/3) | `@cloudflare/vitest-plugin` con **Vitest 4.1+** | Estándar oficial vigente para probar D1, KV, Queues y Durable Objects sobre `workerd` |
| `Next.js SSR, next/link, next/navigation, forwardRef o tailwindcss-animate` | **React 19 + Vite (`@cloudflare/vite-plugin`) + TanStack Router + TanStack Query (`offlineFirst`) + Tailwind v4 + `shadcn/ui` (`new-york`, `tw-animate-css`)** | Sirve la SPA gratis en Workers Static Assets (`0 KiB` en el Worker con *code-splitting* por pantalla) y permite portar componentes MIT de `@open-mercato/ui` |
| Contenedores DI dinámicos (`awilix`, `tsyringe`, decoradores OOP) | Funciones puras ES Modules (`"sideEffects": false`) + `ExecutionContext` explícito | Evita sobrecosto de 25–28 ms CPU/req y mantiene el binario All-in-One bajo `< 1024 KiB gzip` |
| `crypto.pbkdf2Sync`, `bcrypt` JS o `fs` de Node | `crypto.subtle` asíncrono (Web Crypto API) + caché de sesión en `SESSION_KV` | `pbkdf2Sync` consume ~207 ms de CPU y aborta en el límite de 10 ms CPU del plan Free |
| Bucles `await db.select()` por ítem o `SELECT ... FOR UPDATE` | `db.batch([...])` en D1 y `ctx.storage.transactionSync` en `BranchInventoryDO` | Evita tormentas N+1 y serializa descuentos FEFO, cajas y reservas de espacios en `< 1 ms` |
| Condicionales `if (tenantId === 'x')`, ramas Git por cliente o tablas duplicadas por vertical | `TenantMarketProfile` en `CONFIG_KV` + Tronco y Satélites de `DATA_MODEL.md` + `v_cf_*` en D1 | Garantiza un único motor All-in-One donde cualquier mercado se enciende en `0 ms` sin migrar ni recompilar |
| Números en punto flotante (`number` decimal) para dinero o tasas | Enteros en unidades menores (`basePriceMinor`), puntos básicos (`taxRateBps`) y micro-tasas (`exchangeRateMicros`) | Elimina errores de redondeo IEEE-754 en cobros mixtos multimoneda, arqueos ciegos, lotes y cuentas Trust/IOLTA |
| Mezclar monedas en una misma cuenta de caja/banco | Validación estricta `account.currency === payment.currency` en cada asiento | Impide descuadres contables en economías bimonetarias/trimonetarias (`BS` / `USD` / `EUR`) |

---

## 5. Reglas de Seguridad Multi-Tenant, Fiduciaria y Almacenamiento en 5 Capas

1. **Aislamiento Físico y Lógico (`1 Empresa = 1 Base D1` + Filtro `orgPath`):** Cada inquilino opera sobre su propia base D1 física, y aun así toda consulta Drizzle sobre tablas de negocio **debe** incluir `eq(table.tenantId, ctx.tenantId)` y validar que `orgId` pertenezca al subárbol autorizado `ctx.orgPath`. Queda prohibido exponer helpers que reciban solo un `id` sin `tenantId`.
2. **Ubicación Correcta de Cada Dato en las 5 Capas:**
   - Configuración viva y switches de mercado -> `CONFIG_KV` (`profile:current`).
   - Estado caliente con riesgo de colisión concurrente (stock FEFO, turno POS abierto, bloqueo de habitación/consultorio, cola `/lobby`, pases QR/LPR) -> `BranchInventoryDO`.
   - Datos maestros, transaccionales históricos, clínicos, legales y contables -> `Cloudflare D1` (`Tronco + Satélites + v_cf_*`).
   - Archivos binarios pesados (PDFs, fotos `e-POD`, estudios DICOM, audios IA, clips de evidencia `SHA-256`) -> `Cloudflare R2` (guardando únicamente `r2_object_key` en D1).
   - Caché local de catálogo/tasas y cola desconectada -> `TanStack Query (offlineFirst)` + `IndexedDB` (o `SQLite` en Tauri).
3. **Aislamiento de Fondos en Custodia y Notas Confidenciales:** Los saldos de anticipos fiduciarios (`fin_trust_escrow_ledgers`: `Trust/IOLTA` o depósitos *escrow*) nunca pueden sumarse al disponible operativo ni sobregirarse (`CHECK balance_minor >= 0`). En portales externos (`external_portal`), toda nota o adjunto con `isConfidential = true` debe filtrarse a nivel SQL.
4. **Migraciones D1 Estrictamente Aditivas (*Expand-Only*):** Ninguna migración SQL automática puede contener `DROP TABLE`, `DROP COLUMN` ni renombrados destructivos, preservando compatibilidad con actualizaciones en caliente y recuperación por **D1 Time Travel**.
5. **Idempotencia Obligatoria en Mutaciones Físicas y Financieras:** Todo comando que descuente stock, registre un cobro POS, bloquee un espacio, emita un pase de acceso, procese un mensaje de `Cloudflare Queues` o reciba un `FederationEnvelope` debe exigir `clientMutationId` o `envelopeId` y verificarlo dentro de la misma transacción SQLite.

---

## 6. Desarrollo Guiado por Recibos (`RDD`): Comandos de Verificación Obligatorios

**Regla de Cierre Innegociable:** Ningún agente puede reportar una tarea como completada ni marcar `- [x]` en un plan sin haber ejecutado los comandos correspondientes en terminal real y comprobado código de salida `0`. Quedan prohibidos tests falsos o implementaciones con `TODO`.

### 6.1 Batería Estándar tras Cada Iteración (50–200 líneas)

```sh
# 1. Verificación estricta de tipos en todo el monorepo (Hono RPC + Drizzle + React 19 / TanStack Router)
pnpm -r typecheck

# 2. Detección de exportaciones huérfanas, archivos muertos y dependencias no usadas
pnpm dlx knip --strict

# 3. Ejecución de pruebas reales sobre runtime workerd (D1 + Durable Objects + KV + Queues)
pnpm --filter <paquete-afectado> test:run
```

### 6.2 Batería de Presupuesto de Borde y Empaquetado (Antes de Cerrar un Módulo o Fase)

```sh
# 4. Compilación real en seco con Wrangler para auditar peso total y gzip del Worker
pnpm --filter @shac/node-worker exec wrangler deploy --dry-run --outdir .wrangler/dist

# Presupuesto obligatorio en la salida de Wrangler:
# - Fase 1 Micro-Core: gzip < 200 KiB
# - Edición vertical recortada opcional: gzip < 500 KiB
# - Motor Completo True All-in-One (los 12 dominios incluidos): gzip < 1024 KiB (tope Free: 3072 KiB, Paid: 10240 KiB)

# 5. Guardia de seguridad sobre migraciones SQL generadas para D1 (debe retornar 0 coincidencias)
! rg -i "DROP TABLE|DROP COLUMN" packages/db-d1/migrations/
```

### 6.3 Recibos Específicos de Rendimiento y Concurrencia

- **Presupuesto de consultas D1 por endpoint:** Todo test de integración de lectura/listado en D1 debe envolver el binding con un contador de sentencias y afirmar `expect(queryCount).toBeLessThanOrEqual(2)` usando `db.batch()`.
- **Prueba de fuego en `BranchInventoryDO`:** Cualquier cambio en `@shac/actor-branch`, `@shac/mod-wms`, `@shac/mod-pos` o `@shac/mod-spaces` debe pasar el test de ráfaga concurrente (`Promise.all` con 25 a 50 operaciones simultáneas contra el mismo lote o habitación/unidad) verificando saldo `>= 0`, cero dobles reservas, orden **FEFO** respetado y cero duplicados ante reintento del mismo `clientMutationId`.

---

## 7. Checklist Canónico para Implementar un Nuevo Comando o Módulo

1. **Inspeccionar contratos y modelo canónico:** Lee `SPEC.md`, `DATA_MODEL.md` y `packages/kernel/src/contracts.ts` para reutilizar las tablas troncales/satélite y tipos monetarios enteros.
2. **Modelar esquema SQLite (si aplica):** Declara las tablas en `@shac/db-d1` o en `@shac/actor-branch`, con índices compuestos encabezados por `tenant_id`.
3. **Escribir el `CommandSpec` puro (`< 150` líneas):** Define `inputSchema` y `outputSchema` en Zod, asigna `requiredPermission`, configura `mcp: { expose: true, ... }` y escribe el `handler` puro sin estado global.
4. **Registrar en el `ModuleManifest`:** Exporta el comando manteniendo `"sideEffects": false`.
5. **Escribir pruebas reales de aislamiento y borde:** Cubre en `.test.ts`: (a) caso exitoso, (b) acceso cruzado desde otro `tenantId`/`orgPath` (`404`/`403`), (c) módulo apagado en `TenantMarketProfile` (`403 MODULE_NOT_ENABLED`), y (d) idempotencia en reintentos.
6. **Emitir Recibo RDD y Handoff Atómico:** Ejecuta los comandos de la Sección 6, marca `- [x]` en `docs/superpowers/plans/<plan>.md`, actualiza `docs/superpowers/DECISIONS.md` si aplica y crea el commit atómico.

### 7.1 Protocolo de Extracción Limpia desde `../base/open-mercato/packages/ui` (MIT)

Al portar tablas, formularios o editores de campos personalizados desde `../base/open-mercato/packages/ui` hacia `@shac/ui` o `@shac/web-spa`:

1. **Desacoplar Next.js:** Sustituye todo `import Link from 'next/link'` y hooks de `next/navigation` (`useRouter`, `usePathname`, `useSearchParams`) por las primitivas tipadas de [TanStack Router](https://tanstack.com/router/latest/docs/overview).
2. **Actualizar a React 19 + `shadcn/ui` Tailwind v4:** Elimina `React.forwardRef` pasando `ref` como prop estándar, preserva atributos `data-slot`, usa `sonner` para notificaciones y aplica variables CSS mediante `@theme inline`.
3. **Conectar Estado y Tiempo Real al Borde:** Reemplaza llamadas fetch manuales y el puente SSE (`eventBridge.ts`) por **Hono RPC (`hc<AppType>`) + [TanStack Query (`offlineFirst`)](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode)** e invalidación selectiva desde el WebSocket con hibernación de `BranchInventoryDO`.
4. **Respetar `DESIGN.md` y Stitch:** Respeta estrictamente los tokens visuales y densidad bimodal (`data-density="touch" | "compact"`) definidos en `DESIGN.md`; cuando se entregue una pantalla desde Google Stitch vía MCP (`stitch`), úsala como referencia estructural de una vista a la vez.
