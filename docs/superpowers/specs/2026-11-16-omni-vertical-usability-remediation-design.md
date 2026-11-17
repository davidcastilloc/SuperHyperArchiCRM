# Diseño de Remediación Integral de Usabilidad & UI/UX Multi-Vertical (4 Olas)

**Fecha:** 2026-11-16  
**Estado:** Pendiente de revisión final del usuario tras `builder-check`  
**Documentos Compañeros:** `SPEC.md` (v2.2.0), `DATA_MODEL.md` (v2.2.0), `DESIGN.md` (v2.2.0), `AGENTS.md` (v2.2.0)

---

## 1. Intención y Por Qué

La auditoría forense híbrida sobre las **9 verticales canónicas** y **38 rutas** demostró que el motor transaccional de `SuperHyperArchiCRM` (`@shac/mod-*`, `@shac/actor-branch`, las `110` tablas/vistas SQLite en D1 y `BranchInventoryDO`) posee lógica de dominio real de producción, pero la capa `apps/web-spa` y varios *handlers* ligeros de `apps/node-worker` operan hoy como una fachada desconectada (`14/40` en heurísticas de Nielsen y `6/20` en auditoría técnica):

1. En una base limpia de Día 1 no existe flujo de inicialización (`/auth` responde `503 PROFILE_UNAVAILABLE` o deshabilita el login sin sucursales).
2. Al conmutar un preset en `/app-store`, `applyAppStoreToggle` une módulos sin apagar los de otras industrias ni actualizar el vocabulario, mientras `apps/web-spa/src/main.tsx` congela `DEFAULT_PROFILE.vocabulary` (`Cliente` / `Pedido`).
3. En viewports `< 1024px` (`360x800` móvil / colector WMS), el sidebar de 36 rutas se apila verticalmente (`1,745px`) encima del contenido; en `1024x768` (POS / Garita) el header colisiona iconos y `data-density="touch"` nunca se activa (`0%` de controles táctiles `>= 48px`); y las rutas públicas (`/f/$slug`, `/quote/$orderNumber`) exponen todo el shell interno del ERP.
4. Los flujos operativos Día 1 se cortan por IDs de semilla quemados (`pty_pat_1`, `pty_cli_1`, `acc_usd_cash`, `loc_bin_main`, `veh_cold`, `EXP-2026-01`), inputs sin `<label>` en centavos/micros/bps crudos, una tabla SQL inexistente (`wms_warehouses_and_locations`) y comandos reales de `@shac/mod-spaces` y `@shac/mod-leases` no conectados a la SPA.

El objetivo de este diseño es llevar las **9 verticales** a **Operación Real Día 1 + Demo Comercial Creíble** sin reescribir el motor D1/DO existente.

---

## 2. Metas, No-Metas, Anti-Metas y Restricciones

### Metas
- **Operabilidad Día 1 en Frío (9/9 Verticales):** Un operador puede inicializar una instancia limpia desde el navegador, crear sus maestros reales (sucursal, usuarios con PIN, terceros, catálogo/espacios/cuentas) y completar el ciclo nuclear de cualquiera de las 9 verticales sin tocar SQL ni encontrar IDs fijos.
- **Fidelidad Total a `DESIGN.md` v2.2.0:** Tipografía `Plus Jakarta Sans` + `JetBrains Mono` (`tabular-nums`), lienzo `#F6F7F9` (`#0C0E12` en `.dark`), tarjetas `#FFFFFF` (`#141820` en `.dark`), primario azul cobalto `#2563EB` (`#60A5FA` en `.dark`), verde cobro `#059669` (`#34D399` en `.dark`), `--radius: 0.5rem`, contraste WCAG AA (`>= 4.5:1`) y eliminación de gradientes neón decorativos.
- **Ergonomía Bimodal y Responsiva Real:** Cero desborde o apilamiento en `360x800` (drawer móvil superpuesto), layout `1024x768` sin colisión superior ni scroll global en POS, y `data-density="touch"` real (`48px` controles, `56px` teclados numéricos y botonera de garita).
- **Aislamiento Estricto por Vertical y Menor Carga Cognitiva:** Navegación agrupada en **5 Estaciones de Trabajo colapsables**, filtrando estrictamente cada industria a **8–12 ítems relevantes** con vocabulario camaleón reactivo en vivo (`useMarketVocabulary()`).

