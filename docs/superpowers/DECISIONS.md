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
