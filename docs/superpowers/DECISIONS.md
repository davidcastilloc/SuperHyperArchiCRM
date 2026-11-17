# DECISIONS.md — Registro de Decisiones Arquitectónicas (SuperHyperArchiCRM)

Registro cronológico destilado para sincronización entre sesiones e instancias (Antigravity, Claude Code, Gemini CLI, Codex).

---

## ADR-001 (2026-11-16): Limpieza de `main` y Separación de Fuentes de Cosecha

- **Contexto:** `SuperHyperArchiCRM` se creó inicialmente como fork de `open-mercato/open-mercato` (Next.js + PostgreSQL + MikroORM + Awilix). Mantener ese árbol en `main` entraba en conflicto directo con el stack 100% Cloudflare Workers + D1 + Durable Objects SQLite + SvelteKit definido en `SPEC.md`.
- **Decisión:** Limpiar la rama `main` de `SuperHyperArchiCRM` para arrancar el monorepo `@shac/*` en sala limpia (*clean-room*), conservando `open-mercato` y los otros 8 repositorios auditados como referencias locales de solo lectura.

## ADR-002 (2026-11-16): Arquitectura Núcleo Universal + 4 Packs Compilables por Familia

- **Contexto:** Al fusionar las funcionalidades de 9 repositorios en una sola línea de productos (9 mercados verticales y 12 motores de dominio), compilar absolutamente todos los adaptadores verticales dentro de un único binario desde el primer día arriesga acercarse prematuramente al límite de `1 MiB gzip` (y `3 MiB gzip` en Cloudflare Free).
- **Alternativas Evaluadas:**
  1. *Núcleo Universal + Packs Compilables por Familia* (`commerce-wms`, `spaces-stays`, `cases-practice`, `physical-iot`) con `"sideEffects": false`.
  2. *Super-Binario Único Todo-en-Uno* con los 12 motores siempre presentes en el mismo bundle.
  3. *Postergar los verticales no comerciales* (Hoteles, Condominios, Salud, Legal, Garitas IoT) fuera de `SPEC.md`.
- **Decisión:** Se aprobó la **Opción 1 (Núcleo Universal + Packs por Familia)**. Cada edición vertical compila únicamente sus packs necesarios (`< 500 KiB gzip`), mientras `omni-enterprise` une los 4 packs bajo `< 1024 KiB gzip`.

## ADR-003 (2026-11-16): Unificación de Estado Caliente en `BranchInventoryDO`

- **Contexto:** Tantear stock por lote FEFO en retail/farmacia, abrir turnos de caja multi-divisa, evitar dobles reservas de habitaciones/unidades/consultorios y validar pases QR/LPR en garitas comparten el mismo requisito físico: serialización transaccional sub-milisegundo por sede física sin `SELECT ... FOR UPDATE`.
- **Decisión:** Extender el Durable Object `BranchInventoryDO` (`${tenantId}:${branchOrgId}`) con dos tablas calientes adicionales (`hot_space_locks` y `hot_access_passes`) junto a `hot_bin_balances`, `hot_inventory_lots`, `hot_pos_shifts`, `hot_idempotency_log` y `hot_outbox`.

## ADR-004 (2026-11-16): Regla Monetaria Entera y Conciliación Cuenta=Moneda

- **Contexto:** La experiencia real en `open-pos`, `GeorginaPOS` y `CRMWarehouse-Stores` demostró dos fuentes recurrentes de descuadre en calle: redondeos IEEE-754 en conversiones cambiarias (`USD`/`VES`/`EUR`/`COP`/`MXN`) y cajeros registrando pagos electrónicos locales dentro de cuentas en divisas.
- **Decisión:** Prohibir `number` decimal para montos/tasas en todo `@shac/*` (usar `basePriceMinor`, `taxRateBps`, `exchangeRateMicros`) e imponer validación transaccional `account.currency === payment.currency` en cada cobro mixto.

## ADR-005 (2026-11-16): Espejo Documental Git <-> Google Drive