### No-Metas
- No agregar nuevos *bindings* de infraestructura fuera de `DB`, `BRANCH_DO`, `CONFIG_KV`, `SESSION_KV`, `R2` (opcional) y `AI` (opcional con *fallback* determinista).
- No rediseñar las 8 tablas calientes de `BranchInventoryDO` ni romper migraciones D1 previas.

### Anti-Metas (Fallo Automático aunque Compile)
- Prohibido cualquier *demo-theater*: logs simulados en cliente que no mutan el backend, porcentajes de tendencia quemados (`+100%` sobre `USD 0.00`), *badges* de índices SQL que no ejecutaron DDL o secretos QR/PIN descartados sin mostrarse.
- Prohibido exponer en formularios humanos centavos crudos (`basePriceMinor`), puntos básicos (`1500` bps), micro-tasas (`54750000`) o UUIDs/IDs internos en texto libre cuando corresponde un `<select>` o decimal humano.
- Prohibido exponer el sidebar o header interno del ERP en rutas anónimas o de autoatención (`/auth` sin sesión, `/kiosk/price-check`, `/f/$slug`, `/quote/$orderNumber`).

### Restricciones Físicas (`AGENTS.md`)
- Ningún archivo `.ts` o `.tsx` puede superar **300 líneas** (extraer submódulos cohesivos al llegar a `260` líneas).
- Cada sub-paso de implementación se acota a **50–200 líneas netas** y máximo **3 archivos de implementación + sus `.test.ts`**, verificado con `pnpm -r typecheck`, `pnpm dlx knip --strict` y `vitest run`.
- Worker completo `< 1024 KiB` gzip en `wrangler deploy --dry-run`; SPA dividida con `React.lazy` por ruta (`< 250 kB` en el chunk inicial).
- Migraciones D1 estrictamente aditivas (*Expand-Only*, cero `DROP TABLE` / `DROP COLUMN`) y cero rutas absolutas de sistema operativo.

---

## 3. Enfoques Evaluados y Decisiones Aprobadas

### Enfoques Considerados
1. **Plan Maestro en 4 Olas de Adentro hacia Afuera (Elegido):** Reparar primero en la Ola 1 las 4 piezas transversales que afectan a las 9 verticales al mismo tiempo (`Setup Día 1`, `Design System + AppShell móvil/táctil + ExternalPortalShell`, `Presets en modo replace + Estaciones de Trabajo + Vocabulario reactivo`), y luego conectar los flujos de dominio por familia en las Olas 2 (Comercio/POS/WMS/RMA), 3 (Clínica/Legal/Finanzas GAAP) y 4 (Hotelería/Condominio/Helios IoT/Custom Fields/Demo Real).
2. **Reparación Vertical por Vertical en Serie:** Arreglar Retail completo antes de tocar el Shell global o el conmutador de presets; descartado porque obligaría a rehacer layouts, navegación y vocabularios nueve veces.
3. **Parche Superficial Solo para Demo:** Arreglar únicamente el simulador y textos visibles dejando IDs quemados (`pty_pat_1`); descartado porque incumple la exigencia de **Operación Real Día 1 + Demo Comercial**.

### Decisiones Fijadas por el Usuario
1. **Alcance y Orden:** Ejecutar el **Plan Maestro en 4 Olas**, arrancando de inmediato por la **Ola 1**.
2. **Verdad Visual Oficial:** Hacer cumplir **`DESIGN.md` v2.2.0** (`Plus Jakarta Sans` + `JetBrains Mono`, azul cobalto `#2563EB`, lienzo `#F6F7F9` con tarjetas `#FFFFFF` en claro y `#0C0E12`/`#141820` en oscuro, cero gradientes neón).
3. **Arquitectura de Navegación:** Agrupar el menú en **Estaciones de Trabajo colapsables** y filtrar estrictamente cada preset vertical para mostrar **máximo 8–12 ítems relevantes por industria**.

---

## 4. Especificación Técnica Detallada por Ola

### Ola 1: Cimientos Globales, Onboarding Día 1, Shell `DESIGN.md` y Aislamiento de las 9 Verticales

