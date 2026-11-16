# Especificación de Diseño: Puente Inteligente de Maquetación (Google AI Studio <-> SuperHyperArchiCRM / Open Mercato)

**Fecha:** 2026-11-16  
**Estado:** Pendiente de Aprobación del Usuario (Revisado por Builder Check)  
**Documentos Compañeros:** `SPEC.md` (v2.1.0), `DATA_MODEL.md` (v2.1.0 — 116 Tablas Canónicas), `AGENTS.md`  
**Alcance Inmediato (Este Plan):** `tools/ai-studio-workbench/` (Kit autónomo de prototipado), `.agent/skills/shac-harvest-mockup/SKILL.md` (Skill de cosecha hacia producción), `.gitignore` (exclusión de `.workbench-inbox/`) y actualización declarativa de `Task 6` en `docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md` para incluir `apps/node-worker/src/cors.ts` en su orden natural de Fase 1.

---

## 1. Intención y Porqué (*Intent & Why*)

Construir vistas complejas de negocio (POS multimoneda, tableros *Live Rack* hoteleros, admisión clínica/ABA, expedientes legales o WMS) iterando directamente sobre el código de producción dentro de Antigravity consume una cantidad elevada de tokens de contexto en ajustes visuales, pruebas de estado e iteraciones de diseño.

**Google AI Studio (Build Mode)** ofrece un entorno gratuito y visualmente inmediato para diseñar, probar e iterar componentes o flujos completos. Sin embargo, por sí solo presenta tres brechas frente a **SuperHyperArchiCRM (`@shac/*`)**:
1. AI Studio genera React + Tailwind genérico en un iframe aislado (`*.usercontent.goog`) que choca por CORS contra backends reales desplegados y desconoce los tokens visuales de Open Mercato.
2. Si el backend aún no tiene desplegado un endpoint nuevo (o está apagado), la maqueta falla o termina usando `useState` efímero con números flotantes que violan las invariantes de `SPEC.md` (`Minor`, `Bps`, `Micros`, `clientMutationId`, `tenant_id`, `org_id`).
3. Al traer el prototipo de vuelta al repositorio, traducir manualmente un prototipo desordenado hacia `CommandSpec` (`@shac/kernel`) + vistas de `apps/web-spa` volvería a gastar los tokens que se querían ahorrar.

Este diseño resuelve las tres brechas mediante un **Puente Inteligente Auto-Adaptativo** que permite prototipar en Google AI Studio conectado a **cualquier backend desplegado** (Cloudflare Workers `@shac/node-worker`, Railway, Coolify, VPS con Open Mercato clásico) o **100% offline en `localStorage` + JSON canónico**, entregando artefactos que ya cumplen las reglas de `SPEC.md` v2.1.0 y `DATA_MODEL.md`.

---

## 2. Objetivos, No-Objetivos y Anti-Objetivos

### Objetivos (*Goals*)
- **Ahorro radical de tokens en Antigravity:** Permitir que el 90% de la experimentación visual y validación funcional de una feature ocurra en Google AI Studio antes de invocar agentes sobre el monorepo.
- **Resiliencia agnóstica al despliegue (*Smart 3-Tier Cascade*):** Que la misma maqueta funcione sin tocar código tanto contra un backend vivo en cualquier nube como sin servidor (cayendo automáticamente por ruta a `kernel_custom_records` o `localStorage` + semillas JSON).
- **Fidelidad de contratos desde el minuto cero:** Hacer cumplir en el banco de pruebas de AI Studio las invariantes de `SPEC.md` v2.1.0 y `DATA_MODEL.md`:
  - Importes enteros (`Minor`), tasas en puntos básicos (`Bps`) y tipos de cambio en micro-unidades (`exchangeRateMicros`).
  - Encabezado universal de las 108 tablas D1 (`id` ULID, `tenant_id`, `org_id`, `custom_fields`, `version`, `created_at`, `updated_at`, `deleted_at`) e idempotencia (`clientMutationId`).
  - Conmutación instantánea en caliente de los **9 `EditionPresetId`** (`retail-pos`, `distro-wms`, `tech-service`, `hospitality-pms`, `property-condo`, `clinic-practice`, `legal-psa`, `industrial-gate`, `omni-enterprise`) y los **5 `RegionPackId`** (`ve`, `co`, `mx`, `us`, `global`).
