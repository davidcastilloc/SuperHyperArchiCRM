# SPEC.md — Arquitectura Maestra de SuperHyperArchiCRM

**Versión:** 2.2.0 (True All-in-One — Motor Único Unificado + Almacenamiento en 5 Capas + App Store en KV)  
**Documentos Compañeros Obligatorios:**
- `DATA_MODEL.md` — Diccionario canónico de **116 tablas** (`108` D1 + `8` Durable Object) destilado columna por columna desde **711 tablas/modelos reales**.
- `DESIGN.md` — Sistema de diseño *Industrial Tactile Precision* en **React 19 + Vite + TanStack Router/Query (`offlineFirst`) + Tailwind CSS v4 + `shadcn/ui`**.
- `AGENTS.md` — Manual operativo SDD + ODD/RDD para agentes de código.
- `docs/superpowers/specs/2026-11-16-multi-market-storage-architecture.md` (`STORAGE_ARCHITECTURE_PLAN.md` en Drive) — Arquitectura física y lógica de almacenamiento multi-mercado.

**Repositorio Oficial:** `https://github.com/davidcastilloc/SuperHyperArchiCRM.git` (scope `@shac/*`)  
**Stack Objetivo:** 100% Cloudflare Developer Platform (Workers, Static Assets, D1, Durable Objects SQLite, KV, Queues, R2, Vectorize, Workers AI) + SPA React 19 / Vite (`@cloudflare/vite-plugin`).

---

## 1. Propósito y Principios Invariantes de Ingeniería

**SuperHyperArchiCRM** es una plataforma empresarial **All-in-One** multi-mercado y multi-situación capaz de operar **Punto de Venta (POS)**, **Gestión de Almacenes (WMS)**, **CRM Comercial**, **Servicio Técnico / RMA**, **Hotelería (PMS)**, **Administración Inmobiliaria / Condominios**, **Clínicas Médicas y Terapias Conductuales**, **Despachos Legales / Consultoría PSA** y **Control Físico / Garitas IoT** desde **una única base de código en TypeScript**, desplegable en miles de instancias físicamente aisladas a costo marginal cercano a cero y conectable nativamente en una **Red Comercial Federada B2B/B2C**.

Todo ingeniero o agente de código que contribuya al repositorio debe respetar siete invariantes estrictas:

1. **Motor Único All-in-One con App Store Instantáneo en KV (*True All-in-One, Zero-Fork*):** Queda prohibido crear ramas Git por cliente o escribir condicionales `if (tenant === 'cliente_x')` en código fuente. El Worker incorpora los **12 Dominios Canónicos (`DATA_MODEL.md`)** dentro de un único binario modular bajo `< 1024 KiB gzip` (permitiendo además builds recortados `< 500 KiB gzip` cuando un entorno embebido lo requiera). `CONFIG_KV` opera como un **App Store interno de 1 clic** que activa u oculta módulos, menús y vocabulario en `0 ms` sin migraciones bloqueantes ni redespliegues.
2. **Aislamiento Físico por Cliente + Modelo Tronco y Satélites en D1:** Cada empresa cliente (`tenant`) posee **su propia base SQLite física aislada en Cloudflare D1**. Dentro de esa base conviven `~35` tablas de **Tronco Universal** (terceros `crm_parties`, productos/servicios `cat_products`, espacios `spc_units`, órdenes/facturas/pagos `com_*`, cuentas `fin_accounts`), `~73` **Tablas Satélite Tipadas** por industria y **Columnas Virtuales Indexadas `v_cf_*`** + `FTS5`, logrando cero duplicación de entidades y cero pérdida de integridad relacional.
3. **Cumplimiento Estricto de Presupuestos del Borde (*Edge Budgets*):** Ningún endpoint HTTP puede superar **5 ms de CPU** en el percentil 99 ni generar un artefacto Worker mayor a **1 MiB gzip** (dentro de los topes reales de `10 ms CPU / 3 MiB gzip` en Free y `30 s CPU / 10 MiB gzip` en Paid). Quedan prohibidos contenedores DI dinámicos (`awilix`, `tsyringe`) y funciones criptográficas bloqueantes (`pbkdf2Sync`).
4. **Separación en 5 Capas Físicas según Temperatura y Peso del Dato:**
   - **Capa 1 (`CONFIG_KV` + `SESSION_KV`):** Perfil de mercado activo (`< 0.5 ms`) y sesiones/PINs temporales.
   - **Capa 2 (`BranchInventoryDO` SQLite por Sede):** Las **8 tablas calientes** serializadas en `< 1 ms` sin `SELECT ... FOR UPDATE` (stock por lote **FEFO**, turnos POS abiertos, bloqueo de habitaciones/unidades/consultorios, cola TV `/lobby`, pases QR/PIN/LPR e idempotencia).
   - **Capa 3 (`Cloudflare D1` por Empresa):** Las **108 tablas maestras, históricas, clínicas, legales y contables**, consultadas por lotes `db.batch()` (`<= 2` sentencias por listado) y alimentadas asíncronamente vía `EVENTS_QUEUE`.
   - **Capa 4 (`Cloudflare R2` Zero-Egress):** Archivos binarios pesados (PDFs fiscales, fotos/firmas `e-POD`, estudios DICOM, audios del Escriba IA, contratos y clips de video con hash `SHA-256`).
   - **Capa 5 (`TanStack Query offlineFirst + IndexedDB / Tauri SQLite`):** Espejo local de catálogo/tasas cambiarias y cola de mutaciones desconectadas reconciliada contra `hot_idempotency_log` con cero duplicados.
