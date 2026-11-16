# SPEC.md — Arquitectura Maestra de SuperHyperArchiCRM

**Versión:** 2.0.0 (Núcleo Universal + Packs Compilables por Familia)  
**Estado:** Especificación Fundacional Aprobada para Ejecución (Spec-Driven / ODD + RDD)  
**Repositorio Oficial:** `https://github.com/davidcastilloc/SuperHyperArchiCRM.git` (scope `@shac/*`)  
**Stack Objetivo:** 100% Cloudflare Developer Platform (Workers, Static Assets, D1, Durable Objects SQLite, KV, Queues, R2, Vectorize, Workers AI)  
**Fuentes de Dominio Cosechadas ("La Licuadora"):** Extracción limpia (*clean-room*) de contratos y primitivas probadas en campo a partir de 9 repositorios: [Open Mercato](https://github.com/open-mercato/open-mercato) (MIT), `CRMWarehouse-Stores`, `open-pos`, `GeorginaPOS`, `hotel-project-turpial`, `apartment-property-management`, `Doctors-EHR-New`, `lawyerplatform` y `helios`.

---

## 1. Propósito y Principios Invariantes de Ingeniería

**SuperHyperArchiCRM** es una línea de productos de software empresarial (*Software Product Line*) multi-mercado y multi-situación diseñada para operar **Punto de Venta (POS)**, **Gestión de Almacenes (WMS)**, **CRM Comercial**, **Servicio Técnico / RMA**, **Hotelería (PMS)**, **Administración Inmobiliaria / Condominios**, **Clínicas Médicas**, **Despachos Legales / Consultoría PSA** y **Control Físico / Garitas IoT** desde **un único monorepo en TypeScript**, desplegable en miles de instancias aisladas a costo marginal cercano a cero y conectable nativamente en una **Red Comercial Federada B2B/B2C**.

Todo agente de código o ingeniero que contribuya a este repositorio debe respetar siete invariantes estrictas:

1. **Tronco Único con Packs por Familia (*Single-Trunk, Family-Pack Tree-Shaking*):** Queda prohibido crear ramas Git por cliente o escribir condicionales `if (tenant === 'cliente_x')` en código fuente. El monorepo se organiza en un **Núcleo Universal** más **4 Packs Compilables por Familia** (`commerce-wms`, `spaces-stays`, `cases-practice`, `physical-iot`), donde cada edición empaqueta únicamente los packs requeridos (`< 500 KiB gzip`) y la edición `omni-enterprise` los fusiona todos (`< 1024 KiB gzip`), gobernando el comportamiento vivo mediante **Perfiles de Mercado en KV** y metadatos `cf_*` en **Cloudflare D1**.
2. **Cumplimiento Estricto de Presupuestos del Borde (*Edge Budgets*):** Ningún endpoint HTTP puede superar **5 ms de CPU** en el percentil 99 ni generar un artefacto Worker mayor a **1 MiB gzip**, manteniéndose ampliamente dentro de los topes de **10 ms de CPU** y **3 MiB gzip** del plan gratuito de [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/limits/). Quedan prohibidos contenedores DI dinámicos por petición (`awilix`, `tsyringe`) y funciones criptográficas bloqueantes (`pbkdf2Sync`).
3. **Separación entre Estado Caliente y Estado Analítico:** Las lecturas masivas, catálogos, CRM, expedientes e historiales residen en [Cloudflare D1](https://developers.cloudflare.com/d1/) consultados mediante lotes `db.batch()`, evitando tormentas N+1. El descuento físico de inventario, los lotes **FEFO**, los turnos de caja POS, la disponibilidad caliente de habitaciones/unidades y las reservas atómicas residen en un **Durable Object con SQLite embebido** por sucursal/sede (`BranchInventoryDO`), eliminando bloqueos `SELECT ... FOR UPDATE`.
4. **Simetría Humana y Agéntica (`1 Comando = REST RPC + MCP Tool`):** Cada caso de uso se declara una sola vez con validación Zod y se expone simultáneamente como ruta tipada en [Hono RPC](https://hono.dev/docs/guides/rpc) para la interfaz web y como herramienta en `/mcp` mediante `createMcpHandler` stateless. Todo flujo asistido por IA que mute datos de negocio debe pasar por confirmación humana mediante *Proposal Cards* con `diff` verificable cuando la política del perfil lo exija.
5. **Interfaz Offline-First a Costo Cero de Worker:** El cliente web es una Single Page Application (SPA) en **SvelteKit (`adapter-static`) + Tailwind CSS v4** servida directamente por [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) sin invocar cómputo del Worker al cargar vistas, respaldada por **IndexedDB** (y empaquetado nativo opcional en Tauri SQLite para terminales fijos o garitas) para operar cajas registradoras, kioscos y accesos sin internet.
6. **Multimoneda, Fiscalidad y Pagos como Configuración Regional:** Todos los importes monetarios se almacenan como enteros en unidades menores (`basePriceMinor`, centavos) y tasas en puntos básicos (`taxRateBps`) o escalas enteras fijas (`exchangeRateMicros`), con cuentas financieras segregadas estrictamente por divisa y packs regionales activables por perfil (`ve`, `co`, `mx`, `us`, `global`).
7. **Modularidad Atómica para Agentes:** Ningún archivo de implementación en `packages/` o `apps/` debe superar las **300 líneas de código**. Cada paquete exporta funciones puras ES Modules con `"sideEffects": false` para garantizar poda estática completa.

---

## 2. Presupuestos Operativos en Cloudflare (Free vs. SaaS Paid vs. Híbrido)

El diseño soporta tres modalidades comerciales complementarias sobre la misma arquitectura:

| Recurso Cloudflare | Cuenta Workers Free (Modo 1-Clic BYOC) | Cuenta Workers Paid (USD 5/mes Modo SaaS Flota) | Regla de Arquitectura en SuperHyperArchiCRM |
| :--- | :--- | :--- | :--- |
| **Cómputo Worker** | 100,000 req/día, 10 ms CPU/invocación, bundle máx. 3 MiB gzip | 10 millones req/mes incluidos, 30 s CPU máx., bundle máx. 10 MiB gzip | Activar Worker solo en `/api/*`, `/mcp` y `/ws/*`; servir toda la UI estática por CDN (`< 500 KiB` gzip por edición, `< 1024 KiB` omni) |
| **Bases de Datos D1** | 10 bases/cuenta (500 MB c/u), 5M lecturas/día, 100k escrituras/día con corte diario | **100,000 bases D1 incluidas**, 10 GB c/u, 25B lecturas/mes y 50M escrituras/mes | 1 base D1 física por cliente (`tenant`) para aislamiento absoluto y D1 Time Travel independiente |
| **Durable Objects SQLite** | Disponible en plan Free con cuotas equivalentes a D1 | Escalado elástico por sucursal/sede con hibernación WebSocket | 1 instancia `BranchInventoryDO` por sucursal/edificio activo (`orgId`); hibernar conexiones inactivas |
| **Almacenamiento R2 y PDF** | Cuota gratuita inicial con *zero egress* + 10 min/día Browser Rendering | 10 horas/mes de Browser Rendering incluidas; cero cargo de salida en R2 | Renderizar tickets térmicos y habladores en cliente (ESC/POS / WebUSB / CSS Print) y reservar Browser Rendering/PDF para facturas legales y reportes |
| **Modo Local / Appliance** | Nodos Tauri SQLite o puente LAN sincronizados contra el borde | Licencia perpetua opcional firmada con `HMAC-SHA256` verificable offline | Permite operar sin internet indefinidamente y sincronizar deltas idempotentes hacia D1/DO al reconectar |

---

## 3. Topología del Monorepo: Núcleo Universal + 4 Packs por Familia

Todos los paquetes conviven en un monorepo gestionado con `pnpm` workspaces y compilación incremental:

### 3.1 Capa 0 — Núcleo Universal (Común a todas las ediciones)

| Ruta en el Monorepo | Nombre del Paquete | Responsabilidad Única | Dependencias Permitidas |
| :--- | :--- | :--- | :--- |
| `packages/kernel` | `@shac/kernel` | Contratos `defineCommand`, `defineModule`, Auth WebCrypto + KV, RBAC jerárquico, PINs rápidos/delegados, motor `cf_*`, multimoneda base, `ActionLog` Undo/Redo, Hono RPC y MCP v2 (`createMcpHandler`) | `hono, zod, agents` |
| `packages/db-d1` | `@shac/db-d1` | Esquemas nucleares D1 en Drizzle ORM, constructor `FTS5`, migrador aditivo e índices virtuales JSON (`v_cf_*`) | `drizzle-orm, @shac/kernel` |
| `packages/actor-branch` | `@shac/actor-branch` | Clase `BranchInventoryDO` con Drizzle Durable SQLite, motor FEFO/FIFO, turnos POS, bloqueo caliente de unidades/espacios, `hot_idempotency_log`, `hot_outbox` y WebSockets | `drizzle-orm, @shac/kernel` |
| `packages/modules/iam` | `@shac/mod-iam` | Inquilinos, árbol `organizations`, staff, identidad separada de portal externo, sesiones, llaves API (`mk_live_*`), turnos de personal y reloj checador | `@shac/kernel, @shac/db-d1` |
| `packages/modules/customers` | `@shac/mod-customers` | Terceros 360 (`parties`: personas/empresas N:M), grupos B2B/B2C, pipelines Kanban, admisión digital (intake + OCR/KYC), chequeo de conflictos y padrón fiscal (Cédula/RIF/NIT/RFC + Walk-in) | `@shac/kernel, @shac/db-d1` |
| `packages/modules/catalog` | `@shac/mod-catalog` | Productos (`GTIN`/`EAN`, `SKU`), variantes, conversiones UOM, cascada de precios de 5 capas + guardarraíl de margen, promociones/cupones, historial Omnibus, habladores/etiquetas y migrador CSV difuso | `@shac/kernel, @shac/db-d1` |
| `packages/federation-sdk` | `@shac/federation-sdk` | Firmas Ed25519/HMAC entre nodos, `FederationEnvelope` B2B/B2C y cliente RPC hacia el Hub Federado | `zod, @shac/kernel` |

### 3.2 Capa 1 — Los 4 Packs Compilables por Familia (`packages/packs/*` y `packages/modules/*`)

| Familia de Pack | Paquetes Incluidos | Capacidades Clave Cosechadas de la Licuadora | Presupuesto Gzip Individual |
| :--- | :--- | :--- | :--- |
| **Pack 1: `commerce-wms`** | `@shac/mod-pos`, `@shac/mod-wms`, `@shac/mod-regional` | Candado de sesión de caja, conciliación Cuenta=Moneda, cobro mixto con botón `"Restante"`, arqueo ciego, devoluciones en 2 fases, Kiosco `SmartCheck` (10s), WMS doble partida (AVCO/FIFO, *landed costs*, *wave picking*, `-BACKORDER`), parser **GS1-128** FEFO, buffer B2B 24h, flota GPS con firma `e-POD` y adaptadores fiscales/pagos (`ve`, `co`, `mx`, `us`) | `< 420 KiB` |
| **Pack 2: `spaces-stays`** | `@shac/mod-spaces`, `@shac/mod-leases` | Matriz visual en vivo (*Live Rack*) de habitaciones/unidades/consultorios/bahías, reservas multi-canal OTA, *Quick Check-In*, cuenta abierta (**Folio**), *Housekeeping*, **ADR/RevPAR**, contratos de renta con depósito *escrow*, *Autopay*, **Split Rent** entre co-inquilinos, renovaciones con incentivos, preaviso de mudanza, agenda multi-especialista y `WaitlistManager` | `< 380 KiB` |
| **Pack 3: `cases-practice`** | `@shac/mod-services`, `@shac/mod-cases`, `@shac/mod-finance`, `@shac/mod-portal`, `@shac/mod-automation` | Ficha unificada de Orden Técnica / RMA / Expediente Legal (`Matter` + `Docket`) / Encuentro Clínico (`Encounter`) / Ticket Edilicio; mantenimiento preventivo; garantías con recobro a proveedor; Escriba IA + co-presencia; cuentas fiduciarias **Trust/IOLTA**; *Claim Scrubber*; contabilidad general opcional; portal camaleónico `/[orgSlug]/portal`; `business_rules` + `workflows` BPM + `inbox_ops` | `< 480 KiB` |
| **Pack 4: `physical-iot`** | `@shac/mod-physical` | Cerraduras inteligentes con PIN maestro y pases temporales (`1h`–`24h`/estadía), orquestación de portones/barreras/cortinas de muelle, lista blanca LPR vehicular offline (`< 15 ms`), portero interactivo WhatsApp/Telegram ante placas desconocidas, casilleros QR de paquetería y clips de evidencia `SHA-256` en R2 | `< 320 KiB` |

### 3.3 Capa 2 — Ediciones y Aplicaciones Desplegables

| Ruta en el Monorepo | Nombre del Paquete | Responsabilidad Única |
| :--- | :--- | :--- |
| `editions/*` | `@shac/editions` | Puntos de entrada declarativos por familia y manifiesto completo `omni-enterprise` (`< 1024 KiB gzip`) |
| `apps/node-worker` | `@shac/node-worker` | Worker de cada cliente (API Hono + MCP + Queue Consumer + `wrangler.jsonc`) |
| `apps/web-spa` | `@shac/web-spa` | SPA SvelteKit estática + Tailwind v4 + motor offline IndexedDB + vistas Kiosco/TV/Garita adaptativas por `TenantMarketProfile` |
| `apps/control-plane` | `@shac/control-plane` | Torre de control maestra: alta 1-clic, gestión de perfiles KV, licencias HMAC, telemetría de cuotas y canales GitOps (`canary` -> `stable`) |
| `apps/federation-hub` | `@shac/federation-hub` | Enrutador B2B entre clientes, malla MCP inter-empresa e indexador global B2C (D1 Read Replicas + Vectorize) |

---

## 4. Pilar 1: El Micro-Core (`@shac/kernel`, `D1` y `BranchInventoryDO`)

### 4.1 Contrato Funcional de Comandos, Vocabulario y Perfiles

Ningún módulo instancia clases pesadas ni lee variables globales. Todo acceso a recursos ocurre a través de `ExecutionContext`:

```ts
// packages/kernel/src/contracts.ts
import type { z } from 'zod';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

export type EditionPresetId =
  | 'retail-pos'
  | 'distro-wms'
  | 'tech-service'
  | 'hospitality-pms'
  | 'property-condo'
  | 'clinic-practice'
  | 'legal-psa'
  | 'industrial-gate'
  | 'omni-enterprise';

export type RegionPackId = 've' | 'co' | 'mx' | 'us' | 'global';

export interface MarketVocabulary {
  partySingular: string;
  partyPlural: string;
  orderSingular: string;
  branchSingular: string;
  spaceSingular: string;
  caseSingular: string;
}

export interface CurrencyProfile {
  baseCurrency: string; // e.g. 'USD'
  operatingCurrencies: string[]; // e.g. ['USD', 'VES', 'EUR']
  rateSource: 'bcv' | 'central_bank' | 'manual';
  enforceAccountCurrencyMatch: boolean;
}

export interface TenantMarketProfile {
  deploymentId: string;
  tenantId: string;
  editionPreset: EditionPresetId;
  regionPack: RegionPackId;
  activePacks: Array<'commerce-wms' | 'spaces-stays' | 'cases-practice' | 'physical-iot'>;
  activeModules: string[];
  vocabulary: MarketVocabulary;
  currency: CurrencyProfile;
  entitlements: {
    maxBranches: number;
    maxPosRegisters: number;
    maxSpacesOrUnits: number;
    aiCopilotEnabled: boolean;
    customEntitiesLimit: number;
  };
  federation: {
    enabled: boolean;
    nodeDid: string;
    publishPublicCatalog: boolean;
    acceptPeerB2BOrders: boolean;
    consolidateLowStockHours: number; // e.g. 24 for 24h B2B buffer, 0 for immediate
    allowedSupplierDids: string[];
  };
  updatedAt: string;
}

export interface ExecutionContext<EnvBindings = CloudflareBindings> {
  env: EnvBindings;
  db: DrizzleD1Database;
  profile: TenantMarketProfile;
  tenantId: string;
  orgId: string;
  orgPath: string;
  actor: {
    id: string;
    type: 'staff' | 'delegated_staff' | 'external_portal' | 'kiosk_device' | 'api_key' | 'mcp_agent' | 'federated_peer';
    delegatedById?: string;
    permissions: ReadonlySet<string>;
  };
  requestId: string;
}

export interface CommandSpec<TIn extends z.ZodTypeAny, TOut> {
  id: string;
  moduleId: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  requiredPermission: string;
  mcp?: {
    expose: boolean;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    requiresProposalCard?: boolean;
  };
  inputSchema: TIn;
  outputSchema: z.ZodType<TOut>;
  handler: (ctx: ExecutionContext, input: z.infer<TIn>) => Promise<TOut>;
}
```

### 4.2 Guardia de Ejecución, Autenticación WebCrypto, PINs y Puerta de Módulo

Cada petición entrante a `/api/*` o `/mcp` atraviesa una cadena lineal de 3 pasos en menos de `0.8 ms` de CPU:

1. **Carga de Perfil de Mercado (`profileLoader`):** Lee `TenantMarketProfile` desde caché en memoria del isolate (TTL `60 s`); si expira, lee `CONFIG_KV.get("profile:current", "json")`.
2. **Puerta de Módulo Activo (`moduleGate`):** Verifica `ctx.profile.activeModules.includes(command.moduleId)`. Si el módulo no está contratado/activo para ese cliente, responde `403 MODULE_NOT_ENABLED` sin tocar D1.
3. **Autenticación Asíncrona y PINs Operativos:**
   - Valida JWT EdDSA (`crypto.subtle.verify`), hash SHA-256 de API Key (`mk_live_...`) o sesión de PIN temporal en `SESSION_KV`.
   - Soporta cambio rápido de operador en piso/garita con PIN de 4 dígitos y **PIN de Delegación Temporal** de 6 dígitos (`4h`/`8h`/`24h`) que registra en auditoría tanto al ejecutor (`actor.id`) como al autorizante (`actor.delegatedById`).
   - El alta y login de contraseñas emplea exclusivamente `crypto.subtle.deriveBits` (PBKDF2-HMAC-SHA256 asíncrono en el hilo C++ de Workers, `< 1.5 ms` JS).

### 4.3 Esquema SQLite en Cloudflare D1 (`@shac/db-d1`) y Motor `cf_*`

Todas las tablas de negocio en D1 incluyen aislamiento por `tenant_id`, jerarquía de sucursales mediante `org_id`, control optimista de concurrencia con `version` entero, borrado lógico `deleted_at` y columna `custom_fields` JSON validado:

- **Campos Virtuales Indexados (`v_cf_*`):** Cuando un cliente marca `is_indexed = true` en `kernel_custom_field_defs` (ej. `cf_placa_vehiculo`, `cf_registro_sanitario`, `cf_numero_colegiado`), el migrador aditivo ejecuta `ALTER TABLE ... ADD COLUMN v_cf_<key> GENERATED ALWAYS AS (json_extract(custom_fields, '$.<key>')) VIRTUAL` más `CREATE INDEX`, logrando lecturas sub-milisegundo sin duplicar espacio.
- **Entidades Dinámicas (`kernel_custom_records`) + `FTS5`:** Tablas creadas sin código por el cliente con búsqueda instantánea de texto completo y tokens deterministas (`*_hash`) para campos sensibles cifrados con AES-256-GCM.
- **Bitácora `kernel_action_logs` con Undo/Redo:** Guarda snapshots compactos antes/después para auditoría regulatoria y reversión segura.

### 4.4 Estado Transaccional en el Actor de Sucursal (`BranchInventoryDO`)

Cada tienda física, almacén, hotel, edificio o clínica tiene un Durable Object determinístico `env.BRANCH_DO.idFromName("${tenantId}:${branchOrgId}")` con SQLite local serializado en un solo hilo:

| Tabla Interna en `BranchInventoryDO` | Clave Primaria | Propósito Crítico |
| :--- | :--- | :--- |
| `hot_bin_balances` | `(product_id, bin_code, lot_id)` | Saldo físico (`on_hand`), reservado (`reserved`) y disponible (`available`) en tiempo real |
| `hot_inventory_lots` | `lot_id` | Código GS1 de lote, `expiry_date` (epoch ms), costo unitario y cuarentena para despacho **FEFO** estricto |
| `hot_pos_shifts` | `shift_id` | Candado de turno abierto por cajero/caja, fondos iniciales por divisa, acumulados Cuenta=Moneda y correlativo de tickets |
| `hot_space_locks` | `(space_id, slot_key)` | Estado caliente y bloqueo sin doble reserva de habitaciones, unidades, consultorios, bahías o amenidades |
| `hot_access_passes` | `pass_code_hash` | Lista blanca caliente de PINs de cerraduras, QR de casilleros y matrículas LPR activas en la sede |
| `hot_idempotency_log` | `client_mutation_id` | Evita cobros, reservas o descuentos duplicados cuando una caja POS o garita offline sincroniza su cola al reconectar |
| `hot_outbox` | `seq_id` | Cola transaccional local respaldada por `ctx.storage.setAlarm` con entrega *at-least-once* hacia `EVENTS_QUEUE` |

---

## 5. Pilar 2: Perfiles de Mercado en KV (`9 Presets Canónicos`) y Situaciones Regionales

### 5.1 Catálogo de los 9 Presets Comerciales

| Preset ID | Mercado Objetivo | Packs Compilados | Vocabulario (`Party` / `Order` / `Space` / `Case`) | Capacidades Estrella Activadas |
| :--- | :--- | :--- | :--- | :--- |
| `retail-pos` | Minimarkets, farmacias, ferreterías, tiendas | `commerce-wms` | Cliente / Ticket de Venta / Tienda / Reclamo | POS multimoneda con botón `"Restante"`, candado Cuenta=Moneda, Kiosco `SmartCheck` (10s), habladores `USD`+local, Cédula/RIF |
| `distro-wms` | Mayoristas, importadoras, distribuidoras, 3PL | `commerce-wms`, `physical-iot` (opcional) | Cuenta Mayorista / Orden de Despacho / CEDI / RMA | WMS doble partida, GS1-128 FEFO, AVCO/FIFO, *landed costs*, *wave picking*, `-BACKORDER`, flota GPS `e-POD` |
| `tech-service` | Talleres técnicos, integradores IT, soporte | `commerce-wms`, `cases-practice` | Cliente / Orden de Servicio / Sede Técnica / Garantía RMA | Recepción por serial, diagnóstico, consumo de repuestos, mantenimiento preventivo, SLA con pausa y recobro a proveedor |
| `hospitality-pms` | Hoteles, posadas, resorts, apart-hoteles | `spaces-stays`, `commerce-wms`, `cases-practice`, `physical-iot` | Huésped / Reserva & Folio / Habitación / Tarea Housekeeping | *Live Room Rack*, reservas OTA, *Quick Check-In*, Folio unificado con minibar/POS, *Housekeeping*, ADR/RevPAR, PIN de puerta |
| `property-condo` | Condominios, edificios en renta, plazas comerciales | `spaces-stays`, `cases-practice`, `physical-iot` | Residente-Inquilino / Estado de Cuenta / Unidad / Ticket Mant. | Solicitud con *screening*, contrato `Lease` + *escrow*, *Autopay*, **Split Rent**, renovaciones, casilleros QR, mascotas, votaciones y garita LPR |
| `clinic-practice` | Clínicas, consultorios, odontología, centros de salud | `spaces-stays`, `cases-practice`, `commerce-wms` (farmacia) | Paciente / Encuentro-Consulta / Consultorio / Historia Clínica | Agenda multi-especialista + `Waitlist`, admisión OCR+OTP, TV de sala `/lobby`, Escriba IA + co-presencia, PIN delegado 6 dígitos, lotes FEFO, *Claim Scrubber* |
| `legal-psa` | Bufetes de abogados, contadores, consultoras | `spaces-stays` (agenda), `cases-practice` | Cliente-Representado / Estado de Honorarios / Despacho / Expediente (`Matter`) | Conflictos de interés, expedientes + `dockets` + plazos fatales, cronómetro de horas facturables, cuentas fiduciarias **Trust/IOLTA**, portal de cliente |
| `industrial-gate` | Parques industriales, estacionamientos, clubes | `spaces-stays` (pases), `physical-iot` | Residente-Transportista / Pase de Acceso / Garita-Muelle / Incidente | Portones multi-marca, LPR offline `< 15 ms`, portero interactivo WhatsApp/Telegram, clips forenses `SHA-256` en R2 y botón S.O.S. |
| `omni-enterprise` | Grupos híbridos multi-negocio | Los 4 Packs unidos (`< 1024 KiB gzip`) | Configurable dinámicamente por `orgId` | Fusión en caliente de cualquier combinación de mercados compartiendo catálogo, clientes, tesorería y actores de sede |

### 5.2 Packs Regionales (`regionPack` en `TenantMarketProfile`)

- **`ve` (Venezuela):** Trimoneda `VES`/`USD`/`EUR`, sincronización automática BCV/DolarAPI + caché local, IVA `16%`/`8%`/`0%`, retención `ISLR`, validador RIF y padrón de Cédula, Pago Móvil con referencia obligatoria, BioPago, Efectivo USD, Zelle y conector de impresora fiscal HKA.
- **`co` (Colombia):** `COP`, IVA `19%`, facturación electrónica DIAN con **CUFE SHA-384** y QR; medios nativos **Nequi**, **Daviplata**, **PSE**, **QR Bancolombia** y **Bre-B**.
- **`mx` (México):** `MXN`, IVA `16%`, **CFDI 4.0** con UUID SAT; cobros con voucher **OXXO Pay**, **SPEI (CLABE)**, **CoDi** y **Dimo**.
- **`us` / `global`:** `USD`/`EUR`, Sales Tax o modo neto/bruto europeo con historial Omnibus, **Square Terminal**, **Stripe**, ACH, Apple/Google Pay y enlaces públicos `/pay/[slug]`.

---

## 6. Pilar 3: Control Plane de Flota (`@shac/control-plane`)

1. **Tres Topologías de Despliegue:**
   - **BYOC Free (1-Clic):** Instala Worker, D1, KV y `BranchInventoryDO` en la cuenta gratuita del propio cliente reportando telemetría diaria.
   - **SaaS Gestionado Multi-D1:** Aprovecha las **100,000 bases D1 aisladas incluidas** en Workers Paid junto con Workers for Platforms.
   - **Licencia Local / Híbrida (`HMAC-SHA256`):** Emite licencias verificables offline para nodos Tauri/LAN de clientes corporativos o mayoristas con opción de compra única (*Appliance Buyout*).
2. **Upgrade de Mercado en Caliente (`< 60 s`):** Al activar un nuevo módulo o pack desde `cp_market_profiles`, el Control Plane ejecuta únicamente sentencias `CREATE TABLE IF NOT EXISTS` aditivas sobre el D1 del cliente, siembra los `cf_*` correspondientes y actualiza `CONFIG_KV` sin migrar datos ni detener cajas abiertas.
3. **Despliegue por Anillos (`canary` -> `stable`):** Verifica presupuesto gzip y batería `@cloudflare/vitest-plugin`, promueve primero `canary`, monitorea 0% de errores 5xx durante 30 minutos y despliega en lotes respetando el rate-limit de la API de Cloudflare (`1,200 req / 5 min`), con rollback asistido por **D1 Time Travel**.

---

## 7. Pilar 4: Hub Federado B2B y Marketplace (`@shac/federation-hub`)

1. **Identidad `did:shac:<deploymentId>` con Ed25519:** Firma criptográfica de todo `FederationEnvelope`; jamás salen del D1 privado del cliente su cartera de compradores finales, costos internos, márgenes ni arqueos de caja.
2. **Cadena de Suministro B2B con Buffer de Consolidación de 24h:**
   - Cuando las ventas en tienda dejan productos bajo el mínimo, el nodo acumula los faltantes en una ventana configurable (por defecto `24h` para evitar micro-facturas, o `0h` para urgencias) y emite una única orden `B2B_PO_SUBMITTED` emparejada por `gtin` o `(supplier_did, supplier_sku)`.
   - La distribuidora reserva stock atómicamente en su `BranchInventoryDO`, despacha en flota con `B2B_SHIPMENT_DISPATCHED` + prueba `e-POD` y genera automáticamente el **Aviso Anticipado de Recepción (`ASN`)** listo para escanear con GS1-128 en la tienda compradora.
3. **Marketplace B2C y Super-Agente Comprador:** Ingesta por `Cloudflare Queues` hacia un índice global en **D1 con Read Replicas** + **Cloudflare Vectorize (`@cf/baai/bge-m3`)**, reservando stock directamente en el `BranchInventoryDO` del comercio vendedor antes de capturar el pago.

---

## 8. Plan Maestro de Ejecución Incremental (8 Fases ODD / RDD)

| Fase | Alcance de Construcción (Iteraciones de 50–200 LOC) | Recibo Obligatorio de Cierre (RDD) |
| :--- | :--- | :--- |
| **Fase 1: Cimientos del Micro-Core** | Monorepo `pnpm`, `@shac/kernel` (`defineCommand`, Auth WebCrypto + KV, PINs, `moduleGate`, Hono RPC, `createMcpHandler`), `@shac/db-d1` y `@shac/mod-iam` | Suite `@cloudflare/vitest-plugin` 100% verde; bundle `< 200 KiB gzip`; auth `< 1.5 ms` CPU |
| **Fase 2: Catálogo, CRM 360, `cf_*` y `BranchInventoryDO`** | `@shac/mod-catalog` (precios 5 capas, UOM, habladores, migrador CSV), `@shac/mod-customers` (Cédula/RIF, pipelines), columnas `v_cf_*` + `FTS5` y `BranchInventoryDO` con lotes GS1 **FEFO** | Ráfaga concurrente de 50 descuentos sobre último lote en `BranchInventoryDO` con 0 sobregiros, orden FEFO exacto y `<= 2` queries D1 por listado |
| **Fase 3: Pack `commerce-wms` y POS Offline-First** | `@shac/mod-pos` (sesión de caja, Cuenta=Moneda, botón `"Restante"`, devoluciones 2 fases, Kiosco `SmartCheck`), `@shac/mod-wms` (AVCO/FIFO, *landed costs*, `-BACKORDER`), `@shac/mod-regional` (`ve`/`co`/`mx`/`us`) y SPA SvelteKit + IndexedDB | Simulación de 20 ventas multimoneda desconectadas + 3 reintentos de reconexión con 0 duplicados en `hot_idempotency_log`; bundle edición `< 500 KiB gzip` |
| **Fase 4: Control Plane y Modo Camaleón en KV** | `editions/*`, `apps/control-plane`, telemetría de cuotas D1, licencias `HMAC` y upgrade en caliente entre presets | Upgrade en vivo de un nodo `retail-pos` a `distro-wms` + `tech-service` sin pérdida de datos ni reinicio |
| **Fase 5: Hub Federado B2B y Marketplace** | `@shac/federation-sdk` (Ed25519), `apps/federation-hub`, buffer B2B de 24h, flujo `B2B_PO_SUBMITTED` -> `e-POD` -> `ASN` e índice global D1 + Vectorize | Integración extremo a extremo entre Nodo Tienda (D1 A) y Nodo Distribuidora (D1 B) generando ASN automático |
| **Fase 6: Pack `spaces-stays` (Hoteles, Condominios y Agenda)** | `@shac/mod-spaces` (*Live Rack*, reservas OTA, Folio, *Housekeeping*, agenda + `Waitlist`) y `@shac/mod-leases` (`Lease`, *escrow*, *Autopay*, **Split Rent**, renovaciones) | Prueba de ráfaga de 30 reservas simultáneas contra la misma habitación/unidad en `hot_space_locks` con 0 dobles reservas |
| **Fase 7: Pack `cases-practice` (Taller, Salud, Legal, Finanzas y Portal)** | `@shac/mod-services` (RMA, mant. preventivo), `@shac/mod-cases` (`Encounter`/`Matter`/`Docket`, Escriba IA, co-presencia), `@shac/mod-finance` (Trust/IOLTA, *Claim Scrubber*), `@shac/mod-portal` y `@shac/mod-automation` (`InboxOps` + BPM) | Aislamiento estricto de saldos fiduciarios Trust/IOLTA, bloqueo de notas confidenciales en portal externo y aprobación humana de *Proposal Cards* |
| **Fase 8: Pack `physical-iot` (Cerraduras, Portones LPR y Garitas)** | `@shac/mod-physical` (PINs temporales de puerta, casilleros QR, LPR `< 15 ms`, portero WhatsApp/Telegram y clips `SHA-256` en R2) + fusión completa `omni-enterprise` | Emisión automática de PIN al hacer *Check-In*, validación de pase con `timingSafeEqual` y bundle total `omni-enterprise` `< 1024 KiB gzip` |
