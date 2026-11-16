# Plan de Configuración — GeorginaPOS ("La Tiendita de Georgina")

> **Para el operador / agente:** Este plan configura una tienda retail bimonetaria (`USD` / `VES`) sobre el nodo desplegado `shac-node-worker` (`https://shac-node-worker.pc911itservices.workers.dev`) usando el preset `retail-pos` sin modificar código fuente ni migrar tablas.

**Objetivo:** Dejar operativa "La Tiendita de Georgina" con su sucursal, cuentas de caja (`USD` y `VES`), tasa de cambio, catálogo de productos, stock inicial en `BranchInventoryDO`, cajero con PIN de 4 dígitos y primera venta POS completada.

---

### Task 1: Activar el Preset `retail-pos` en `App Store` (`/app-store`)

- **Acción:** Abrir `/app-store` en la SPA y aplicar el preset **`retail-pos`** (o ejecutar `POST /api/system/app-store/toggle` con `{ "presetId": "retail-pos" }`).
- **Resultado esperado:** `CONFIG_KV` (`profile:current`) queda con `editionPreset: "retail-pos"`, `regionPack: "ve"`, `operatingCurrencies: ["USD", "VES"]` y menú enfocado en `Clientes`, `Catálogo`, `POS · Pedido`, `SmartCheck 10s`, `WMS · Sucursal` y `Finanzas`.

### Task 2: Configurar Sucursal y Cajero de Turno (PIN 4 dígitos)

- **Acción:**
  1. Verificar que la sucursal `Casa Matriz` (`org_1`, o crear `"Tiendita Georgina"` vía `POST /api/iam/orgs`) esté activa.
  2. Crear el usuario cajero en `iam_users` con `floor_pin_hash` (SHA-256 de su PIN de 4 dígitos) y permisos `["customers.*", "catalog.*", "pos.*", "wms.*"]`.
- **Resultado esperado:** El cajero puede iniciar sesión en `/auth` usando únicamente el teclado táctil de 4 dígitos.

### Task 3: Registrar Cuentas Financieras por Moneda (`Cuenta = Moneda`)

- **Acción:** En `fin_accounts` (D1), asegurar al menos una cuenta por cada moneda de cobro:
  - `acc_usd_cash` (`currency: "USD"`, efectivo en caja).
  - `acc_ves_pm` (`currency: "VES"`, Pago Móvil / punto de venta).
- **Resultado esperado:** Los cobros mixtos en `/pos` respetan `account.currency === payment.currency` sin rechazos `422 ERR_CURRENCY_ACCOUNT_MISMATCH`.

### Task 4: Cargar Tasa de Cambio y Catálogo Inicial (`/catalog`)

- **Acción:**
  1. Registrar la tasa vigente `USD -> VES` en `rateMicros` (ej. `54_750_000` para `54.75 VES/USD`).
  2. Crear los primeros productos de la tiendita en `/catalog` con `sku`, código de barras y `basePriceMinor` en centavos de USD (ej. `Harina PAN 1kg` = `150`, `Refresco 2L` = `250`).
- **Resultado esperado:** `SmartCheck 10s` (`/kiosk/price-check`) muestra el precio exacto en `USD` y su conversión en `VES`.

### Task 5: Cargar Inventario Inicial en `WMS · Sucursal` (`/wms`)

- **Acción:** Recibir el stock inicial de cada producto en `/wms` (o `POST /api/branch/inventory/receive-lot`) indicando cantidad y lote.
- **Resultado esperado:** `BranchInventoryDO` refleja el saldo disponible en `GET /api/branch/inventory/balances`.

### Task 6: Prueba de Fuego en `POS · Pedido` (`/pos`)

- **Acción:**
  1. **Abrir turno** en `/pos` con fondo inicial en `USD` y `VES`.
  2. **Registrar una venta** con cliente (o consumidor final) y pago mixto (`USD_CASH` + `PAGO_MOVIL`).
  3. **Cerrar turno** al finalizar la prueba y verificar que el arqueo cuadre a cero diferencias.
- **Resultado esperado:** Venta completada (`200 OK`), stock descontado en `BranchInventoryDO` y asiento registrado sin errores de redondeo.

### Task 7: Configurar y Verificar `SmartCheck 10s` (`/kiosk/price-check`)

- **Acción:**
  1. Asegurar que cada producto cargado en `/catalog` tenga su código de barras (`barcode` / `gtin`) o `sku` asignado.
  2. Abrir **`SmartCheck 10s` (`/kiosk/price-check`)** (atajo `F4`) en una tablet o pantalla de mostrador de la tiendita.
  3. Escanear o escribir el código de barras de un producto para consultar precio y disponibilidad.
- **Resultado esperado:** Muestra el precio exacto en `USD` y su equivalente en `VES` según la tasa `rateMicros` vigente, más el stock disponible en `Casa Matriz` (`BranchInventoryDO`) en menos de 10 segundos.
