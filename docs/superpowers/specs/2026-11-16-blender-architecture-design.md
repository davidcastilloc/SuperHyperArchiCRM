# Diseño de Fusión Multi-Mercado y Multi-Situación ("La Licuadora" v2.0)

**Fecha:** 2026-11-16  
**Estado:** Aprobado por David Castillo  
**Documento Raíz:** `SPEC.md` (v2.0.0)

---

## 1. Propósito y Por Qué Ahora

El objetivo de **SuperHyperArchiCRM** es consolidar en una sola arquitectura ultra-eficiente (100% Cloudflare Edge + Offline-First) todo el conocimiento de dominio, flujos operativos de calle y soluciones reales construidas previamente a lo largo de **9 bases de código independientes**:

1. `open-mercato` — Framework modular B2B/B2C (38 módulos: CRM, catálogos, promociones, workflows BPM, reglas sin código, formularios GDPR, garantías RMA, InboxOps e historial Undo/Redo).
2. `CRMWarehouse-Stores` — Plataforma mayorista + tiendas (WMS doble partida estilo Odoo, códigos GS1-128 con FEFO, costos en destino, buffer B2B de 24h, flota GPS con firma `e-POD`, facturación y pagos regionales US/CO/MX y licencias offline firmadas).
3. `open-pos` — Terminal POS 100% offline en Drizzle SQLite (trimoneda venezolana `BS`/`USD`/`EUR` conectada al BCV, candado de sesión de caja, conciliación Cuenta=Moneda, costo promedio ponderado y devoluciones en 2 fases).
4. `GeorginaPOS` — Operativa minorista ágil en red local y borde (consulta instantánea de Cédula/RIF, cobro mixto con botón `"Restante"`, kiosco verificador `SmartCheck` con autocierre en 10s, impresor de habladores de góndola en `USD`+`Bs` y migrador CSV/Google Sheets tolerante a datos sucios).
5. `hotel-project-turpial` — Gestión hotelera (matriz *Live Room Rack* por piso, reservas multi-canal OTA, *Quick Check-In*, folios abiertos, *Housekeeping*, mantenimiento preventivo y métricas ADR/RevPAR).
6. `apartment-property-management` — Administración de edificios y condominios (solicitudes con *screening*, contratos con depósito *escrow*, cobro recurrente *Autopay*, calculadora **Split Rent** entre co-inquilinos, ofertas de renovación, casilleros QR, mascotas y votaciones).
7. `Doctors-EHR-New` — Práctica clínica y salud (calendario multi-especialista + `Waitlist`, admisión digital OCR+OTP, TV de sala `/lobby`, Escriba Ambiental IA, PINs de delegación de 6 dígitos, co-presencia en vivo, telemedicina y *Claim Scrubber*).
8. `lawyerplatform` — Práctica legal y servicios profesionales (chequeo de conflictos de interés, expedientes `matters` + `dockets` judiciales, plazos fatales, cronómetro de horas facturables y cuentas fiduciarias **Trust/IOLTA**).
9. `helios` — Control físico e IoT de instalaciones (portones y cortinas multi-marca, lectura LPR vehicular `< 15 ms` offline, portero interactivo por WhatsApp/Telegram ante placas desconocidas y clips forenses `SHA-256` en R2).

---

## 2. Metas, No-Metas y Anti-Metas

- **Metas:**
  - Destilar los 9 repositorios en **12 Motores Universales** reutilizables y **9 Presets de Mercado** configurables en `CONFIG_KV`.
  - Resolver nativamente entornos difíciles (cortes de internet/luz, bimonetarismo/hiperinflación, facturación fiscal regulada en LatAm/US, trazabilidad sanitaria FEFO y seguridad física en garitas/puertas).
  - Mantener el costo marginal por cliente cercano a cero dentro de las cuotas de Cloudflare (`< 5 ms` CPU p99, `< 500 KiB gzip` por edición vertical, `< 1024 KiB gzip` en `omni-enterprise`).
- **No-Metas:**
  - No portar dependencias pesadas de servidor tradicional (`MikroORM`, `Prisma` Node binary, `Awilix`, `BullMQ`, `PostgreSQL`) al runtime de Workers.