5. **Simetría Humana y Agéntica (`1 Comando = Hono RPC + MCP Tool`):** Cada caso de uso se declara una sola vez con Zod y se expone simultáneamente en Hono RPC (`/api/*`) y en `/mcp` mediante `createMcpHandler` stateless, exigiendo *Proposal Cards* con `diff` para mutaciones iniciadas por IA cuando el perfil lo indique.
6. **Interfaz React 19 Offline-First a Costo Cero de Worker:** La aplicación `apps/web-spa` (**React 19 + Vite + TanStack Router + TanStack Query + Tailwind v4 + `shadcn/ui`** con primitivas portadas de `@open-mercato/ui` en `packages/ui`) se sirve desde **Workers Static Assets** con *code-splitting* automático por pantalla: tener más de 200 vistas pesa **`0 KiB`** dentro del Worker y el navegador descarga solo los `~20 KiB` de la vista abierta.
7. **Regla Monetaria Entera y Conciliación Cuenta=Moneda:** Todos los montos se almacenan como enteros en unidades menores (`basePriceMinor`), puntos básicos (`taxRateBps`) y micro-tasas (`exchangeRateMicros`), exigiendo `financial_account.currency === payment.currency` en cada asiento y limitando todo archivo fuente a `< 300` líneas con `"sideEffects": false`.

---

## 2. Presupuestos Operativos en Cloudflare (Free vs. SaaS Paid vs. Híbrido Local)

| Recurso Cloudflare | Cuenta Workers Free (Modo 1-Clic BYOC) | Cuenta Workers Paid (USD 5/mes Modo SaaS Flota) | Regla de Arquitectura en SuperHyperArchiCRM |
| :--- | :--- | :--- | :--- |
| **Cómputo Worker** | 100,000 req/día, 10 ms CPU/invocación, bundle máx. 3 MiB gzip | 10 millones req/mes incluidos, 30 s CPU máx., bundle máx. 10 MiB gzip | Activar Worker solo en `/api/*`, `/mcp` y `/ws/*`; UI React 19 + Vite servida gratis por CDN con *code-splitting* (`0 KiB` en Worker; Worker All-in-One `< 1024 KiB gzip`) |
| **Bases de Datos D1** | 10 bases/cuenta (500 MB c/u), 5M lecturas/día, 100k escrituras/día | **100,000 bases D1 aisladas incluidas**, 10 GB c/u, 25B lecturas/mes y 50M escrituras/mes | **1 base D1 física por cliente (`tenant`)**; las 108 tablas vacías ocupan solo `~620 KB` (`0.12%` en Free) con D1 Time Travel independiente |
| **Durable Objects SQLite** | Disponible en plan Free con cuotas equivalentes a D1 | Escalado elástico por sucursal/edificio con hibernación WebSocket | 1 instancia `BranchInventoryDO` por sede activa (`${tenantId}:${branchOrgId}`) |
| **Almacenamiento R2 y PDF** | Cuota gratuita inicial con *zero egress* + 10 min/día Browser Rendering | 10 horas/mes Browser Rendering incluidas; cero cargo de salida en R2 | Tickets térmicos y habladores renderizados en cliente; Browser Rendering y R2 reservados para PDFs legales, DICOM, audios y clips forenses |
| **Modo Local / Appliance** | Nodos Tauri SQLite o puente LAN sincronizados contra el borde | Licencia perpetua opcional firmada con `HMAC-SHA256` verificable offline | Permite compra única (*Appliance Buyout*) u operación indefinida sin internet |

---

## 3. Topología del Monorepo Único (`pnpm` Workspaces)

