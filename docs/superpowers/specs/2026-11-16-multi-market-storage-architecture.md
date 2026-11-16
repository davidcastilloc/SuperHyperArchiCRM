# Plan Maestro de Almacenamiento Multi-Mercado en 5 Capas (`STORAGE_ARCHITECTURE_PLAN.md`)

**Versión:** 2.2.0  
**Documentos Compañeros:** `SPEC.md` (v2.2.0), `DATA_MODEL.md` (v2.2.0), `DESIGN.md` (v2.2.0) y `AGENTS.md` (v2.2.0)  
**Propósito:** Documentar con precisión de ingeniería dónde, cómo y bajo qué garantías de aislamiento, velocidad y costo se almacena la información de los **9 mercados verticales** dentro del motor único **True All-in-One** de `SuperHyperArchiCRM`.

---

## 1. El Problema que Resuelve esta Arquitectura

Cuando un software intenta cubrir múltiples industrias (Retail POS, Almacenes Mayoristas WMS, Talleres RMA, Hoteles, Condominios, Clínicas Médicas, Bufetes Legales y Garitas de Seguridad IoT), los sistemas tradicionales suelen caer en una de dos trampas fatales:

1. **La Trampa del Esquema Duplicado ("Silos Inconexos"):** Copiar tablas por cada industria (`customers`, `patients`, `guests`, `tenants`, `legal_clients`; o 6 tablas distintas de facturas). Cuando una empresa opera dos giros (por ejemplo, Clínica + Farmacia POS, o Mayorista + Tiendas + Taller), la misma persona y el mismo inventario quedan triplicados y descuadrados.
2. **La Trampa del JSON Amorfo ("EAV / NoSQL Lento"):** Meter todos los registros en una tabla genérica de documentos JSON sin tipos. Se pierden los índices compuestos, la integridad contable, la velocidad sub-milisegundo y la validación estricta de saldos.

**SuperHyperArchiCRM** elimina ambas trampas combinando **Tres Reglas de Oro** y **Cinco Cajas Físicas de Almacenamiento**.

---

## 2. Regla de Oro 1: Aislamiento Físico Total entre Clientes (`1 Empresa = 1 Base D1 Propia`)

Ningún cliente comparte archivo de base de datos con otro cliente:

- **1 Inquilino (`tenant`) = 1 Base SQLite Física en Cloudflare D1:** Un minimarket en Valencia, un hotel en Cartagena, una clínica en Miami y un bufete en Ciudad de México escriben en **archivos físicos D1 completamente separados**.
- **Economía Real en Cloudflare:** Una cuenta `Workers Paid` (`USD 5/mes`) incluye **hasta 100,000 bases de datos D1 aisladas sin recargo por base**, además de soportar modo `BYOC Free` (donde la base vive en la cuenta gratuita del propio cliente).
- **Ventajas Operativas Directas:**
  1. **Cero Vecino Ruidoso y Cero Fuga Cruzada:** Una consulta pesada de cierre anual en una distribuidora no afecta jamás la latencia de un consultorio médico.
  2. **Recuperación Quirúrgica (*D1 Time Travel*):** Se puede restaurar la base de datos de un único cliente al segundo exacto previo a un error humano sin tocar al resto de la flota.
  3. **Portabilidad y Licencia Perpetua (*Buyout*):** Si un cliente corporativo adquiere licencia local perpetua, su base es literalmente un archivo `.sqlite` limpio listo para exportar sin tener que recortar filas de una tabla compartida.
- **Doble Candado Interno (`tenant_id` + `org_id` / `tree_path`):** Aun teniendo su propia base D1, cada tabla exige `tenant_id` y ruta jerárquica `org_id` (ej. `/grupo-alfa/sede-norte/farmacia`), permitiendo que un grupo empresarial con 20 sucursales o edificios controle qué ve cada cajero, médico o administrador dentro de su holding.

---