- **Estética y primitivas alineadas a Open Mercato:** Proveer en el kit los tokens semánticos CSS (modo claro/oscuro automático, `status-*`, `chart-*`, `brand-violet`, radios `rounded-xl`) y espejos ligeros de las primitivas de backend (`Page`, `DataTable`, `CrudForm`, `KpiCard`, `FilterBar`, `EnumBadge`, `ConfirmDialog`).
- **Cosecha determinista 1:1 hacia `@shac/*`:** Incluir un botón *"Export Handoff Bundle"* en la maqueta y una skill local (`shac-harvest-mockup`) para absorber directamente el JSX React 19 y esquemas probados hacia `@shac/mod-*` (`CommandSpec`), `@shac/ui` y `apps/web-spa` (React 19 + Vite + TanStack Router/Query + Tailwind v4 + `shadcn/ui`) sin traducción entre frameworks.

### No-Objetivos (*Non-Goals*)
- Ejecutar Cloudflare Workers (`workerd`), Drizzle D1 real o `BranchInventoryDO` dentro del sandbox interno de Google AI Studio.
- Sustituir la arquitectura de rutas tipadas y persistencia `offlineFirst` de `apps/web-spa`: AI Studio actúa como banco rápido de maquetación ejecutable en React 19 cuyos componentes pasan limpios a `@shac/ui` y `apps/web-spa`.
- Acoplar herramientas de prototipado dentro de `packages/*` o `apps/node-worker` de forma que sumen un solo byte innecesario al presupuesto `< 500 KiB` / `< 1024 KiB gzip` del Worker.

### Anti-Objetivos (*Anti-Goals — Fallos Inaceptables*)
- **Fuga de llaves reales en código o Git:** Jamás hardcodear `mk_live_*` ni `omk_*` en archivos del Starter Kit ni persistirlas en exportaciones JSON compartibles.
- **CORS abierto indiscriminadamente en producción:** El Worker nunca debe emitir `Access-Control-Allow-Origin: *` con credenciales abiertas si el administrador del despliegue no configuró explícitamente orígenes de prototipado/staging.
- **Maquetas con `float` financiero:** Si el kit permite prototipar precios con decimales sueltos (`19.99` en vez de `1999` centavos + helper `formatMinor`), la cosecha posterior reintroduciría bugs contables prohibidos por `ADR-004`.

---

## 3. Restricciones Arquitectónicas

1. **Cero impacto en el Edge Budget (`SPEC.md` §1.2):** `tools/ai-studio-workbench/` queda fuera de los paquetes importados por `apps/node-worker` y `editions/*`. El middleware `cors.ts` en `apps/node-worker` debe pesar `< 80` líneas puras sin dependencias externas (usando `hono/cors` ya incluido en `hono`).
2. **Límite de tamaño por archivo (`AGENTS.md` §3):** Ningún archivo `.ts` o `.tsx` dentro de `tools/ai-studio-workbench/` ni de `apps/node-worker/` puede superar las **300 líneas**.
3. **Cero rutas absolutas ni symlinks (`AGENTS.md` §1.4):** Toda ruta en documentación, scripts y skills es relativa a la raíz del repositorio; la skill se almacena físicamente en `.agent/skills/shac-harvest-mockup/SKILL.md`.
4. **Compatibilidad total con Google AI Studio Build Mode y Aislamiento del Monorepo *(Decisión del Arquitecto)*:**
   - `tools/ai-studio-workbench/` es un paquete **100% autónomo y excluido de `pnpm-workspace.yaml` y `knip` raíz**. De este modo:
     1. Puede empaquetarse en ZIP o subirse directo a Google AI Studio con sus propias dependencias planas (`react`, `lucide-react`, `recharts`, `zod`, `tailwindcss`, `vite`, `vitest`) sin depender de hoisting ni contaminar `knip --strict` del Micro-Core.
     2. Se verifica con sus propios recibos RDD independientes (`pnpm --dir tools/ai-studio-workbench run typecheck`, `pnpm --dir tools/ai-studio-workbench run test:run` y `pnpm --dir tools/ai-studio-workbench run build`).