- **Contexto:** El equipo coordina especificaciones estratégicas en la carpeta compartida de Google Drive (`SuperHyperArchiCRM`: subcarpetas `01` a `04`) y ejecuta código desde Git multi-instancia.
- **Decisión:** Mantener paridad entre la raíz/`docs/superpowers/` del repositorio Git y las 4 carpetas de Google Drive (`01_Specs_y_Agentes`, `02_Micro-Core_POS_y_WMS`, `03_Control_Plane_y_Perfiles_KV`, `04_Hub_Federado_B2B_y_Marketplace`), sin incluir jamás rutas absolutas de sistema operativo.

## ADR-006 (2026-11-16): Auditoría Columna por Columna (711 -> 116 Tablas) y Consolidación True All-in-One

- **Contexto:** Al auditar columna por columna los 9 repositorios locales más la instancia viva de Supabase (`PC911 IT GLOBAL / doctors-ehr` Postgres 17), se contabilizaron **711 tablas/modelos y más de 10,000 columnas** (incluyendo 22 tablas en vivo `therapist_*` / `therapy_*` con Verificación Electrónica de Visitas `EVV` geocercada, terapia grupal y ensayos conductuales ABA).
- **Decisión:**
  1. Unificar las 711 tablas fuente en **116 tablas canónicas sin duplicación ni pérdida de columnas** (`108` en Cloudflare D1 + `8` calientes en `BranchInventoryDO`), documentadas en `DATA_MODEL.md`.
  2. Adoptar el modelo **True All-in-One (`SPEC.md` v2.1.0)**: dado que la UI hace *code-splitting* estático (`0 KiB` en el Worker) y las 116 tablas Drizzle + Zod pesan `~145 KiB gzip` (dejando el binario completo bajo `< 900 KiB gzip`), un único motor incluye todos los dominios de fábrica y `CONFIG_KV` opera como un **App Store interno instantáneo (`0 ms`)** manteniendo a la vez la posibilidad de compilar ediciones recortadas si algún entorno embebido lo requiere.

## ADR-007 (2026-11-16): Armonización de Frontend (`React 19 + Vite + TanStack + shadcn/ui`) y Plan de Almacenamiento en 5 Capas

- **Contexto:** En `DESIGN.md` y `AGENTS.md` se estableció el sistema visual *Industrial Tactile Precision* sobre **React 19 + Vite (`@cloudflare/vite-plugin`) + TanStack Router + TanStack Query (`offlineFirst` sobre IndexedDB) + Tailwind CSS v4 + `shadcn/ui` (`new-york`)** para reutilizar directamente componentes MIT de `@open-mercato/ui` (`DataTable`, `CrudForm`, `FieldDefinitionsEditor`, `AiChat`) y diseñar pantallas con Google Stitch. Adicionalmente, se requirió formalizar la arquitectura física de persistencia multi-mercado antes de iniciar la Fase 1.
- **Decisión:**
  1. Unificar todos los documentos raíz y de fases (`v2.2.0`) alrededor del stack frontend React 19 + Vite + TanStack Router/Query + `@shac/ui`.
  2. Formalizar `STORAGE_ARCHITECTURE_PLAN.md` (`docs/superpowers/specs/2026-11-16-multi-market-storage-architecture.md`) estableciendo las 3 reglas de almacenamiento multi-mercado: **(a)** `1 Empresa = 1 Base D1 Física Aislada`, **(b)** `Tronco Universal (~35 tablas) + Satélites Tipados (~73 tablas) + Columnas Virtuales Indexadas v_cf_*`, y **(c)** separación estricta en **5 Cajas Físicas** (`KV`, `BranchInventoryDO`, `D1`, `R2` e `IndexedDB/Tauri`).

## ADR-008 (2026-11-16): Fase 2 — Idempotencia Compartida en `@shac/db-d1`, Aritmética BigInt/Entera en Catálogo y Serialización FEFO en `BranchInventoryDO`