#### 1.1 Onboarding Día 1 (`/setup` en Frío), Frontera `orgPath` e IAM Completo
- **Estado Bootstrap Seguro (`GET /api/auth/bootstrap` en `apps/node-worker/src/auth-routes.ts`):**
  - Consulta primero `SELECT COUNT(*) FROM iam_users`:
    - Si `iam_users === 0`, **no falla con `503`** aunque `CONFIG_KV` esté vacío; devuelve `{ needsSetup: true, hasProvisionedProfile: Boolean(existingProfile), catalog }` con los 9 presets y 5 `regionPacks`.
    - Si `iam_users > 0` y `profile:current` falta o está corrupto en `CONFIG_KV`, **falla cerrado con `503 PROFILE_UNAVAILABLE`** (preservando la invariante de `worker.integration.test.ts` y evitando bloqueos `needsSetup -> 409`).
- **Inicializador Atómico (`POST /api/auth/setup`):**
  - Habilitado **únicamente** cuando `iam_users` tiene `0` filas (bloquea con `409 ALREADY_INITIALIZED` tras el primer uso).
  - Si `CONFIG_KV` ya contiene un `profile:current` aprovisionado por `@shac/control-plane`, **preserva** `tenantId`, `deploymentId`, `federation` y `entitlements` contractuales existentes; solo construye `profile:current` desde cero cuando `CONFIG_KV` está vacío (despliegue local / BYOC autogestionado).
  - En una sola operación idempotente: asegura `profile:current`, inserta `iam_tenants`, `iam_organizations` (`/org_1`), `iam_users` (hash WebCrypto PBKDF2 + `floor_pin_hash`), la tasa inicial en `cat_exchange_rates` (si aplica al `regionPack`), las cuentas base de caja/banco en `fin_accounts` + `fin_chart_of_accounts_and_periods` para cada moneda operativa (`USD`, `VES`, `COP`, `MXN`, `EUR`), y emite sesión interactiva inmediata.
- **Frontera `orgPath` en Login y Cambio de Sucursal (`POST /api/auth/switch-branch`):**
  - En cumplimiento de `AGENTS.md` §5.1, `defaultOrgId` define la raíz autorizada `userRootPath` del operador: `POST /api/auth/login`, `POST /api/auth/pin` y `POST /api/auth/switch-branch` (usado por el *popover* de sucursal del header) verifican que la sucursal destino pertenezca al subárbol `userRootPath` (salvo que `perms` incluya `'*'` o `preferences_json.allowedOrgIds` autorice explícitamente esa sede).
- **Administración IAM Real (`IamAdminView.tsx` + `iam-admin-routes.ts`):**
  - Agregar en `IamAdminView.tsx`: selector de sucursal raíz (`defaultOrgId`), campo opcional `PIN Piso (4 dígitos)`, selector de rol/permisos predefinidos (Cajero, Almacenista, Médico, Abogado, Recepción, Guardia, Administrador — eliminando el `perms: ['*']` silencioso por defecto) y botón `"Emitir PIN Delegación (6 dígitos)"` conectado a `POST /api/iam/delegation/pins` mostrando el PIN generado en modal copiable.
  - En `iam-admin-routes.ts`, actualizar `ON CONFLICT DO UPDATE` para rotar `password_hash_webcrypto` y `floor_pin_hash` cuando se provean.

#### 1.2 Sistema Visual `DESIGN.md` v2.2.0, `ShacAppShell` Responsivo/Táctil y `<ExternalPortalShell>`
- **Tokens y Fuentes (`apps/web-spa/index.html` y `packages/ui/src/styles/globals.css`):**
  - Cargar `Plus Jakarta Sans` (`400;500;600;700`) y `JetBrains Mono` (`400;500;600;700`) en `index.html`.
  - Reemplazar en `globals.css` la paleta neutra/neón de Open Mercato por los tokens exactos de `DESIGN.md` §2 y §5 (`--radius: 0.5rem`, `--background: #f6f7f9` / `.dark #0c0e12`, `--card: #ffffff` / `.dark #141820`, `--popover: #ffffff` / `.dark #1c222d`, `--muted: #eceef2` / `.dark #0f131a`, `--muted-foreground: #475569` / `.dark #94a3b8` con contraste `>= 4.6:1` incluyendo placeholders, `--primary: #2563eb` / `.dark #60a5fa`, `--checkout: #059669` / `.dark #34d399`), eliminando el emblema degradado lima-amarillo-violeta en `ShacSidebar.tsx` por un isotipo industrial sólido en `--primary`.
  - Agregar `@media print` en `globals.css` que oculte `[data-slot="app-shell-sidebar"]` y `[data-slot="app-shell-header"]`, y ocultar scrollbars nativos feos en `SegmentedTabs` (`scrollbar-none` con fade horizontal limpio).