| Ruta en el Monorepo | Nombre del Paquete | Responsabilidad Única (Mapeada a `DATA_MODEL.md`) |
| :--- | :--- | :--- |
| `packages/kernel` | `@shac/kernel` | `defineCommand`, `defineModule`, Auth WebCrypto + KV, PINs de piso (4 dígitos) y delegación (6 dígitos), `moduleGate`, multimoneda entera, `ActionLog` Undo/Redo, Hono RPC y `createMcpHandler` |
| `packages/db-d1` | `@shac/db-d1` | Las **108 tablas canónicas D1** organizadas por dominio en Drizzle SQLite, migrador aditivo, columnas virtuales `v_cf_*` y constructor `FTS5` |
| `packages/actor-branch` | `@shac/actor-branch` | Clase `BranchInventoryDO` con las **8 tablas calientes SQLite** (stock FEFO, turnos POS, bloqueo de espacios, cola `/lobby`, pases QR/LPR, idempotencia y outbox) |
| `packages/ui` | `@shac/ui` | Sistema de diseño `DESIGN.md` en React 19 + Tailwind v4 + `shadcn/ui` (`ShacAppShell`, `ShacDataTable`, `ShacCrudForm`, `CustomFieldsEditor`, `ShacCopilotSheet`) |
| `packages/modules/iam` | `@shac/mod-iam` | Dominio 1: Tenants, árbol `iam_organizations`, staff vs. portal externo, RBAC/ACLs, MFA/SSO, llaves API, perspectivas UI y turnos/reloj checador |
| `packages/modules/customers` | `@shac/mod-customers` | Dominio 2: Terceros unificados `crm_parties`, vínculos (empresas, tutores, *roommates*), grupos B2B, pipelines Kanban, admisión OCR/KYC, conflictos de interés, padrón Cédula/RIF/NIT/RFC y nómina |
| `packages/modules/catalog` | `@shac/mod-catalog` | Dominio 3: Productos/servicios/tarifas CPT, variantes/presentaciones UOM, cascada de precios 5 capas + guardarraíl de margen, promociones, Omnibus, tasas BCV y carrito de habladores |
| `packages/modules/pos` | `@shac/mod-pos` | Dominio 5: Candado de sesión de caja, conciliación Cuenta=Moneda, cobro mixto con botón `"Restante"`, arqueo ciego, devoluciones en 2 fases, Kiosco `SmartCheck` (10s) y links de cobro |
| `packages/modules/regional` | `@shac/mod-regional` | Dominio 5: Reglas fiscales y conectores de pago para Venezuela (`ve`), Colombia (`co`), México (`mx`), EE. UU. (`us`) e Internacional (`global`) |
| `packages/modules/wms` | `@shac/mod-wms` | Dominio 6: Almacenes/zonas térmicas, doble partida, parser **GS1-128** FEFO, AVCO/FIFO, *landed costs*, *wave picking*, `-BACKORDER`, buffer B2B 24h y flota GPS con `e-POD` |
| `packages/modules/spaces` | `@shac/mod-spaces` | Dominio 7: *Live Space Rack*, reservas multi-canal OTA, *Quick Check-In*, Folios abiertos, *Housekeeping*, ADR/RevPAR, agenda multi-especialista y `WaitlistManager` |
| `packages/modules/leases` | `@shac/mod-leases` | Dominio 7: Solicitudes de renta con *screening*, contratos `Lease` + depósito *escrow*, *Autopay*, **Split Rent**, renovaciones con incentivos, `VacateNotice` y hub comunitario |
| `packages/modules/services` | `@shac/mod-services` | Dominio 8: Órdenes de taller por serial, tickets correctivos de edificio/hotel, mantenimiento preventivo, garantías RMA con recobro a proveedor y verificación GPS en campo (**EVV**) |
| `packages/modules/cases` | `@shac/mod-cases` | Dominios 8 y 9: Expedientes legales (`matters` + `dockets` + plazos fatales), proyectos PSA, historia clínica completa (`SOAP`, co-firma, `eRx`/`EPCS`, Labs/DICOM, terapias ABA/grupales y RCM EDI 837/835) |
| `packages/modules/finance` | `@shac/mod-finance` | Dominio 10: Cuentas por moneda, cuentas fiduciarias aisladas **Trust/IOLTA**, plan de cuentas GAAP, libro diario, CxP/gastos/`1099`, conciliación bancaria, activos fijos y presupuestos |
| `packages/modules/portal` | `@shac/mod-portal` | Dominios 10 y 11: Portal camaleónico `/[orgSlug]/portal` (Mayorista B2B, Huésped/Inquilino, Paciente/Tutor con filtro `is_confidential = 0` y Cliente Legal) |
| `packages/modules/automation` | `@shac/mod-automation` | Dominio 11: Documentos colaborativos Yjs, formularios GDPR, canales omnicanal, agentes de voz IA, `business_rules`, `workflows` BPM e `InboxOps` (*Proposal Cards*) |
| `packages/modules/physical` | `@shac/mod-physical` | Dominio 12: Cerraduras inteligentes con PIN temporal, casilleros QR de paquetes, portones/barreras LPR offline `< 15 ms`, aprobación por WhatsApp/Telegram y clips `SHA-256` en R2 |
| `packages/federation-sdk` | `@shac/federation-sdk` | Identidad `did:shac:*`, firmas Ed25519/HMAC y `FederationEnvelope` |
| `editions/*` | `@shac/editions` | Configuración All-in-One predeterminada y los 9 presets iniciales de arranque rápido |
| `apps/node-worker` | `@shac/node-worker` | Worker de cada cliente (Hono RPC + MCP stateless + Queue Consumer + `wrangler.jsonc`) |
| `apps/web-spa` | `@shac/web-spa` | SPA React 19 + Vite + TanStack Router/Query (`offlineFirst`) + Tailwind v4 + `@shac/ui` |
| `apps/control-plane` | `@shac/control-plane` | Torre maestra: aprovisionamiento 1-clic, App Store de perfiles KV, licencias HMAC, telemetría de cuotas y anillos `canary` -> `stable` |
| `apps/federation-hub` | `@shac/federation-hub` | Enrutador B2B inter-empresa, malla MCP e índice global B2C (D1 Read Replicas + Vectorize) |