- **Contexto:** Al implementar el Tronco Universal (`crm_parties`, `cat_products`, `v_cf_*` + `FTS5`) y el actor transaccional por sede (`BranchInventoryDO`) en la Fase 2, se necesitó evitar duplicación entre `@shac/mod-customers` y `@shac/mod-catalog`, prevenir desbordamientos o redondeos IEEE-754 al multiplicar montos *minor* por tasas `rateMicros` (ej. `USD -> VES`), y probar serialización real de las 8 tablas calientes sobre `workerd`.
- **Decisión:**
  1. Centralizar `checkIdempotency`, `buildIdempotencyInsert` y `buildActionLogInsert` dentro de `@shac/db-d1` (`packages/db-d1/src/idempotency.ts`) para reutilización directa en todos los módulos D1 (`@shac/mod-customers`, `@shac/mod-catalog` y sucesivos).
  2. Ejecutar las conversiones de precios 5 capas (`CONTRACT_1TO1 -> GROUP_TARIFF -> PROMOTION_CHANNEL -> VARIANT_UOM -> BASE_PRICE`), margen mínimo (`marginBps`) y conversión cambiaria (`rateMicros`) con aritmética entera `BigInt` sin punto flotante en `@shac/mod-catalog`.
  3. Mantener cada operación de inventario, bloqueo de espacios y turno de caja dentro de `ctx.storage.transactionSync(...)` en `BranchInventoryDO` (`@shac/actor-branch`), validado con la prueba de ráfaga concurrente de 50 descuentos FEFO (`40` exitosos en orden `LOT-EARLY` -> `LOT-LATE`, `10` rechazos `409 INSUFFICIENT_STOCK` y cero duplicados de `hot_outbox`).

## ADR-009 (2026-11-16): Fase 3 — Puerto `branchDo` en Kernel, Alias Explícitos en `d1.batch()` JOIN y Motor `Cuenta=Moneda` / GS1 / Landed Costs

- **Contexto:** Al extender el núcleo hacia POS multimoneda (`@shac/mod-pos`), WMS de doble partida (`@shac/mod-wms`) y packs fiscales (`@shac/mod-regional`), los comandos necesitaban invocar de forma tipada y verificable sobre `workerd` a `BranchInventoryDO`, proteger los listados con `LEFT JOIN` dentro de `d1.batch()` ante la colisión de columnas homónimas detectada en vivo en Fase 2 y garantizar exactitud sin decimales en cobros mixtos `"Restante"`, parser GS1-128 Modulo-10 y prorrateo de *Landed Costs*.
- **Decisión:**
  1. Incorporar el puerto opcional `branchDo?: BranchActorResolver` dentro de `ExecutionContext` en `@shac/kernel` (`packages/kernel/src/contracts.ts`) para desacoplar `@shac/mod-pos` y `@shac/mod-wms` del `Env` del Worker.
  2. Exigir proyecciones explícitas y alias `.as(...)` sin columnas homónimas en toda consulta `JOIN` ejecutada dentro de `ctx.db.batch()` (aplicado en `pos.kiosk.smartcheck`, `wms.pickings.list` y `regional.fiscal.stamp`).
  3. Validar `fin_accounts.currency === payment.currency` (`422 ERR_CURRENCY_ACCOUNT_MISMATCH`) tanto en los comandos `@shac/mod-pos` (antes de tocar DO/D1) como dentro de `ctx.storage.transactionSync` en `BranchInventoryDO`, manteniendo todas las operaciones bajo idempotencia por `clientMutationId`.

## ADR-010 (2026-11-16): Fase 4 — App Store en Vivo (`CONFIG_KV` `0 ms`), 9 Presets `@shac/editions` y Control Plane con Licencias `HMAC-SHA256`

