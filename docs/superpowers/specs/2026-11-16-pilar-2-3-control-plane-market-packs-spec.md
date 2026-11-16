# Especificación Detallada — Pilares 2 y 3: Control Plane, Packs de Familia y Perfiles de Mercado en KV

**Carpeta Drive Asociada:** `03_Control_Plane_y_Perfiles_KV`  
**Paquetes Cubiertos:** `@shac/editions`, `@shac/control-plane`, `@shac/mod-spaces`, `@shac/mod-leases`, `@shac/mod-services`, `@shac/mod-cases`, `@shac/mod-finance`, `@shac/mod-portal`, `@shac/mod-automation`, `@shac/mod-physical`

---

## 1. Arquitectura de Empaquetado por Familia (`< 500 KiB` por Edición, `< 1024 KiB` Omni)

Cada edición en `editions/<preset>/index.ts` importa de forma estática únicamente el **Núcleo Universal** más los **Packs de Familia** correspondientes, permitiendo que `esbuild` / Wrangler elimine al 100% el código de los packs no incluidos:

1. **Ediciones Ligeras Monopack (`< 420 KiB gzip`):**
   - `retail-pos` -> Núcleo + `commerce-wms`
   - `industrial-gate` -> Núcleo + `physical-iot` + submódulo de pases de `spaces-stays`
2. **Ediciones Combinadas Verticales (`< 500 KiB gzip`):**
   - `distro-wms` -> Núcleo + `commerce-wms` (+ `physical-iot` opcional en muelles)
   - `tech-service` -> Núcleo + `commerce-wms` + `cases-practice`
   - `legal-psa` -> Núcleo + `spaces-stays` (agenda) + `cases-practice`
   - `property-condo` -> Núcleo + `spaces-stays` + `cases-practice` + `physical-iot`
   - `clinic-practice` -> Núcleo + `spaces-stays` + `cases-practice` + `commerce-wms` (lotes farmacia)
   - `hospitality-pms` -> Núcleo + `spaces-stays` + `commerce-wms` + `cases-practice` + `physical-iot`
3. **Edición Maestra `omni-enterprise` (`< 1024 KiB gzip`):**
   - Incluye los 4 packs unidos para clientes corporativos o flotas SaaS multi-D1 en Workers for Platforms, activando vistas y comandos por `orgId` desde `CONFIG_KV`.

---

## 2. Especificación Funcional de los Packs Verticales (`spaces-stays`, `cases-practice`, `physical-iot`)

### 2.1 Pack `spaces-stays` (Hotelería, Condominios y Agenda de Recursos)
- **Entidad Universal `spaces_units`:** Modela habitaciones, departamentos, locales, consultorios, quirófanos, canchas o bahías de servicio con piso/zona, capacidad, tarifa base (`baseRateMinor`) y estado reflejado en `hot_space_locks`.
- **Modo Estadía Corta (`hospitality-pms`):** Reservas con canal de origen (`DIRECT`, `WALK_IN`, `BOOKING_COM`, `AIRBNB`, `EXPEDIA`, `CORPORATE`), checklist de *Quick Check-In*, cuenta abierta (**Folio**) donde convergen cargos nocturnos + consumos de POS/minibar, generación automática de tarea en `Housekeeping` al hacer *Check-Out* y cálculo de **ADR** y **RevPAR**.
- **Modo Arrendamiento Largo (`property-condo`):** Solicitud `LeasingApplication` con puntaje de evaluación, contrato `Lease` con firma electrónica y depósito en garantía aislado (*escrow*), facturación mensual desglosada, débito automático **Autopay**, calculadora **Split Rent** entre co-inquilinos, ofertas proactivas de renovación con incentivos y preaviso de desocupación (`VacateNotice`) con reporte de inspección.
- **Agenda Multi-Proveedor y Lista de Espera:** Turnos por especialista/recurso con trazabilidad de reprogramaciones (`move_logs`) y `WaitlistManager` priorizado para cubrir cancelaciones.