## 3. Regla de Oro 2: Organización Interna en D1 (`Tronco Universal + Satélites Tipados + v_cf_*`)

Dentro de la base D1 de cada cliente residen las **108 tablas relacionales canónicas** de `DATA_MODEL.md`, divididas en tres anillos complementarios:

### 3.1 Anillo 1 — El Tronco Universal (`~35 tablas` compartidas por todos los mercados)

Guarda las entidades fundamentales que existen en cualquier actividad económica. Lo único que cambia entre industrias es el **vocabulario dinámico** que muestra la interfaz según `CONFIG_KV`:

| Tabla Troncal en D1 | Qué es en Retail / WMS | Qué es en Hotel / Condominio | Qué es en Clínica / Legal |
| :--- | :--- | :--- | :--- |
| `crm_parties` | Cliente minorista (Cédula/RIF) o Cuenta Mayorista B2B | Huésped VIP o Residente / Co-inquilino | Paciente (MRN), Padre/Tutor o Cliente Representado |
| `cat_products` | Producto físico (`SKU`, `GTIN`, `LOT_EXPIRY`, `SERIAL`) | Tarifa por noche (`room_rate`), cuota de mantenimiento o minibar | Consulta / procedimiento (`clinical_cpt`), vacuna o tarifa horaria legal |
| `spc_units` | Tienda, pasillo o muelle de carga | Habitación `304`, Apartamento `4B`, Salón BBQ o Cajón `P-12` | Consultorio `2`, Quirófano `1` o Sala de Juntas |
| `com_orders` y `com_invoices_and_fiscal` | Ticket POS, Pedido B2B, Factura DIAN / CFDI / HKA | Cuenta Folio de estadía o Estado de Cuenta mensual de renta | Superbill clínico o Minuta de honorarios |
| `com_payments` y `fin_accounts` | Caja `USD`, Caja `VES`, Pago Móvil, BioPago, Nequi, OXXO, Square | Cobro OTA, tarjeta en recepción, ACH o **Split Rent** | Copago en recepción, remesa aseguradora o transferencia a cuenta operativa |

**Caso práctico ("El Efecto María Gómez"):** Si un complejo empresarial opera *Clínica Médica + Farmacia POS + Estacionamiento con Barrera LPR*, **María Gómez existe una sola vez en `crm_parties` (`id = pty_01J...`)**:
- A las `09:00 AM` pasa consulta médica (se vincula su `pty_01J...` en `med_encounters_and_vitals`).
- A las `09:45 AM` compra los medicamentos recetados en la farmacia POS con pago mixto `Bs + USD` (se vincula el mismo `pty_01J...` en `com_orders`, descontando el lote **FEFO** en `BranchInventoryDO`).
- A las `10:00 AM` sale del estacionamiento y la cámara LPR abre la barrera en `< 15 ms` reconociendo la placa asociada a su ficha.

### 3.2 Anillo 2 — Los Satélites Tipados por Industria (`~73 tablas` especializadas)

Todo dato complejo o regulado propio de una industria vive en tablas relacionales con columnas tipadas estrictas (nunca escondido en blobs opacos):