- **Anti-Metas (Lo que constituiría un fracaso aunque compile):**
  - Bifurcar ramas Git por cliente o vertical.
  - Superar el presupuesto de `1 MiB gzip` o romper la operación offline de las cajas POS.
  - Permitir sobregiros de inventario, dobles reservas de habitaciones/unidades o mezcla contable de monedas y fondos fiduciarios.

---

## 3. Enfoques Evaluados y Decisión Tomada

| Enfoque Considerado | Ventajas | Desventajas / Trade-offs | Decisión |
| :--- | :--- | :--- | :--- |
| **A. Núcleo Universal + 4 Packs Compilables por Familia** | Mantiene ediciones individuales bajo `500 KiB gzip`, permite fusionarlas todas en `omni-enterprise` bajo `1024 KiB gzip` gracias a `"sideEffects": false`, y conserva un solo tronco Git | Requiere disciplina estricta de fronteras entre paquetes (`knip` y tests de bundle en CI) | **SELECCIONADO** |
| **B. Super-Binario Único Todo-en-Uno desde Día 1** | Un único artefacto Worker para absolutamente todos los despliegues | Penaliza arranque en frío y consume innecesariamente presupuesto de bundle en clientes pequeños (ej. un minimarket cargando esquemas legales/clínicos) | Descartado |
| **C. Solo Comercio/WMS ahora y resto fuera de arquitectura** | Menor superficie de diseño inicial | Obliga a rediseñar contratos nucleares (`ExecutionContext`, `BranchInventoryDO`, `Party`, `Portal`) más adelante | Descartado |

---

## 4. Mapeo de los 12 Motores hacia Paquetes `@shac/*`

| Motor Universal | Paquete Objetivo | Capa / Pack |
| :--- | :--- | :--- |
| 1. IAM, Jerarquía, Turnos y PINs de Piso/Delegación | `@shac/kernel` + `@shac/mod-iam` | Núcleo Universal |
| 2. CRM 360, Admisión OCR/KYC, Padrón Fiscal y Conflictos | `@shac/mod-customers` | Núcleo Universal |
| 3. Catálogo, Precios 5 Capas, Promociones, Habladores y CSV Difuso | `@shac/mod-catalog` | Núcleo Universal |
| 4. POS Todo-Terreno, Cajas Multi-Divisa, Botón `"Restante"` y `SmartCheck` | `@shac/mod-pos` | Pack `commerce-wms` |
| 5. Multimoneda BCV/Bancos Centrales y Fiscalidad Regional (`ve`/`co`/`mx`/`us`) | `@shac/kernel` + `@shac/mod-regional` | Núcleo + Pack `commerce-wms` |
| 6. WMS Doble Partida, GS1-128 FEFO, *Landed Costs* y Flota `e-POD` | `@shac/actor-branch` + `@shac/mod-wms` | Núcleo + Pack `commerce-wms` |
| 7. Espacios Reservables (*Live Rack*), Folios, Contratos `Lease` y Agenda | `@shac/mod-spaces` + `@shac/mod-leases` | Pack `spaces-stays` |
| 8. Expedientes, Taller/RMA, Escriba IA, Formularios GDPR y Co-Presencia | `@shac/mod-services` + `@shac/mod-cases` | Pack `cases-practice` |
| 9. Finanzas, Contabilidad Opcional, **Split Rent**, **Trust/IOLTA** y *Claim Scrubber* | `@shac/mod-finance` | Pack `cases-practice` |
| 10. Portal Camaleónico Autoservicio (`/[orgSlug]/portal`) y Comunidad | `@shac/mod-portal` | Pack `cases-practice` |
| 11. Reglas de Negocio, Workflows BPM, Voz IA e `InboxOps` (*Proposal Cards*) | `@shac/mod-automation` | Pack `cases-practice` |
| 12. Cerraduras PIN, Casilleros QR, Portones LPR `< 15 ms` y Evidencia `SHA-256` | `@shac/mod-physical` | Pack `physical-iot` |