- **Layout Responsivo y Densidad Bimodal (`ShacAppShell.tsx`, `ShacSidebar.tsx`, `main.tsx`):**
  - **Móvil y Tablet (`< 1024px`):** `sidebarOpen` inicia en `false`; al abrirse, `ShacSidebar` renderiza como *drawer* fijo superpuesto (`fixed inset-y-0 left-0 z-50 w-72`) sobre `backdrop` oscuro, cerrándose automáticamente al navegar, tocar fuera o pulsar `Escape`.
  - **Escritorio (`>= 1024px`):** Contenedor raíz `h-screen overflow-hidden`; el botón lateral alterna entre `240px` expandido y riel compacto de iconos de `64px` (`DESIGN.md` §4) sin desmontar la navegación.
  - **Header `56px` sin colisiones (`360px` y `1024x768`):** Selector de sucursal cambia de sucursal activa en sesión (*popover* inline, sin expulsar a `/auth`), unificar en un solo botón el asistente `Chat IA` y dejar `⌘K` claramente como buscador rápido (`Ir a... ⌘K`), y compactar `SyncStatusPill` (`whitespace-nowrap`, escuchando `navigator.onLine` + cola offline real).
  - **Densidad Táctil (`data-density="touch"`):** En `main.tsx`, activar automáticamente `density="touch"` en `/pos`, `/kiosk/price-check`, `/physical` y `/auth` (con persistencia de tema en `localStorage`, iniciando `/physical` en `dark` si el usuario no eligió tema previo). Aplicar variantes `touch:min-h-12` (`48px`) en botones/inputs/tabs y `min-h-14` (`56px`) en `PosVirtualKeypad` (agregando botón `C` Limpiar y sobrescritura al primer toque sobre monto pre-llenado).
- **Separación de Superficies Externas y Modo Kiosco Bloqueado (`<ExternalPortalShell>`):**
  - **Rutas públicas anónimas (`/f/$slug`, `/quote/$orderNumber` y `/auth` sin sesión):** Renderizan dentro de `<ExternalPortalShell>` libre de sidebar/header ERP y sin disparar WebSockets internos.
  - **Modo Kiosco Bloqueado en Pasillo (`/kiosk/price-check`):** Mantiene sesión autenticada de staff (`pos.kiosk.read`, preservando `phase3.worker.test.ts` y evitando exponer precios públicos a internet), pero renderiza dentro de `<ExternalPortalShell>` sin sidebar ERP, elimina la consulta que exponía `costPriceMinor`, activa `useGlobalBarcodeHid` + `autoFocus` y exige verificar un PIN de piso de 4 dígitos (`POST /api/auth/pin`) al pulsar `"Salir Kiosco (PIN)"` para volver a `/pos`.
  - Reparar `FormsBuilderView.tsx` y `PublicFormAndQuoteView.tsx`: serializar `FormFieldSpec[]` (`{ name, label, type, required }`) con retrocompatibilidad si llega `string[]`, resolver `tenantId` dinámicamente desde query/bootstrap (eliminando `'ten_1'` quemado), agregar botón `"Copiar enlace público"` en `/forms` y `/quotes`, y bloquear doble decisión sobre cotizaciones ya cerradas.
  - Dividir las 36 vistas en `main.tsx` con `React.lazy` + `<Suspense>` (`Skeleton` limpio) para cumplir el *code-splitting* por pantalla.

#### 1.3 Aislamiento Real de Presets, 5 Estaciones de Trabajo (`8–12` ítems) y Vocabulario Reactivo
- **`presetMode` en `@shac/editions` (`editions/presets/src/app-store-merger.ts` y `presets-catalog.ts`):**
  - Extender `AppStoreToggleSchema` con `presetMode: z.enum(['merge', 'replace']).default('merge')`.
  - Cuando `presetMode === 'merge'` (por defecto programático), mantiene el comportamiento actual para 100% de compatibilidad con `editions.test.ts`.
  - Cuando `presetMode === 'replace'` (usado por clic de tarjeta en `AppStoreView.tsx` y cambio de Persona en `DemoAndSopCenterView.tsx`, con switch opcional `"Fusionar con módulos actuales"` en `AppStoreView`), reemplaza `activeModules` exactamente por `preset.activeModules`, aplica `preset.vocabulary` (+ `vocabularyOverride` si existe) y `preset.entitlements`.
  - Corregir tildes faltantes en `presets-catalog.ts` (`Huésped`, `Huéspedes`, `Habitación`, `Órdenes`, `Sede Técnica`, `Sede Clínica`, `Operación`) y habilitar `'finance'` en `hospitality-pms` y `'services'` en `distro-wms` / `retail-pos` para soporte de RMA.