5. **Secuenciación Limpia con Fase 1 *(Decisión del Arquitecto)*:**
   - Dado que `apps/node-worker` aún está pendiente en `docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md` (`Tasks 1–6` sin iniciar), este entregable construye y verifica inmediatamente `tools/ai-studio-workbench/` + `.agent/skills/shac-harvest-mockup/SKILL.md` y registra el contrato exacto de `cors.ts` dentro de la `Task 6` del Plan de Fase 1 para que se compile junto al router Hono sin romper el orden secuencial de Fase 1.

---

## 4. Alternativas Evaluadas (*Approaches*)

| Alternativa | Descripción | Ventajas | Desventajas / Motivo de Descarte o Selección |
| :--- | :--- | :--- | :--- |
| **A. Solo Súper-Prompt de Texto** | Pegar un prompt largo con reglas de diseño y pedirle a AI Studio que invente mocks en cada chat. | Cero mantenimiento de código plantilla. | AI Studio regenera tablas/formularios distintos en cada sesión, olvida cabeceras CORS/`x-api-key`, usa `float` para dinero y obliga a reescribir todo al traerlo a Antigravity (alto gasto de tokens). **Descartada.** |
| **B. Proxy Externo Obligatorio + Solo Backend Vivo** | Exigir siempre un proxy Cloudflare Worker intermedio conectado a un servidor desplegado. | Prueba contra base de datos real desde el día 1. | Bloquea el trabajo cuando un módulo nuevo aún no existe en el backend (`404`) o cuando aún no se ha desplegado `Phase 1`; añade otra pieza de infraestructura que mantener. **Descartada como única vía.** |
| **C. Puente Inteligente Híbrido: CORS Nativo por Env + Kit `ai-studio-workbench` Auto-Adaptativo + Skill de Cosecha (Seleccionada)** | Habilitar CORS gobernado por entorno en el backend + proveer un proyecto semilla para AI Studio con cliente en cascada (`Live @shac` / `Live Open Mercato` -> `Custom Records Sandbox` -> `localStorage + DATA_MODEL JSON`), selector de los 9 `TenantMarketProfile` y exportador de *Handoff Bundle* consumido por una skill local. | Funciona con **cualquier** backend desplegado o sin él; nunca se frena por un `404`; respeta `DATA_MODEL.md` (116 tablas) y `ADR-004` (enteros); minimiza al máximo los tokens de integración en Antigravity. | Requiere mantener un paquete semilla ligero (`~8` archivos pequeños) en `tools/ai-studio-workbench/`. **Seleccionada.** |

---

## 5. Diseño Detallado del Sistema

### 5.1 Capa de Borde: CORS Inteligente en `@shac/node-worker` (y Guía Equivalente para Instancias Legacy)

Cuando se implemente `apps/node-worker/src/router.ts` (Plan de Fase 1, Task 6), se incorpora una función pura `createAdaptiveCorsMiddleware(env)` (`< 70` líneas):

- **Configuración por variable de entorno (`CORS_ALLOWED_ORIGINS`):**
  - Vacía o ausente (default seguro en producción cerrada): No emite cabeceras CORS cruzadas; solo tráfico *same-origin* de Static Assets.
  - Lista separada por comas con soporte de comodín de subdominio seguro: ej. `https://aistudio.google.com,https://*.usercontent.goog,http://localhost:5173`.
- **Preflight `OPTIONS` en `< 0.2 ms` CPU:** Responde `204 No Content` antes de tocar `CONFIG_KV` o `D1` (0 lecturas de base de datos en preflights).
- **Cabeceras permitidas (`Allow-Headers`):**
  `Content-Type, Authorization, X-API-Key, X-Tenant-Id, X-Org-Id, X-Client-Mutation-Id, If-Match`
- **Cabeceras expuestas (`Expose-Headers`):**
  `X-Request-Id, ETag, X-SHAC-Mode`