---

## 4. Contrato Nuclear de Ejecución y Perfil Camaleón (`@shac/kernel`)

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
  activeModules: string[]; // Encendidos/apagados en 0 ms como App Store en CONFIG_KV
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
    consolidateLowStockHours: number; // 24 para consolidación diaria, 0 para inmediato
    allowedSupplierDids: string[];
  };
  updatedAt: string;
}
```

---

## 5. Los 9 Presets Iniciales del App Store en `CONFIG_KV`

Cualquier cliente arranca con el preset de su industria principal y puede encender módulos adicionales de cualquier otro preset en cualquier momento sin migrar de servidor ni duplicar registros:

| Preset ID | Mercado Objetivo | Módulos Iniciales Encendidos | Vocabulario (`Party` / `Order` / `Space` / `Case`) |
| :--- | :--- | :--- | :--- |
| `retail-pos` | Minimarkets, farmacias, ferreterías, tiendas | `iam, customers, catalog, pos, regional, wms(lite)` | Cliente / Ticket de Venta / Tienda / Reclamo |
| `distro-wms` | Mayoristas, importadoras, distribuidoras, 3PL | `iam, customers, catalog, wms, regional, finance, portal` | Cuenta Mayorista / Orden de Despacho / CEDI / RMA |
| `tech-service` | Talleres técnicos, integradores IT, soporte | `iam, customers, catalog, pos, wms, services, portal` | Cliente / Orden de Servicio / Sede Técnica / Garantía RMA |
| `hospitality-pms` | Hoteles, posadas, resorts, apart-hoteles | `iam, customers, catalog, spaces, pos, services, portal, physical` | Huésped / Reserva & Folio / Habitación / Housekeeping |
| `property-condo` | Condominios, edificios en renta, centros comerciales | `iam, customers, spaces, leases, services, finance, portal, physical` | Residente-Inquilino / Estado de Cuenta / Unidad / Ticket Mant. |
| `clinic-practice` | Clínicas, consultorios, odontología, salud mental/ABA | `iam, customers, catalog, spaces, cases, services(evv), finance, portal, automation` | Paciente / Superbill-Consulta / Consultorio / Historia Clínica |
| `legal-psa` | Bufetes de abogados, contadores, agencias, consultoras | `iam, customers, spaces(agenda), cases, finance(iolta), portal, automation` | Representado / Minuta Honorarios / Despacho / Expediente |
| `industrial-gate` | Parques industriales, estacionamientos, clubes, flotas | `iam, customers, spaces(pases), services(evv), physical, automation` | Residente-Chofer / Pase de Acceso / Garita-Muelle / Incidente |
| `omni-enterprise` | Grupos empresariales híbridos multi-unidad | Todos los módulos habilitados o segmentados por `orgId` | Adaptativo según el `orgId` activo |

---

## 6. Plan Maestro de Construcción Incremental (8 Fases ODD / RDD)

| Fase | Alcance de Construcción (Iteraciones de 50–200 LOC) | Recibo Obligatorio de Verificación (RDD) |
| :--- | :--- | :--- |
| **Fase 1: Cimientos del Micro-Core y Shell `@shac/ui`** | Monorepo `pnpm`, `@shac/kernel` (`defineCommand`, WebCrypto + KV, PINs 4/6 dígitos, `moduleGate`, Hono RPC + `createMcpHandler`), `@shac/db-d1` (Dominio 1), `@shac/mod-iam` y base `@shac/ui` / `@shac/web-spa` (React 19 + Vite + TanStack) | Suite `@cloudflare/vitest-plugin` 100% verde; Worker `< 200 KiB gzip`; auth `< 1.5 ms` CPU; build estático Vite limpio |
| **Fase 2: Tronco Universal (`Parties`, Catálogo, `v_cf_*`) y `BranchInventoryDO`** | `@shac/mod-customers` (Dominio 2: `crm_parties`, Cédula/RIF, vínculos, pipelines), `@shac/mod-catalog` (Dominio 3: precios 5 capas, UOM, tasas BCV, habladores), `v_cf_*` + `FTS5` y las 8 tablas calientes de `BranchInventoryDO` (Dominio 4) | Ráfaga de 50 descuentos concurrentes sobre último lote en `BranchInventoryDO` con 0 sobregiros, orden **FEFO** exacto y `<= 2` queries D1 por listado |
| **Fase 3: POS Todo-Terreno, WMS Industrial y Packs Regionales** | `@shac/mod-pos`, `@shac/mod-regional` (`ve`/`co`/`mx`/`us`) y `@shac/mod-wms` (Dominios 5 y 6: sesión de caja, Cuenta=Moneda, botón `"Restante"`, Kiosco `SmartCheck`, GS1-128, AVCO/FIFO, *landed costs*, `-BACKORDER`, flota `e-POD`) + cola offline TanStack Query/IndexedDB | 20 ventas multimoneda desconectadas + 3 reintentos de reconexión con 0 duplicados en `hot_idempotency_log` |
| **Fase 4: Control Plane, App Store KV y Licencias Híbridas** | `editions/*`, `apps/control-plane`, aprovisionamiento 1 base D1 por cliente, telemetría de cuotas, licencias `HMAC` y encendido en `0 ms` de módulos desde `CONFIG_KV` | Encendido en vivo de nuevos mercados sobre un nodo `retail-pos` activo sin pérdida de datos ni reinicio |
| **Fase 5: Hub Federado B2B, Buffer 24h y Marketplace B2C** | `@shac/federation-sdk` (Ed25519), `apps/federation-hub`, buffer de consolidación de 24h, flujo `B2B_PO_SUBMITTED -> e-POD -> ASN` e índice global D1 Read Replicas + Vectorize | Integración extremo a extremo entre Nodo Tienda (D1 A) y Nodo Distribuidora (D1 B) generando ASN automático |
| **Fase 6: Espacios, Hotelería (PMS), Condominios y Agenda** | `@shac/mod-spaces` y `@shac/mod-leases` (Dominio 7: *Live Rack*, reservas OTA, Folio, *Housekeeping*, contratos `Lease` + *escrow*, *Autopay*, **Split Rent**, renovaciones y `Waitlist`) | Ráfaga de 30 reservas simultáneas contra la misma habitación/unidad en `hot_space_locks` con 0 dobles reservas |
| **Fase 7: Taller/RMA, Salud/EHR/ABA, Legal/IOLTA, Finanzas y Portal** | `@shac/mod-services` (**EVV**, RMA), `@shac/mod-cases` (`SOAP`, co-firma, terapias ABA, `matters`/`dockets`), `@shac/mod-finance` (**Trust/IOLTA**, GAAP), `@shac/mod-portal` y `@shac/mod-automation` (`InboxOps` + BPM) | Bloqueo de sobregiro en `Trust/IOLTA`, filtro SQL estricto `is_confidential = 0` en portal y aprobación humana de *Proposal Cards* |
| **Fase 8: Control Físico IoT, Cerraduras, Casilleros y Garitas LPR** | `@shac/mod-physical` (Dominio 12: PINs temporales al Check-In, casilleros QR, LPR `< 15 ms`, portero WhatsApp/Telegram y clips `SHA-256` en R2) + cierre de presupuesto global | Validación de pase en tiempo constante, alerta anti-sabotaje y binario completo All-in-One `< 1024 KiB gzip` |