- **Contexto:** La arquitectura All-in-One requiere encender/apagar módulos o fusionar mercados verticales en vivo (`0 ms`) sobre un nodo activo sin migrar ni perder registros existentes en D1 / `BranchInventoryDO`, además de contar con un Control Plane multi-D1 capaz de emitir licencias offline/híbridas firmadas y monitorear cuotas del plan `BYOC_FREE`.
- **Decisión:**
  1. Ampliar `KvStore` en `@shac/kernel` (`put?`) para que los comandos del sistema actualicen `CONFIG_KV` (`profile:current`) e invaliden el caché en memoria del isolate (`ProfileLoader.invalidate()`) en el mismo request (`0 ms`).
  2. Mantener los 4 Packs de Familia y 9 Presets canónicos en `@shac/editions` (`editions/presets`) con guardias que protegen `core` e `iam` y fusionan vocabularios sin tocar datos transaccionales.
  3. Implementar `@shac/control-plane` (`apps/control-plane`) con las 5 tablas `cp_*`, firma y verificación WebCrypto `HMAC-SHA256` en tiempo constante (`crypto.subtle`), alertas tempranas `WARN_75` en cuentas `BYOC_FREE` y planificación de rollouts por anillos (`<= 1,200 req / 5 min`).

## ADR-011 (2026-11-16): Fase 5 — Federación Ed25519 (`FederationEnvelope`), Buffer 24h y Recepción ASN Automática

- **Contexto:** Conectar nodos independientes (`Tienda D1 A` y `Distribuidora D1 B`) con un Hub federado B2B/B2C exige aislamiento estricto de datos privados (costos, márgenes, consumidores finales), prevención de replays y consolidación de reabastecimiento sin micro-órdenes.
- **Decisión:**
  1. Estandarizar `@shac/federation-sdk` con `FederationEnvelope` firmado vía WebCrypto `Ed25519` + `SHA-256(canonicalJson)` y ventana anti-replay de `300_000 ms`, más matcher determinista GTIN/UOM y buffer de consolidación 24h (`consolidateLowStockHours`).
  2. Aislar `@shac/federation-hub` (`apps/federation-hub`) en su propia base D1 (`hub_nodes`, `hub_public_offers`, `hub_envelopes_idempotency`, `hub_b2b_orders`, `hub_inventory_holds`) exponiendo `findBestOffers`, búsqueda B2C y reserva temporal `holdInventoryTTL`.
  3. Exponer `/api/federation/b2b/{reorder-evaluate,asn-receive}` en `@shac/node-worker` creando automáticamente recepciones `asn_receipt` en D1 ante sobres `B2B_SHIPMENT_DISPATCHED` / `B2B_EPOD_CONFIRMED` verificados.

## ADR-012 (2026-11-16): Fase 6 — Bloqueo Atómico de Espacios en `BranchInventoryDO`, ADR/RevPAR y Split Rent Exacto

- **Contexto:** Evitar dobles reservas de habitaciones, consultorios o unidades ante ráfagas concurrentes (OTAs + mostrador) y calcular prorrateos de renta (`Split Rent`) y métricas hoteleras (`ADR`, `RevPAR`) sin errores de redondeo IEEE-754.
- **Decisión:**
  1. Serializar cada reserva en `spaces.bookings.reserve` adquiriendo primero el lock en `BranchInventoryDO` (`/space-lock` sobre `hot_space_locks` dentro de `ctx.storage.transactionSync`) antes de persistir `spc_bookings_and_appointments` y `spc_folios` en D1 (`30` reservas concurrentes -> `1` exitosa, `29` `409 SPACE_ALREADY_LOCKED`).
  2. Implementar `computeAdrAndRevParMinor` (`@shac/mod-spaces`) y `computeSplitRentShares` (`@shac/mod-leases`, `sum(shareBps) === 10_000` con distribución determinista del residuo) íntegramente en `BigInt`.

## ADR-013 (2026-11-16): Fase 7 — 101 Tablas D1, Custodia IOLTA (`CHECK balance_minor >= 0`), Co-Firma Clínica y Proposal Cards