- **5 Estaciones de Trabajo Colapsables y Matriz de Visibilidad (`apps/web-spa/src/nav.ts`):**
  - Reemplazar `NAV_ITEMS` estático por `buildNavItems(profile)` agrupado en **5 Estaciones**: `1. Estación Principal`, `2. Directorio & Comercial`, `3. Catálogo & Logística`, `4. Finanzas & Equipo`, `5. Plataforma`.
  - Cada `ShacNavItem` declara `moduleId` + `allowedPresets?: readonly EditionPresetId[]` para garantizar **8–12 ítems visibles** en cada uno de los 8 presets verticales especializados (y grupos secundarios colapsados por defecto en `omni-enterprise`):
    - `retail-pos` (10 ítems): Dashboard, POS, SmartCheck, Órdenes, Cotizaciones, Clientes, Productos/Tarifas, Categorías/Promos, WMS Stock, Garantías/Reclamos, Finanzas Caja (si activo) / Ajustes.
    - `distro-wms` (11 ítems): Dashboard, Órdenes de Despacho (`/orders`), Cotizaciones B2B (`/quotes`), WMS Operaciones, Ubicaciones & ASNs, Etiquetas & Flota, Cuentas Mayoristas, Productos/Tarifas, RMA (`/claims`), Finanzas, Portal B2B (con EUDR opcional bajo toggle de cumplimiento).
    - `tech-service` (10 ítems): Dashboard, Órdenes Técnicas & RMA (`/claims`), POS Caja, Cotizaciones, Clientes, Repuestos (`/catalog`), WMS Stock, Proyectos/Agenda, Portal Cliente.
    - `hospitality-pms` (10 ítems): Dashboard, Rack PMS & Reservas (`/spaces`), POS Punto de Consumo, Huéspedes (`/parties`), Tarifas & Servicios (`/catalog`), Solicitudes/Mantenimiento (`/claims`), Garita/Accesos (`/physical`), Finanzas/Folio, Portal Huésped.
    - `property-condo` (10 ítems): Dashboard, Condominio, Unidades & Leases (`/leases`), Residentes-Inquilinos (`/parties`), Tickets Mantenimiento (`/claims`), Garita & Pases QR (`/physical`), Finanzas & Cuotas (`/finance`), Formularios/Portal (`/portal`, `/forms`). *(Nunca muestra Rack Hotelero ni POS).*
    - `clinic-practice` (10 ítems): Dashboard, Clínica EHR & AI Scribe (`/clinical-ehr`), Agenda & Consultorios (`/tasks`), Pacientes (`/parties`), Aranceles & Insumos (`/catalog`), Servicios/Terapias (`/claims`), Finanzas & Seguros (`/finance`), Portal Paciente (`/portal`, `/forms`). *(Nunca muestra Legal IOLTA ni Hotel).*
    - `legal-psa` (10 ítems): Dashboard, Suite Legal, Dockets & IOLTA (`/legal-hub`), Representados & Conflictos (`/parties`), Agenda & Plazos (`/tasks`), Proyectos PSA (`/projects`), Staff & Horas (`/staff`), Finanzas Trust/GAAP (`/finance`), Portal Cliente (`/portal`, `/forms`). *(Nunca muestra Clínica EHR ni Hotel; `/cases` legado se retira del menú y redirige según preset).*
    - `industrial-gate` (8 ítems): Consola Garita Helios (`/physical`), Pases & Residentes-Choferes (`/parties`), Muelles/Zonas (`/spaces` vista industrial), Incidentes (`/claims`), Reglas IoT (`/automation`), Dashboard.
  - Autorizar `/api/pos/orders` y `/api/pos/quotes` cuando el perfil tenga cualquiera de `pos | wms | catalog`, y autorizar `/api/automation/ai-chat` por `profile.entitlements.aiCopilotEnabled` en lugar de exigir `moduleId: 'automation'`.
- **Contexto Camaleón Reactivo (`useMarketProfile()` / `useMarketVocabulary()`):**
  - Proveer `activeProfile` desde `RootLayout` vía contexto React a las 38 rutas, actualizar `DashboardView.tsx` para mostrar el CTA primario y KPIs propios del preset activo (y corregir `TimeSeriesChart.tsx` para no sumar conteos + dólares en la misma escala).