- **Satélites WMS y Flota (`wms_*`):** Ubicaciones físicas y virtuales de doble partida, lotes GS1-128, valoración `AVCO`/`FIFO`, prorrateo de costos de importación (*landed costs*), órdenes `-BACKORDER` y rutas GPS con firma `e-POD`.
- **Satélites Hoteleros e Inmobiliarios (`spc_*`, `lease_*`, `condo_*`):** Reservas OTA, folios abiertos, *Housekeeping* por camarera, solicitudes de renta con puntaje, contratos `Lease` con depósito *escrow*, *Autopay*, calculadora **Split Rent**, mascotas y votaciones vecinales.
- **Satélites Clínicos y Terapias (`med_*`):** Notas `SOAP` con firma y co-firma supervisada, recetas electrónicas `eRx`/`EPCS`, órdenes HL7/FHIR y estudios DICOM, grupos terapéuticos, ensayos conductuales **ABA (`trial_records` / `abc_records`)**, planes de crisis y reclamos a aseguradoras **EDI 837 / ERA 835**.
- **Satélites Legales, Técnicos y Campo (`leg_*`, `srv_*`, `fin_trust_escrow_ledgers`, `evv_*`):** Expedientes `matters`, sincronización de juzgados `dockets`, órdenes técnicas por serial, garantías RMA con recobro a proveedor, cuentas fiduciarias **Trust/IOLTA** (`CHECK balance_minor >= 0`) y verificación geocercada GPS **EVV** con doble firma SVG.
- **Satélites Físicos IoT (`phy_*`):** Cerraduras inteligentes con % de batería, portones multi-marca, casilleros QR de paquetería y bitácora forense firmada con HMAC.

**¿Cuánto cuestan los satélites apagados?** En SQLite/D1 una tabla vacía ocupa únicamente su página raíz (`~4 KB`). Tener las 108 tablas creadas desde el primer día ocupa **`~620 KB`** (`0.12%` del plan gratuito de `500 MB`). A cambio, cuando un cliente decide encender un nuevo módulo desde su panel ("App Store Interno"), **no hay migraciones riesgosas ni esperas: funciona en `0 ms`**.

### 3.3 Anillo 3 — Extensibilidad Infinita sin Código (`custom_fields` + Columnas Virtuales `v_cf_*` + `FTS5`)

Cuando un cliente específico necesita atributos particulares que no justifican una columna universal (por ejemplo `cf_graduacion_od` en una óptica, `cf_registro_sanitario` en una droguería o `cf_kilometraje_ingreso` en un taller automotriz):

1. El atributo se declara en `kernel_custom_field_defs` con su esquema de validación Zod.
2. El valor se almacena en la columna JSON `custom_fields` del registro.
3. Si el campo se marca como filtrable/ordenable (`is_indexed = true`), el motor ejecuta de forma aditiva:
   ```sql
   ALTER TABLE cat_products
   ADD COLUMN v_cf_registro_sanitario TEXT
   GENERATED ALWAYS AS (json_extract(custom_fields, '$.registro_sanitario')) VIRTUAL;

   CREATE INDEX idx_prod_cf_reg_san ON cat_products(tenant_id, v_cf_registro_sanitario);
   ```
   SQLite indexa el valor en un árbol B nativo **sin duplicar almacenamiento en disco**, logrando búsquedas en `< 1 ms`. Y para entidades 100% inventadas por el cliente, `kernel_custom_records` + `kernel_custom_records_fts` proveen CRUD completo y búsqueda instantánea `FTS5`.

---

## 4. Regla de Oro 3: Las 5 Cajas Físicas según Temperatura y Peso del Dato

No todos los datos tienen la misma física de acceso. Guardar videos en SQL o controlar el último artículo en oferta con `SELECT ... FOR UPDATE` destruye el rendimiento o dispara costos. Por eso cada categoría de dato va a su caja óptima:

| Capa Física | Tecnología | Latencia Típica | Qué Datos Viven Aquí | Garantía Clave |
| :--- | :--- | :--- | :--- | :--- |
| **Caja 1: Configuración Viva** | `CONFIG_KV` + `SESSION_KV` (Cloudflare KV + caché RAM 60s) | `< 0.5 ms` | `TenantMarketProfile` (módulos encendidos, `regionPack`, monedas, vocabulario), sesiones JWT/API Key y PINs temporales de 4 y 6 dígitos | Si un módulo no está activo en el perfil, `moduleGate` corta con `403` antes de tocar D1 |
| **Caja 2: Estado Caliente Transaccional** | `BranchInventoryDO` (Durable Object con SQLite embebido — 1 por Sucursal/Sede) | `< 1 ms` | Las **8 tablas `hot_*`**: saldos por bin/lote **FEFO**, turno de caja POS abierto, bloqueo de habitaciones/unidades/consultorios, pizarra TV `/lobby`, pases activos QR/PIN/LPR, `hot_idempotency_log` y `hot_outbox` | Ejecución en **un solo hilo determinista**: 50 cajeros o 2 OTAs concurrentes jamás producen sobregiro ni doble reserva |
| **Caja 3: Estado Maestro, Histórico y Analítico** | `DB` (Cloudflare D1 — 1 base física por Empresa) | `2 – 8 ms` | Las **108 tablas canónicas** (Tronco + Satélites + `v_cf_*` + `FTS5`), alimentadas en segundo plano desde `hot_outbox` vía `EVENTS_QUEUE` con `db.batch()` | Aislamiento físico total por empresa, `<= 2` queries por listado y recuperación *Time Travel* |
| **Caja 4: Bóveda de Objetos Pesados** | `FILES_R2` (Cloudflare R2 S3-compatible) | Streaming CDN (`USD 0` egress) | PDFs fiscales (DIAN/CFDI), firmas y fotos `e-POD`, estudios médicos DICOM, grabaciones del Escriba IA, documentos legales y clips de cámaras sellados con `SHA-256` | Mantiene la base SQLite ultraliviana guardando en D1 únicamente el puntero `r2_object_key` y su hash |
| **Caja 5: Supervivencia Local Offline** | **TanStack Query (`offlineFirst`) + IndexedDB** en navegador (o **SQLite nativo** en Tauri Desktop/Garita) | `0 ms` (local sin red) | Catálogo vendible, última tasa cambiaria oficial (`BCV`/`DolarAPI`), lista blanca de placas LPR y cola de mutaciones firmadas con `clientMutationId` (ULID) | Si se cae el internet o la electricidad externa, cajas y portones operan sin pausa y sincronizan al volver sin duplicar jamás una operación |

*(Nota sobre la **Red Federada B2B/B2C**: El Hub Federado opera en una base D1 global con Read Replicas + índice semántico Cloudflare Vectorize completamente separada de los nodos clientes. Hacia esa capa solo viajan ofertas marcadas explícitamente con `is_public_in_network = true` y sobres B2B firmados con Ed25519; jamás salen clientes finales, costos internos, notas clínicas/legales ni arqueos de caja).*

---

## 5. Mapa Completo de Almacenamiento por Mercado (Los 9 Presets)