- **Contexto:** Completar las verticales de Servicios de Campo & RMA (`@shac/mod-services`), Casos Clínicos/ABA & Legales (`@shac/mod-cases`), Finanzas GAAP & Fideicomisos Trust/IOLTA (`@shac/mod-finance`), Portal Externo (`@shac/mod-portal`) y Automatización (`@shac/mod-automation`) alcanzando los 101 esquemas en `@shac/db-d1` sin romper el presupuesto de tamaño del Worker All-in-One (`< 1024 KiB` gzip).
- **Decisión:**
  1. Garantizar en SQL (`CHECK (balance_minor >= 0)` en `fin_trust_escrow_ledgers`) y en dominio (`422 TRUST_OVERDRAFT_BLOCKED` y `UNBALANCED_JOURNAL_ENTRY` en `BigInt`) la imposibilidad de sobregiros Trust/IOLTA o asientos desbalanceados.
  2. Aislar datos confidenciales en `@shac/mod-portal` mediante filtro SQL obligatorio `is_confidential = 0` (`eq(isConfidential, false)`) en D1, y exigir aprobación humana explícita en *Proposal Cards* (`automation.proposals.decide`) antes de ejecutar acciones sugeridas por reglas.
  3. Desplegar los 5 módulos en `@shac/node-worker` (REST + `/mcp`) y `@shac/web-spa` (`/cases`, `/finance`, `/portal`, `/automation`) manteniendo todos los archivos `<= 300` líneas y el bundle del Worker en `230.41 KiB` gzip.

## ADR-014 (2026-11-16): Fase 8 — Control Físico IoT (`@shac/mod-physical`), Validación en Tiempo Constante y Cierre de Presupuesto Global

- **Contexto:** Cerrar la arquitectura All-in-One incorporando el Dominio 12 (cerraduras inteligentes, casilleros QR, garitas LPR, clips `SHA-256` en R2 y alertas anti-sabotaje) sin exceder el presupuesto de `1024 KiB` gzip del Worker.
- **Decisión:**
  1. Almacenar credenciales de acceso (`phy_access_passes`) como hashes `SHA-256` y validarlas en tiempo constante (`timingSafeEqual` XOR sobre bytes en `@shac/mod-physical`), rechazando pases inválidos/expirados/revocados con `403`.
  2. Implementar lectura LPR (`< 15 ms`), registro de clips R2 con hash `SHA-256` y alertas anti-sabotaje `CRITICAL` (`phy_tamper_alerts`), conectados en `@shac/node-worker` (REST + `/mcp`) y `@shac/web-spa` (`/physical`).
  3. Cerrar el binario completo All-in-One en `235.45 KiB` gzip (`< 1024 KiB`) con `0` issues en `knip --strict` y `109` tablas en `@shac/db-d1`.


## ADR-015 (2026-11-16): Auditoría Forense Multi-Vertical (`14/40` -> Plan Maestro en 4 Olas), `DESIGN.md` v2.2.0 Estricto y Aislamiento `presetMode: 'replace'`