---

### Ola 2: Comercio, POS Táctil `1024x768`, WMS FEFO `360px` & Taller RMA (`retail-pos`, `distro-wms`, `tech-service`)

1. **Checkout POS Día 1 Cero Fallos y Estado Persistente (`PosView`, `PosReceiptPanel`, `PosTenderModal`, `PosCashClosingModal`, `PosProModals`):**
   - Persistir `shiftId`, `registerId` y `cart` en `sessionStorage` + hidratar turno abierto activo al montar `/pos`; permitir declarar fondo inicial en USD/moneda local al abrir caja.
   - Cargar cuentas reales de caja/banco (`GET /api/finance/accounts` o endpoint ligero `/api/pos/accounts`) y tasa activa de D1 en `PosView`; enviar `manualDiscountBps`, `exchangeRateMicros` y el `methodCode` real (`USD_CASH`, `ZELLE`, `POS_DEBIT`, `VES_PAGO_MOVIL`) en `usePosShiftAndCheckout.ts`.
   - Mantener abiertos los modales de cobro y cierre hasta `onSuccess`; al cerrar turno mostrar el reporte Z de arqueo ciego (`esperado` vs `contado` vs `diferencia`) con opción de impresión térmica ESC/POS; conectar el relevo de cajero por PIN a `POST /api/auth/pin`; pedir confirmación antes de pisar un carrito activo al recuperar una orden `Leylan`.
   - Layout POS `1024x768` bloqueado a `h-[calc(100vh-3.5rem)] overflow-hidden` con grilla `62% / 38%`, `ScrollArea` independiente en catálogo y líneas de carrito, controles de línea de `48px`, Gran Total en `text-4xl font-mono tabular-nums`, búsqueda servidor FTS5 + variantes/GTIN sin tope fijo de 50 SKUs, campo de cupón promocional, y mapa único de teclas seguras (`F2` Buscar, `F4` Cantidad, `F8` Modal Espera/Cliente sin `window.prompt`, `F9` Descuento, `F10` Cobrar) + `Escape` en todos los modales.
   - Conectar `useGlobalBarcodeHid` y `autoFocus` en `SmartCheckKioskView.tsx`.
2. **Catálogo, Precios Decimales, Cotizaciones con Líneas y Conversión a Orden:**
   - Convertir todos los inputs de `CatalogView`, `CatalogStructureView`, `PromotionsView` y `ClaimsAndServicesView` a unidades humanas decimales (`$0.00`, `%`, tasa `54.75`) con `<label>` explícito y selector de `categoryId` en productos.
   - Agregar líneas de producto a `QuotesView` y `SalesOrdersView` con acción de 1 clic `"Convertir Cotización -> Orden"` y `"Enviar a Picking WMS / POS"`.
3. **WMS Real sin SQL `500`, FEFO `LotBadge` y Flota `e-POD` (`WmsLocationsView`, `WmsView`, `LabelsAndFleetView`):**
   - Reparar `GET/POST /api/wms/locations` en `apps/node-worker/src/catalog-ext-routes.ts` apuntando a las tablas reales `wms_warehouses_and_zones` y `wms_locations`, y agregar `GET/POST /api/wms/vehicles` (`record_kind = 'vehicle'` en `wms_fleet_and_deliveries`).
   - Dividir `WmsView` en pestañas de foco único aptas para colector `360px` (`1. Recibir Lote FEFO` con fecha de vencimiento y `<select>` de Bin, `2. Inventario & Semáforo LotBadge`, `3. Picking Doble Partida` desde `<select>` de ubicaciones/órdenes, `4. Despacho & Firma Canvas e-POD`) con `useGlobalBarcodeHid` activo.
4. **Ciclo Completo de Taller & Garantías RMA (`ClaimsAndServicesView.tsx`):**
   - Conectar el stepper de RMA al `status` real del registro y agregar botones de transición (`Aprobar`, `Recibir Equipo`, `Consumir Repuesto`, `Cerrar / Enviar Cargo a POS`).

---

### Ola 3: Práctica Profesional & Finanzas Fiduciarias (`clinic-practice`, `legal-psa`)