- **Compatibilidad con despliegues externos (Railway / Coolify / Traefik / Open Mercato v0.10):** Se incluye en `tools/ai-studio-workbench/BACKEND_CONNECT.md` el bloque exacto de cabeceras para Traefik/Coolify/Nginx/Cloudflare Transform Rules en caso de apuntar contra un contenedor Open Mercato existente sin recompilarlo.

### 5.2 El Kit `tools/ai-studio-workbench/` (Estructura Modular `< 300` LOC/archivo)

Proyecto autónomo listo para `Export/Import` o GitHub Sync con Google AI Studio:

```text
tools/ai-studio-workbench/
├── package.json                  # React 19, lucide-react, recharts, zod, tailwindcss (sin workspace:*)
├── index.html                    # Fuentes y variables CSS base
├── SYSTEM_INSTRUCTIONS.md        # Prompt corto para pegar en el panel "System Instructions" de AI Studio
├── BACKEND_CONNECT.md            # Recetas de 1 minuto para conectar Workers, Coolify, Railway o túneles
└── src/
    ├── theme/
    │   └── om-tokens.css         # Tokens semánticos exactos de Open Mercato (light/dark, status-*, chart-*, brand-*)
    ├── kernel/
    │   ├── contracts.ts          # Espejo exacto de TenantMarketProfile, EditionPresetId, Minor/Bps/Micros, CanonicalRow
    │   ├── presets.ts            # Los 9 presets de mercado + 5 packs regionales listos para conmutar en vivo
    │   ├── money.ts              # Helpers enteros: toMinor, formatMinor, convertMicros, calcTaxMinor, assertSameCurrency
    │   └── smartClient.ts        # Cliente HTTP/Mock auto-adaptativo de 3 niveles + cola de mutaciones
    ├── seeds/
    │   └── canonicalSeeds.ts     # Semillas iniciales alineadas a DATA_MODEL.md (crm_parties, cat_products, com_orders, hot_space_locks...)
    ├── ui/
    │   ├── primitives.tsx        # Page, PageHeader, KpiCard, EnumBadge, FilterBar, EmptyState, ConfirmDialog, flash()
    │   ├── DataTable.tsx         # Tabla con búsqueda, filtros, selección, acciones por fila y estados loading/empty
    │   ├── CrudForm.tsx          # Formulario declarativo con validación Zod, optimistic version e idempotencia
    │   └── DevBridgeBar.tsx      # Barra flotante colapsable: URL backend, API key en sessionStorage, Preset Switcher y Export Bundle
    └── App.tsx                   # Shell de demostración conmutable por vertical listo para que AI Studio agregue vistas
```

### 5.3 Motor Auto-Adaptativo de Datos (`smartClient.ts`)

Cada pantalla o componente en AI Studio consume únicamente `smartApi` (`list`, `get`, `create`, `update`, `remove`, `command`):

1. **Detección automática de dialecto de backend (`Auto-Probe`):**
   Al configurar una `Backend URL` en `DevBridgeBar` (guardada solo en `sessionStorage` del navegador para no filtrarse nunca en ZIPs ni commits):
   - Prueba `GET /api/system/ping` o `/api/healthz`.
   - Si detecta cabeceras/forma `@shac/node-worker`, usa dialecto **SHAC RPC** (`Authorization: Bearer` o `x-api-key: mk_live_*`, `X-Client-Mutation-Id`, paginación por cursor, filas `snake_case`/`camelCase` mapeadas).
   - Si detecta **Open Mercato v0.10** (`/api/customers/people`, llave `omk_*`, header `If-Match` / `updatedAt`), adapta automáticamente los parámetros de paginación y envuelve la respuesta al mismo contrato limpio.