- **Contexto:** Una auditoría híbrida en 2 capas (barrido Chrome CDP en vivo sobre `wrangler dev --local` en `360x800`, `1024x768` y `1440x900` + `impeccable detect` + 4 directores UX/dominio aislados) evaluó las 9 verticales y 38 rutas bajo el estándar *Operación Real Día 1 + Demo Comercial*. Aunque el motor backend (`@shac/mod-*`, `@shac/actor-branch`, `110` tablas/vistas D1) está operativo, `apps/web-spa` puntuó `14/40` en heurísticas de Nielsen y `6/20` en auditoría técnica por 7 cortocircuitos: bloqueo Día 1 sin `/setup`, `applyAppStoreToggle` aditivo sin apagar módulos ajenos ni propagar vocabulario, sidebar móvil de `1,745px` apilado arriba del contenido, fuga del ERP en rutas públicas (`/f/$slug`, `/quote/$orderNumber`), divergencia visual frente a `DESIGN.md`, IDs quemados (`pty_pat_1`, `pty_cli_1`, `acc_usd_cash`, `veh_cold`) y tabla SQL inexistente (`wms_warehouses_and_locations`).
- **Decisión:**
  1. Hacer cumplir estrictamente **`DESIGN.md` v2.2.0** (`Plus Jakarta Sans` + `JetBrains Mono`, azul cobalto `#2563EB`, lienzo `#F6F7F9` con tarjetas `#FFFFFF` en claro y `#0C0E12`/`#141820` en oscuro, `data-density="touch"` de `48–56px` en superficies táctiles y cero gradientes neón).
  2. Extender `@shac/editions` con `presetMode: 'merge' | 'replace'` (conservando `'merge'` por defecto programático y usando `'replace'` en App Store y Personas) y estructurar la navegación en **5 Estaciones de Trabajo colapsables** filtradas por `moduleId` + `allowedPresets` (`8–12` ítems por vertical) con `MarketProfileContext` reactivo y `React.lazy` por ruta.
  3. Aislar `/auth` sin sesión, `/kiosk/price-check` (modo kiosco bloqueado con salida por PIN de 4 dígitos), `/f/$slug` y `/quote/$orderNumber` en `<ExternalPortalShell>`, implementar `POST /api/auth/setup` preservando perfiles previos de Control Plane (manteniendo `503` *fail-closed* si `iam_users > 0` y falta `profile:current`) y aplicar techo jerárquico `orgPath` (`defaultOrgId`) en `login`, `pin` y `switch-branch`.
  4. Ejecutar la remediación completa mediante las 26 tareas atómicas TDD de `docs/superpowers/plans/2026-11-16-omni-vertical-usability-remediation-master-plan.md`.

## ADR-016 (2026-11-17): Cierre de Remediación Omni-Vertical (27 Tareas), Endurecimiento Post-Revisión y Despliegue a Producción

- **Contexto:** Tras ejecutar las 4 olas (27 tareas: `Tasks 1–26` + `Task 5B`) del Plan Maestro de Remediación Omni-Vertical, la revisión de rama completa verificó cero hallazgos críticos y detectó 4 mejoras importantes antes de integrar a `main` y desplegar a Cloudflare Workers: validación de alcance/privilegios en `POST /api/iam/users`, `onError` faltante en `syncMutation`, 1 archivo sin confirmar (`HospitalityPmsView.tsx`) y 12 archivos fuente sobre el límite de `300` LOC (`AGENTS.md` §3).
- **Decisión:**
  1. Endurecer `POST /api/iam/users` (`apps/node-worker/src/iam-admin-routes.ts`) bloqueando con `403` la escalación a `perms: ['*']` sin poseer wildcard previo y validando que `defaultOrgId` y `allowedOrgIds` pertenezcan a `auth.actor.tenantId` en `iam_organizations`, respaldado por pruebas de integración en `auth.routes.worker.test.ts` (`6/6` passing).
  2. Modularizar los 12 archivos que superaban `300` LOC extrayendo `lazyViews.ts`, `PublicQuoteView.tsx`, `FleetDispatchPanel.tsx` y `ClinicalLabsRcmPanel.tsx`, eliminando barriles legados (`CasesView.tsx`, `Phase2Views.tsx`, `PosWmsViews.tsx`) y cerrando `pnpm -r typecheck` (`0` errores), `pnpm dlx knip --strict` (`0` problemas), `pnpm -r test:run` (`49` tests en `node-worker`, `32` en `web-spa`), `vite build` (`97.44 kB` gzip inicial) y `wrangler deploy` (`267.73 KiB` gzip total).
  3. Integrar en `main` (`747eef9`) y desplegar a producción en `https://shac-node-worker.pc911itservices.workers.dev` (Version ID `34885324-a0a6-4e44-b66c-f5285b952bd0`), verificado con `GET /` (`200`) y `GET /api/auth/bootstrap` (`200`).