1. **Estación Clínica Centrada en el Paciente (`ClinicalEhrView`, `ClinicalAiScribeModal`, `clinical-ehr-routes.ts`):**
   - Incorporar barra superior `<ActivePatientSelector />` (filtrando `crm_parties` con rol `patient` + botón rápido `"+ Nuevo Paciente"` modal) que alimenta `patientPartyId` y `encounterId` reales en Signos Vitales, AI Scribe, Recetas eRx, Órdenes de Laboratorio y Reclamos RCM (cero `'pty_pat_1'`).
   - Formatear `vitals_json` como insignias clínicas legibles (`PA`, `FC`, `Temp`, `SpO2`), parsear con validación JSON la salida de AI Scribe guardando la nota en estado `'DRAFT'` con acción médica `"Revisar, Editar y Firmar"`, agregar el formulario faltante en la pestaña `Lab & Imagen` (`kind: 'lab_order'`), y permitir elegir códigos CIE-10 reales mostrando alertas del *scrubber* RCM.
2. **Estación Legal Centrada en el Expediente & Chequeo Real de Conflictos (`LegalPracticeView`, `LegalEdiscoveryAndEthicsPanel`, `legal-practice-routes.ts`):**
   - Reparar el chequeo de conflictos en `legal-practice-routes.ts` para buscar sobre `display_name`, `legal_name` y `tax_id_number` y registrar auditoría en `crm_conflict_checks`.
   - Agregar selector real de `Representado` al abrir expediente (con numeración autogenerada sugerida `EXP-YYYY-NNN` que se limpia/incrementa al guardar) y barra `<ActiveMatterSelector />` que vincula Cronómetro, Dockets, Trust IOLTA, e-Discovery Bates y Escritos IA al expediente real (cero `'pty_cli_1'` ni `'EXP-2026-01'` fijos).
   - Persistir el cronómetro facturable en `localStorage` (visible en cabecera aunque el abogado navegue a otra vista, con botón `Reiniciar` sin facturar y tarifa editable), agregar formulario de creación de `Dockets` y plazos fatales, y calcular dinámicamente el estado `CLE` (`COMPLIANT` vs `PENDIENTE`).
3. **Finanzas GAAP Reales, Cuentas por Pagar y Custodia Trust/Escrow (`FinanceView`, `FinanceApAndReconPanel`, `finance-gaap-routes.ts`):**
   - Unificar todos los montos de `FinanceView` en dólares/moneda mayor decimal (`parseMajorToMinor`), renderizar la tabla de cuentas `trustLedgers` existentes con acciones `"Depositar"` / `"Desembolsar"` (adaptando etiqueta a `Trust IOLTA` en Legal vs `Depósitos en Garantía / Escrow` en Condominio/Distribución).
   - Reemplazar el input fijo de asiento diario por un constructor multilínea real (`Cuenta COA` + `Débito` + `Crédito` con indicador vivo `∑ Débito = ∑ Crédito`), actualizar `current_balance_minor` transaccionalmente al contabilizar asientos (impidiendo sobrescritura manual arbitraria de saldos y agregando fila de sumas iguales al pie del Balance de Comprobación).
   - Agregar `<select>` de Proveedor (`vendorPartyId`) y `dueDate` en `Cuentas por Pagar`, vincular `Conciliación Bancaria` a cuentas reales con saldo en libros automático, y aplicar filtro jerárquico `org_id` / `orgPath` e idempotencia `clientMutationId` en las rutas de Fase 7.

---

### Ola 4: Hotelería PMS, Condominios, Garita Helios IoT & Plataforma Viva (`hospitality-pms`, `property-condo`, `industrial-gate`, `omni-enterprise`)

1. **Hotelería PMS Operativa (`HospitalityPmsView.tsx` + `hospitality-condo-routes.ts`):**
   - Agregar endpoint y modal `"Nueva Habitación / Espacio"` (`spc_unit_types` + `spc_units` filtrado por `org_id`), conectar `HospitalityPmsView` a `GET /api/spaces/rack` (mostrando `ADR`, `RevPAR` y `% Ocupación`), y cablear los modales de `"Nueva Reserva / Quick Check-In"` (`spaces.bookings.reserve` + `transition: CHECK_IN`), `"Cargos y Liquidación de Folio"` + `"Check-Out"` (`transition: CHECK_OUT` validando saldo `0`), corrigiendo Housekeeping para que `"Sucia"` cree tarea `PENDING` y `"Limpia"` complete la tarea.