| Mercado (`editionPreset`) | Qué Bloquea en Caliente (`BranchInventoryDO`) | Tablas Troncales D1 Usadas | Tablas Satélite D1 Encendidas | Qué Guarda en R2 y Offline Local |
| :--- | :--- | :--- | :--- | :--- |
| **1. `retail-pos`** | `hot_pos_shifts`, `hot_bin_balances`, `hot_inventory_lots` (FEFO), `hot_idempotency_log` | `crm_parties`, `cat_products`, `cat_currencies_and_rates`, `com_orders`, `com_payments`, `fin_accounts` | `pos_registers_and_displays`, `pos_cash_closings`, `cat_label_print_batches`, `com_invoices_and_fiscal` | **Offline:** Catálogo + tasa BCV + cola de tickets POS. **R2:** Reportes Z / facturas PDF |
| **2. `distro-wms`** | `hot_bin_balances`, `hot_inventory_lots`, `hot_access_passes` (muelles), `hot_outbox` | `crm_parties`, `crm_groups_and_terms`, `cat_products`, `cat_price_rules`, `com_quotes`, `com_orders` | `wms_warehouses_and_zones`, `wms_locations`, `wms_pickings`, `wms_stock_moves`, `wms_valuation_and_landed_costs`, `wms_fleet_and_deliveries` | **Offline:** Colector móvil de picking y ruta de chofer. **R2:** Fotos y firmas `e-POD`, facturas DIAN/CFDI |
| **3. `tech-service`** | `hot_bin_balances` (repuestos), `hot_pos_shifts` (mostrador), `hot_idempotency_log` | `crm_parties`, `cat_products` (serializados), `com_orders`, `com_invoices_and_fiscal` | `srv_work_orders`, `srv_preventive_schedules`, `srv_warranty_claims_rma`, `evv_field_verifications` | **Offline:** Órdenes de campo y geocerca `EVV`. **R2:** Fotos de ingreso de equipo y guías RMA |
| **4. `hospitality-pms`** | `hot_space_locks` (habitaciones sin doble venta), `hot_access_passes` (PIN puerta), `hot_pos_shifts` | `crm_parties` (VIP/puntos), `cat_products` (tarifas/minibar), `spc_units`, `com_payments` | `spc_bookings_and_appointments`, `spc_folios`, `spc_housekeeping_tasks`, `srv_work_orders` | **Offline:** Rack de recepción de contingencia. **R2:** Escaneo de pasaportes y folios corporativos |
| **5. `property-condo`** | `hot_space_locks` (amenidades), `hot_access_passes` (QR casilleros + placas LPR) | `crm_parties`, `crm_party_links` (*roommates*), `spc_units`, `com_invoices_and_fiscal`, `fin_accounts` | `lease_applications`, `lease_contracts_and_renewals` (*Autopay*, **Split Rent**), `fin_trust_escrow_ledgers`, `condo_community_hub`, `phy_package_deliveries` | **Offline:** Pases de acceso y tickets con foto. **R2:** Contratos firmados e inspecciones de mudanza |
| **6. `clinic-practice`** | `hot_space_locks` (consultorios), `hot_queue_board` (TV `/lobby`), `hot_inventory_lots` (vacunas) | `crm_parties` (MRN/tutores), `hr_staff_profiles` (NPI/DEA), `spc_bookings_and_appointments`, `kernel_audit_logs` | `med_patient_chart_items`, `med_encounters_and_vitals`, `med_clinical_notes` (`SOAP`/co-firma), `med_prescriptions_and_mar`, `med_labs_and_imaging`, `med_therapy_groups_and_aba`, `med_rcm_claims_and_era`, `evv_field_verifications` | **Offline:** Formularios de admisión y visitas domiciliarias `EVV`. **R2:** Audios Escriba IA, imágenes DICOM y carnets OCR |
| **7. `legal-psa`** | `hot_space_locks` (salas), `hot_idempotency_log` | `crm_parties`, `crm_conflict_checks`, `hr_shifts_timesheets_and_payroll`, `com_invoices_and_fiscal`, `kernel_record_locks` | `leg_matters`, `leg_dockets_and_deadlines`, `psa_projects_and_tasks`, `fin_trust_escrow_ledgers` (**IOLTA**), `doc_collaborative_pages` (Yjs) | **Offline:** Cronómetro de horas facturables y lectura de escritos. **R2:** Bóveda documental cifrada y pruebas |
| **8. `industrial-gate`** | `hot_access_passes` (placas LPR y PINs), `hot_outbox` | `iam_acl_grants` (`allowedGateIds`), `crm_parties`, `comm_threads_and_messages` | `phy_devices_and_gates`, `phy_access_passes`, `phy_access_audit_logs` (HMAC), `phy_evidence_and_threat_shield` | **Offline:** Lista blanca LPR `< 15 ms` en garita local. **R2:** Clips de evidencia sellados con `SHA-256` |
| **9. `omni-enterprise`** | Las 8 tablas `hot_*` activas por sucursal según el giro de cada `orgId` | Todo el Tronco compartido a través del grupo empresarial | Todos los satélites requeridos por las unidades de negocio del grupo | Combinación completa gobernada por `CONFIG_KV` sin migrar ni duplicar datos |