### 2.2 Pack `cases-practice` (Servicio Técnico, Salud, Legal, Finanzas Fiduciarias y Portal)
- ** Registro Unificado `cases_records`:** Representa una Orden de Servicio/RMA, un Encuentro Clínico (`Encounter`), un Expediente Legal (`Matter`) o un Ticket de Mantenimiento (con permiso de entrada sin residente, alerta de mascota en unidad, fotos y calificación 1–5 estrellas).
- **Submódulos Especializados Activables por Perfil:**
  - *Taller / Activos:* Recepción por serial, consumo de repuestos desde `BranchInventoryDO`, garantías RMA con pausa de SLA al esperar cliente, recuperación contra proveedor y calendario de **Mantenimiento Preventivo** (HVAC, elevadores, servidores, flota).
  - *Clínico:* Estación de notas estructuradas (`SOAP` / visual / por pasos), Escriba Ambiental IA que sugiere diagnósticos/órdenes y nivel de facturación, co-presencia en vivo sobre el expediente y pantalla pública de sala de espera (`/lobby`) segura en privacidad.
  - *Legal / PSA:* Chequeo automatizado de conflictos de interés antes de aceptar un caso, seguimiento de expedientes judiciales (`dockets`) y plazos fatales (`hearing`/`deadline`), hojas de tiempo con cronómetro y **cuentas fiduciarias Trust/IOLTA** con prohibición de sobregiro y separación estricta de cuentas operativas.
  - *Finanzas y Portal Camaleónico:* Validador previo de reclamos/facturas (*Claim Scrubber*), contabilidad de doble partida opcional y portal externo `/[orgSlug]/portal` (con vista supervisada para tutores/apoderados y filtro SQL obligatorio `is_confidential = 0`).
  - *Automatización Gobernada:* Motor declarativo `business_rules` (`GUARD`, `VALIDATION`, `CALCULATION`, `ASSIGNMENT`, `ACTION`), workflows visuales BPM e `inbox_ops` (conversión de correos/mensajes entrantes en *Proposal Cards* aprobables en 1 clic).

### 2.3 Pack `physical-iot` (Cerraduras, Casilleros, Portones LPR y Evidencia)
- **Emisión Automática de Credenciales Físicas:** Confirmar un *Check-In*, activar un contrato `Lease` o aprobar un visitante genera en `hot_access_passes` un PIN temporal o QR con ventana horaria exacta.
- **Garita y Muelles LPR Offline-First:** Lista blanca sincronizada al nodo local para aperturas en `< 15 ms` (`RESIDENT`, `VIP`, `FLEET_CARGO`). Ante placas no reconocidas, envía alerta interactiva por WhatsApp/Telegram con botones de acción firmados por webhook y archiva el clip o captura en R2 con hash `SHA-256`.

---

## 3. Esquema y Operación del Control Plane (`@shac/control-plane`)

| Tabla en `control_plane_db` | Columnas Clave | Propósito Operativo |
| :--- | :--- | :--- |
| `cp_deployments` | `id`, `slug`, `company_name`, `hosting_mode` (`BYOC_FREE` \| `SAAS_MULTI_D1` \| `HYBRID_APPLIANCE`), `cf_account_id`, `d1_database_id`, `release_channel`, `current_version`, `status` | Inventario maestro de todos los clientes y modos de despliegue |
| `cp_market_profiles` | `deployment_id`, `preset_id`, `region_pack`, `active_packs_json`, `active_modules_json`, `vocabulary_json`, `currency_json`, `entitlements_json`, `federation_json`, `revision` | Fuente de verdad sincronizada hacia `CONFIG_KV` de cada nodo |
| `cp_appliance_licenses` | `license_id`, `deployment_id`, `hardware_fingerprint`, `issued_at`, `expires_at`, `hmac_signature`, `revoked_at` | Licencias perpetuas o anuales verificables offline para nodos locales |
| `cp_telemetry_daily` | `deployment_id`, `date_ymd`, `d1_rows_read`, `d1_rows_written`, `worker_requests`, `storage_bytes`, `active_registers` | Semáforo preventivo de cuotas (alerta al 75% en cuentas `BYOC_FREE` para ofrecer paso transparente a `SAAS_MULTI_D1`) |
| `cp_rollout_jobs` | `job_id`, `target_version`, `channel` (`canary` \| `stable`), `migration_batch_hash`, `total_nodes`, `succeeded_nodes`, `failed_nodes` | Despliegue automatizado por anillos respetando rate-limits de Cloudflare API (`1,200 req / 5 min`) |

### Protocolo de Upgrade o Fusión de Mercado en Caliente (`< 60 s`)
1. El operador habilita nuevos módulos o cambia el preset en el Control Plane (ej. una farmacia `retail-pos` agrega consultorios médicos de `clinic-practice`, o una distribuidora `distro-wms` abre tiendas POS y taller RMA).
2. El Control Plane inspecciona las migraciones aplicadas en el D1 del cliente y ejecuta exclusivamente los bloques `CREATE TABLE IF NOT EXISTS` y semillas `cf_*` faltantes (cero `DROP`, cero pérdida de datos).
3. Escribe el nuevo `TenantMarketProfile` en `CONFIG_KV` e invoca `/api/system/reload-profile`.
4. La SPA refresca su manifiesto y habilita las nuevas vistas compartiendo exactamente el mismo catálogo, clientes, cuentas financieras y `BranchInventoryDO`.