2. **Cascada resiliente por petición (nunca bloquea la maqueta):**
   - **Paso 1 (`LIVE`):** Si hay `Backend URL` activa y el modo no está forzado a `MOCK`, ejecuta `fetch()` con timeout corto (`4000 ms`). Si responde `2xx`, devuelve datos reales y marca la ruta como `[LIVE]` en la barra. Si responde `401/403/409/422` (errores reales de negocio/permisos/conflicto), **sí los muestra en la UI** para poder probar validaciones reales del backend.
   - **Paso 2 (`SANDBOX CUSTOM RECORDS`, opcional):** Si la ruta devuelve `404` (feature nueva aún no programada en el backend) y el backend soporta registros personalizados (`/api/kernel/custom-records` en `@shac` o custom entities en OM) con el toggle *"Persist unknown routes in Cloud Sandbox"* activo, guarda y consulta el JSON real en el servidor bajo `entity_slug`.
   - **Paso 3 (`LOCAL MOCK` en `localStorage`):** Si no hay URL, falla la red/CORS o el endpoint devuelve `404` sin sandbox remoto, resuelve la operación contra `localStorage` (`shac_workbench_v1:{tenantId}:{orgId}:{table}`) inicializado desde `canonicalSeeds.ts`:
     - Genera `id` ordenable tipo ULID, rellena `tenant_id`, `org_id`, `version` (incrementando en cada `update` y simulando `409 Conflict` si `expectedVersion` no coincide), `created_at` y `updated_at` en epoch ms.
     - Respeta `clientMutationId` en memoria/`localStorage` para poder probar reintentos e idempotencia en la maqueta.
     - Soporta búsqueda full-text ligera, filtros por igualdad/estado, ordenamiento y paginación.

### 5.4 El *Handoff Bundle* y la Skill de Cosecha (`shac-harvest-mockup`)

Para cerrar el ciclo con gasto mínimo de tokens en Antigravity:

1. **Botón `"Export Handoff Bundle"` en `DevBridgeBar`:**
   Descarga un archivo `shac-handoff-<feature>.json` que contiene:
   - El `EditionPresetId` y `RegionPackId` bajo los que se probó.
   - Las tablas de `DATA_MODEL.md` tocadas (o propuestas de campos `custom_fields` `cf_*` nuevos detectados en los registros creados durante la prueba).
   - Lista de comandos/endpoints invocados durante la sesión con ejemplos reales de `input` y `output` capturados (en enteros `Minor`/`Bps`/`Micros`).
2. **Flujo de absorción en Antigravity (`.agent/skills/shac-harvest-mockup/SKILL.md`):**
   - El usuario coloca el código exportado de AI Studio (ZIP descomprimido o archivos `.tsx`) + el `shac-handoff-<feature>.json` en una carpeta local ignorada por Git (`.workbench-inbox/<feature>/`).
   - Al pedir *"Cosecha la maqueta `<feature>`"*, la skill guía al agente sin exploración redundante para:
     1. Mapear los comandos capturados en el bundle directamente a `defineCommand` + Zod en `packages/modules/<modulo>/src/commands/*.ts` verificando las 116 tablas de `DATA_MODEL.md`.
     2. Integrar directamente el componente React 19 limpio (que ya usa los tokens CSS de `DESIGN.md` y la estructura de `Page`/`DataTable`/`CrudForm`) en `@shac/ui` y en la ruta correspondiente de `apps/web-spa` (TanStack Router + TanStack Query `offlineFirst` + Tailwind v4), conservando 1:1 las clases semánticas y la lógica entera (`money.ts`).
     3. Ejecutar los recibos RDD (`pnpm -r typecheck`, `knip`, `vitest`).

---

## 6. Lo que Queda a Criterio del Implementador (*Left to the Builder*)

- Diseño exacto del layout interno del cajón colapsable `DevBridgeBar` (siempre que no tape botones de acción primarios y pueda minimizarse a una píldora en esquina).
- Cantidad exacta de registros de ejemplo por tabla en `canonicalSeeds.ts` (entre 5 y 15 filas representativas por dominio principal bastan para probar paginación, filtros y multimoneda `USD`/`VES`/`COP`).
- Sincronización de cambios del Plan de Fase 1 (`docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md`) para referenciar `cors.ts` cuando llegue el momento de ejecutar la Task 6 de `@shac/node-worker`, sin alterar el orden actual de las Tasks 1 a 5.
