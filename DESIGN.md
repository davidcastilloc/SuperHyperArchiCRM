# DESIGN.md — Design System de SuperHyperArchiCRM

**Versión:** 2.2.0  
**Documentos Compañeros:** `SPEC.md` (v2.2.0), `DATA_MODEL.md` (v2.2.0) y `AGENTS.md` (v2.2.0)  
**Herramientas de Destino:** [Google Stitch](https://www.therundown.ai/tools/stitch) ([Stitch Agent Skills](https://github.com/google-labs-code/stitch-skills)), Google Antigravity 2.0, `@shac/ui` (`packages/ui`) y `apps/web-spa`  
**Stack Frontend:** **React 19 + [Vite (@cloudflare/vite-plugin)](https://developers.cloudflare.com/workers/vite-plugin/tutorial/) + [TanStack Router](https://tanstack.com/router/latest/docs/overview) + [TanStack Query (offlineFirst)](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode) + [Tailwind CSS v4 (@theme inline) + shadcn/ui (new-york)](https://ui.shadcn.com/docs/tailwind-v4)** reutilizando primitivas MIT de `@open-mercato/ui`

---

## 1. Dirección Visual y Concepto

- **Estética y tono:** *Precisión Industrial Táctil* (*Industrial Tactile Precision*). Combina la claridad inmediata libre de ruido de una caja registradora moderna con la densidad estructurada de los componentes `shadcn/ui` (`new-york` style sobre primitivas Radix UI), evitando degradados decorativos, sombras difusas excesivas o tarjetas infladas (*Propuesta base - validar en Stitch*).
- **Modo de color:** `Adaptativo` controlado por clase `.dark` / `data-theme="dark"` compatible de serie con `shadcn/ui`:
  - `Light` (Predeterminado en mostradores POS iluminados, consultorios y pisos de recepción WMS con luz cenital intensa).
  - `Dark` (Optimizado para turnos nocturnos, garitas de seguridad LPR, monitoreo continuo del Control Plane y ahorro de batería en tablets o colectores de mano).
- **Plataforma y densidad bimodal (`data-density`):** Una misma SPA en React 19 + Vite responde a dos ergonomías físicas distintas según el módulo activo:
  - **Modo Táctil (`data-density="touch"`, POS, Kiosco `SmartCheck`, Colector Móvil WMS y Consola de Garita):** Botones `shadcn/ui` con variante de tamaño `size="touch"` (`min-h-12` / `48x48px`, `56px` en teclado numérico, apertura de portón y cierre de venta), lectura a brazo extendido (`60–80 cm`) y operación híbrida dedo + lector de barras HID + teclas `F1–F12`.
  - **Modo Operativo Denso (`data-density="compact"`, Consola WMS, CRM, PMS Hotelero, Condominios, Estación Clínica/Legal, Servicios Técnicos, Control Plane y Hub B2B):** Basado en `DataTable` (`@tanstack/react-table`) y `CrudForm` portados de `@open-mercato/ui` con filas de `36px`, cabeceras fijas, paneles divididos maestro-detalle y paleta rápida `Command` (`cmdk`, `Cmd/Ctrl + K`).

---

## 2. Tokens de Color

Valores deterministas de alto contraste (WCAG AA/AAA) mapeados directamente a las variables semánticas de `shadcn/ui` y listos para Google Stitch:

| Token Semántico (`shadcn/ui` + Dominio) | Rol en POS, WMS, Verticales y Control Plane | Modo Claro (`:root`) | Modo Oscuro (`.dark`) |
| :--- | :--- | :--- | :--- |
| `--background` | Lienzo base de aplicación detrás de paneles | `#F6F7F9` | `#0C0E12` |
| `--card` / `--surface` | Tarjetas `Card`, `DataTable` WMS, *Room Rack* y grilla POS | `#FFFFFF` | `#141820` |
| `--popover` / `--surface-elevated` | Ticket activo POS, `Dialog`/`Sheet` de arqueo y cajón `AiChat` MCP | `#FFFFFF` | `#1C222D` |
| `--muted` | Fondos de `Input`, `TabsList`, barras de filtro y filas alternas | `#ECEEF2` | `#0F131A` |
| `--border` / `--input` | Divisores estructurales `1px` y bordes de controles Radix | `#E2E8F0` | `#262E3D` |
| `--foreground` | Títulos, nombres de producto/tercero y montos monetarios | `#0F172A` | `#F1F5F9` |
| `--muted-foreground` | Etiquetas `Label`, metadatos de sucursal y cabeceras `TableHead` | `#475569` | `#94A3B8` |
| `--primary` (`accent-primary`) | Navegación activa, anillo `--ring` de escáner y CTA WMS/CRM | `#2563EB` | `#60A5FA` |
| `--checkout` (`accent-checkout`) | Acción primaria de cobro POS (`Cobrar / Emitir Ticket`) | `#059669` | `#34D399` |
| `--status-success` | Nodo en línea, habitación libre, lote vigente (> 90 días) | `#059669` (`#ECFDF5`) | `#34D399` (`#062E22`) |
| `--status-warning` | POS Offline con cola en TanStack Query, lote FEFO (< 30 días), cuota D1 > 75% | `#D97706` (`#FFFBEB`) | `#FBBF24` (`#332107`) |
| `--destructive` / `--status-error` | Sin stock, lote vencido/cuarentena, plazo fatal vencido, descuadre de caja | `#DC2626` (`#FEF2F2`) | `#F87171` (`#381012`) |
| `--status-federation` | Ofertas del Hub Federado B2B, nodos verificados `did:shac:*` y *Proposal Cards* IA | `#4F46E5` (`#EEF2FF`) | `#818CF8` (`#1E1B4B`) |

---

## 3. Tipografía y Escala

- **Fuente UI principal:** `'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif`.
- **Fuente datos / SKUs / moneda / lotes / expedientes:** `'JetBrains Mono', ui-monospace, SFMono-Regular, monospace` aplicando obligatoriamente `tabular-nums` (`font-variant-numeric: tabular-nums`) en precios (`basePriceMinor`), tasas cambiarias, cantidades de *bins*, conteos regresivos FEFO, números de serie, placas vehiculares y relojes de turno.
- **Escala tipográfica estricta:**
  - `12px / 16px` (`text-xs`): `Badge` de estado, atajos `F1–F12`, códigos `ZONA-PASILLO-BIN` y fechas de lote.
  - `14px / 20px` (`text-sm`): Cuerpo estándar en `DataTable`, `CrudForm`, expedientes clínicos/legales y órdenes técnicas.
  - `16px / 24px` (`text-base`): Cuerpo táctil en tarjetas POS y líneas del carrito de mostrador.
  - `20px / 28px` (`text-xl`): Títulos de vista activa, `DialogTitle` de pago y KPIs secundarios.
  - `28px / 34px` (`text-2xl`, semibold): Subtotales, cambio a entregar en caja y contadores de recepción ASN.
  - `36px / 40px` (`text-4xl`, bold monoespaciado): **Gran Total a Cobrar** en el panel derecho del POS y precio principal en Kiosco `SmartCheck`.

---

## 4. Geometría, Layout y Espaciado

- **Unidad base de espaciado:** Múltiplos estrictos de `4px` (`4px`, `8px`, `12px`, `16px`, `24px`).
- **Radio de bordes (`--radius: 0.5rem`):** `6px` (`rounded-sm`) en insignias; `8px` (`rounded-md`) en controles densos; `12px` (`rounded-xl`) en tarjetas táctiles y `Card`; `16px` (`rounded-2xl`) en `Dialog` y `Sheet`.
- **Breakpoints responsivos y superficies objetivo:**
  - `360px – 639px` (Colector portátil Android WMS / App móvil EVV y e-POD): Una sola columna vertical centrada en tarea única (*Scan -> Confirm -> Next*).
  - `640px – 1023px` (Tablet vertical / Kiosco `SmartCheck`): Carrito POS en `Drawer` inferior o visor de precios autoatendido con autocierre en 10s.
  - `1024px – 1279px` (Terminal táctil POS `1024x768` / Tablet de Garita LPR): División fija **62% Catálogo + Buscador FTS5** a la izquierda y **38% Ticket Activo + Cobro** a la derecha con `ScrollArea` independiente.
  - `1280px+` (Escritorio WMS, PMS, Clínica, Bufete, Control Plane y Hub B2B): `Sidebar` de `shadcn/ui` colapsable (`240px` / `64px`), cabecera contextual (`56px`) y `Sheet` de inspección (`420px`).

---

## 5. Integración en React 19, Vite, Tailwind CSS v4 y `shadcn/ui`

Todos los tokens viven en `packages/ui/src/styles/globals.css` usando `@theme inline` y `tw-animate-css`:

```css
/* packages/ui/src/styles/globals.css */
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));
@custom-variant touch (&:where([data-density="touch"], [data-density="touch"] *));

:root {
  --radius: 0.5rem;
  --background: #f6f7f9;
  --foreground: #0f172a;
  --card: #ffffff;
  --card-foreground: #0f172a;
  --popover: #ffffff;
  --popover-foreground: #0f172a;
  --primary: #2563eb;
  --primary-foreground: #ffffff;
  --muted: #eceef2;
  --muted-foreground: #475569;
  --destructive: #dc2626;
  --border: #e2e8f0;
  --input: #e2e8f0;
  --ring: #2563eb;
  --checkout: #059669;
  --checkout-foreground: #ffffff;
  --status-success: #059669;
  --status-warning: #d97706;
  --status-error: #dc2626;
  --status-federation: #4f46e5;
}

.dark {
  --background: #0c0e12;
  --foreground: #f1f5f9;
  --card: #141820;
  --card-foreground: #f1f5f9;
  --popover: #1c222d;
  --popover-foreground: #f1f5f9;
  --primary: #60a5fa;
  --primary-foreground: #0c0e12;
  --muted: #0f131a;
  --muted-foreground: #94a3b8;
  --destructive: #f87171;
  --border: #262e3d;
  --input: #262e3d;
  --ring: #60a5fa;
  --checkout: #34d399;
  --checkout-foreground: #062e22;
  --status-success: #34d399;
  --status-warning: #fbbf24;
  --status-error: #f87171;
  --status-federation: #818cf8;
}

@theme inline {
  --font-sans: "Plus Jakarta Sans", "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-checkout: var(--checkout);
  --color-checkout-foreground: var(--checkout-foreground);
  --color-ok: var(--status-success);
  --color-warn: var(--status-warning);
  --color-danger: var(--status-error);
  --color-fed: var(--status-federation);
}
```

### Mapa de Reutilización Directa desde `../base/open-mercato/packages/ui` (MIT)

| Componente en `@open-mercato/ui` | Destino en `@shac/ui` | Adaptación Quirúrgica Requerida |
| :--- | :--- | :--- |
| `AppShell.tsx` + selector de `orgId` | `ShacAppShell.tsx` | Cambiar `next/link` y `usePathname()` por `<Link>` y `useLocation()` de TanStack Router + App Store de módulos activos según `TenantMarketProfile` |
| `DataTable` + barras de filtro | `ShacDataTable.tsx` | Mantener `@tanstack/react-table`, agregar variante compacta `36px`, perspectivas por rol y soporte `offline-cached` desde TanStack Query |
| `CrudForm` (`hiddenGroupIds`) + `FieldDefinitionsEditor.tsx` | `ShacCrudForm.tsx` + `CustomFieldsEditor.tsx` | Conservar validación Zod y edición visual de `cf_*` (`v_cf_*`), conectando el submit al cliente tipado Hono RPC (`hc<AppType>`) |
| `AiChat` + `remarkBlockAiImages` | `ShacCopilotSheet.tsx` | Conservar política anti-exfiltración de imágenes Markdown y tarjetas de aprobación *Proposal Cards* apuntando a `/mcp` stateless |

---

## 6. Reglas de Componentes, Resiliencia Offline y Vocabulario Camaleón

- **Persistencia Offline-First con TanStack Query + IndexedDB (`SyncStatusPill`):** El `QueryClient` usa `networkMode: 'offlineFirst'`, `persistQueryClient` sobre IndexedDB y `setMutationDefaults(['pos.checkout'], ...)`. La píldora superior derecha muestra: `En línea · Tiempo real` (verde), `Offline · X mutaciones en cola` (ámbar; listas para `resumePausedMutations()`), `Sincronizando...` y `Revisión pendiente` (rojo), con avisos efímeros en `sonner`.
- **Disciplina Barcode & Keyboard First en POS y Kiosco:** `useBarcodeScanner()` captura ráfagas HID en `< 30 ms` terminadas en `Enter` (incluyendo decodificación GS1-128) y despacha directo al carrito React. Botones primarios muestran `F2 Buscar`, `F4 Cant.`, `F8 Cliente/RIF`, `F9 Descuento`, `F12 Cobrar`.
- **Semáforo Visual FEFO en Almacén y Farmacia (`LotBadge`):** Ordenamiento automático *First-Expired, First-Out* con insignias `FEFO #1 · Vence 18d` (ámbar), `Vigente` (verde) y `BLOQUEADO · Vencido / Cuarentena` (rojo inseleccionable).
- **Adaptación Semántica por Perfil de Mercado (`useMarketVocabulary()` + `cf_*`):** Ningún componente `.tsx` escribe sustantivos fijos; consume `useMarketVocabulary()` (`Cliente` vs. `Paciente` vs. `Huésped` vs. `Residente` vs. `Representado`) y monta `<CustomFieldsSection />` dinámicamente.
- **Matriz obligatoria de estados:** Todo componente React 19 (`data-slot` sin `forwardRef`) contempla `default`, `hover`, `focus` (`focus-visible:ring-2`), `loading` (`Skeleton`), `offline-cached`, `empty` y `error`.

---

## 7. Inventario Maestro de Pantallas para Google Stitch (All-in-One)

- **Acceso Rápido Bimodal y PIN Delegado (`Auth, Floor PIN & Delegation Gate` — Fase 1):** Login corporativo + selector jerárquico de sucursal/sede a la izquierda, y teclado táctil de `56px` a la derecha para cambio rápido de cajero (4 dígitos) o PIN de delegación supervisada (6 dígitos).
- **Catálogo Maestro, Habladores y Diseñador `cf_*` (`Catalog, Labels & Custom Fields Studio` — Fase 2):** `DataTable` densa con búsqueda `FTS5`, precios de 5 capas, carrito de impresión de habladores multimoneda (`USD` + moneda local) y `Sheet` de atributos `cf_*`.
- **Terminal POS Táctil Multimoneda + Cobro Mixto (`Tactile Multi-Currency POS` — Fase 3):** División 62%/38% sin scroll global, barra de tasas BCV/oficiales en vivo, píldora `Offline` y `Dialog` de cobro mixto con botón de 1 clic **"Restante"** por divisa y validación Cuenta=Moneda.
- **Cierre y Arqueo Ciego de Caja (`POS Blind Cash Count` — Fase 3):** Conteo físico por divisa frente a saldos esperados, resaltado de sobrante/faltante y emisión térmica/texto.
- **Consola WMS, Recepción GS1 ASN y Flota `e-POD` (`WMS & Fleet Console` — Fase 3):** Existencias por `Zona -> Pasillo -> Bin` con semáforo FEFO, *wave picking*, costos en destino y vista móvil `360px` de chofer con firma SVG + foto `e-POD`.
- **Torre de Control de Flota + App Store de Módulos (`Control Plane & Market App Store` — Fase 4):** Panel `.dark` de despliegues, cuotas D1, anillos `canary`/`stable` y conmutador instantáneo en `CONFIG_KV` de los 9 mercados.
- **Hub Federado B2B y Consola MCP (`B2B Mesh & Buffer 24h` — Fase 5):** Comparador mayorista por `GTIN`, monitor del buffer de consolidación de 24h y emisión `B2B_PO_SUBMITTED -> ASN`.
- **Matriz Visual de Espacios, Folios y Contratos (`Live Space Rack & Lease Desk` — Fase 6):** Cuadrícula por piso/estado para habitaciones de hotel, unidades en renta o consultorios, con modal de *Quick Check-In*, Folio abierto, *Housekeeping* y calculadora **Split Rent**.
- **Estación Unificada de Casos, Historia Clínica IA y Cuentas Trust/IOLTA (`Case, EHR & RMA Workstation` — Fase 7):** Cabecera con banner de co-presencia en vivo, panel de notas `SOAP` / expedientes `dockets` / SLA de taller, Escriba Ambiental IA y libro separado de fondos en custodia `Trust/IOLTA`.
- **Consola Táctil de Garita LPR y Accesos IoT (`Tactile Gatehouse & Smart Locks Deck` — Fase 8):** Cuadrícula 2x2 de cámaras/portones, botonera táctil de `56px` (`Pulso 5s`, `Lockdown`), lectura LPR `< 15 ms` y emisión de pases QR/PIN por WhatsApp.