2. **Condominios, Unidades & Calculadora *Split Rent* (`CondoResidentHubView.tsx`):**
   - Reemplazar el `fetch` crudo en `voteMutation` por el cliente autenticado `rpc` (`Bearer` token + control de voto único por unidad) y habilitar publicación de `Comunicados Vecinales` (`announcement`).
   - Agregar creación/selección real de `Unidad` (`spc_units`), modal de activación/renovación de contratos conectado a `POST /api/leases/contracts/activate` con **Calculadora interactiva Split Rent** (`computeSplitRentShares` sumando `100.00%` / `10,000 bps` entre co-inquilinos) y selector de `unitId` en órdenes de mantenimiento.
3. **Consola Táctil de Garita Helios (`HeliosSecurityView.tsx` + `physical-helios-routes.ts`):**
   - Botonera táctil `56px` en modo `.dark` con acción **`Pulso 5s`** (apertura temporal con re-bloqueo visual) y botón rojo de emergencia **`Lockdown`** (cierre simultáneo de perímetro), preservando `battery_pct` real en D1 al conmutar cerraduras y moviendo `"Registrar Dispositivo"` a un modal secundario.
   - Al emitir un pase de visitante (desde Garita o Condominio), mostrar modal con el código **PIN en `text-3xl font-mono` + código QR/Barras renderizado + botón `"Compartir por WhatsApp"`**, listar pases activos y conectar validación manual de pase (`POST /api/physical/passes/validate`) y lectura manual de placa LPR (`POST /api/physical/lpr/scan`).
4. **Campos Custom `v_cf_*` Vivos y Simulador Demo Honesto (`CustomFieldsView`, `DemoAndSopCenterView`):**
   - Ejecutar de forma segura y validada (identificadores sanitizados `^[a-z][a-z0-9_]{1,40}$`, solo `ADD COLUMN` aditivo) el `alterSql` / `indexSql` en `custom-fields-routes.ts`, y montar un componente reutilizable `<CustomFieldsSection entityType="..." />` dentro de `PartiesView` y `CatalogView`.
   - Conectar `"Ejecutar Paso"` en `DemoAndSopCenterView.tsx` a llamadas reales contra `rpcClient` (creando los datos reales de demostración en D1/DO y mostrando recibo real) y hacer que `"Entrar como [Persona]"` invoque primero `app-store/toggle` con `presetMode: 'replace'` antes de navegar.

---

## 5. Decisiones Menores Delegadas al Implementador (*Builder Calls*)

- **Estructura interna de subcomponentes (cota `<= 300` LOC):** Donde una vista supere `260` líneas al incorporar modales o selectores, dividir en archivos hermanos cohesivos (`*Modal.tsx`, `*Tab.tsx`, `use*State.ts`) dentro de `apps/web-spa/src/views/` o `packages/ui/src/components/`.
- **Generación de QR sin dependencias pesadas:** Renderizar un código matriz SVG determinista ligero en `@shac/ui` junto al PIN alfanumérico de 8 caracteres y `<BarcodeSvg />` para mantener `0` dependencias externas pesadas.
- **Persistencia local de estado efímero de turno/cronómetro:** Usar claves con namespace por `tenantId + orgId` en `sessionStorage` / `localStorage` (`shac.pos.activeShift.<tenant>.<org>`, `shac.legal.timer.<tenant>.<org>`) para evitar colisiones entre sucursales.
- **Tres decisiones técnicas cerradas tras `builder-check` (*Builder Calls*):**
  1. **`SmartCheck` (`/kiosk/price-check`) opera como Modo Kiosco Bloqueado con sesión de piso:** un operador inicia sesión (o PIN) y lanza el kiosco dentro de `<ExternalPortalShell>` sin chrome ERP ni datos de costo (`costPriceMinor`), requiriendo PIN de 4 dígitos para desbloquear y salir a `/pos`.
  2. **Respeto a aprovisionamiento del Control Plane en `/setup` y *fail-closed* post-setup:** `needsSetup: true` solo ocurre cuando `iam_users === 0` (si ya hay usuarios y falta `profile:current`, mantiene `503 PROFILE_UNAVAILABLE`); si `profile:current` ya fue inyectado por Control Plane, `/setup` conserva `tenantId`, `deploymentId`, `federation` y `entitlements`.
  3. **Techo jerárquico `orgPath` en selector de sucursal:** `defaultOrgId` actúa como techo de autorización de subárbol (`AGENTS.md` §5.1) tanto en login/PIN como en el cambio inline de sucursal (`POST /api/auth/switch-branch`), impidiendo que un cajero o guardia asignado a una sede hija escale a `Casa Matriz`.
