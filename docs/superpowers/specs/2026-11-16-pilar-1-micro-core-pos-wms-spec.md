# Especificación Detallada — Pilar 1: Micro-Core, POS Todo-Terreno y WMS Industrial

**Carpeta Drive Asociada:** `02_Micro-Core_POS_y_WMS`  
**Paquetes Cubiertos:** `@shac/kernel`, `@shac/db-d1`, `@shac/actor-branch`, `@shac/mod-iam`, `@shac/mod-customers`, `@shac/mod-catalog`, `@shac/mod-pos`, `@shac/mod-wms`, `@shac/mod-regional`, `@shac/web-spa`

---

## 1. Cadena de Ejecución en `@shac/kernel` (`< 0.8 ms` CPU)

1. **`profileLoader`:** Caché en memoria del isolate (TTL `60 s`) respaldada por `CONFIG_KV.get("profile:current", "json")`. Hidrata vocabulario dinámico, monedas activas, `regionPack` y módulos habilitados.
2. **`moduleGate`:** Corta en seco con `403 MODULE_NOT_ENABLED` cualquier invocación REST o MCP cuyo `moduleId` no figure en `profile.activeModules`, protegiendo cuotas de D1.
3. **`authMiddleware` (WebCrypto Nativo):**
   - Sesiones humanas/portal vía JWT EdDSA (`crypto.subtle.verify`) y contraseñas con `crypto.subtle.deriveBits` (PBKDF2-HMAC-SHA256 asíncrono).
   - Llaves máquina `mk_live_*` verificadas por hash SHA-256 en `SESSION_KV`.
   - **Cambio rápido de operador POS/Garita:** PIN numérico de 4 dígitos ligado a la sucursal activa.
   - **Delegación Temporal Auditable:** PIN de 6 dígitos emitido por un supervisor/profesional con expiración estricta (`4h`, `8h`, `24h`), inyectando `actor.type = 'delegated_staff'` y `actor.delegatedById`.
4. **Doble Exposición Automática (`defineCommand`):** Registra la ruta tipada en Hono RPC (`/api/...`) y, si `mcp.expose === true`, registra la herramienta en `createMcpHandler` (`/mcp`). Cuando `mcp.requiresProposalCard === true`, las llamadas de agentes IA generan una propuesta firmada en `kernel_ai_proposals` con `diff` antes/después para confirmación humana en 1 clic.

---

## 2. Reglas Operativas del POS Todo-Terreno (`@shac/mod-pos`)

### 2.1 Candado de Sesión y Cuentas Multi-Divisa
- Ninguna venta, gasto de caja chica ni devolución puede ejecutarse si el cajero/registro no posee un turno `OPEN` en `hot_pos_shifts` dentro de `BranchInventoryDO`.
- Al abrir turno se declaran los fondos iniciales separados por moneda operativa (ej. `USD`, `VES`, `EUR` o `COP`/`MXN`).
- **Invariante Cuenta=Moneda:** Todo método de pago apunta a una `financial_account` cuya divisa debe coincidir exactamente con la divisa del pago (`ERR_CURRENCY_ACCOUNT_MISMATCH` en caso contrario).

### 2.2 Cobro Mixto Instantáneo y Botón `"Restante"`
- Una orden POS acepta un arreglo `payments[]` combinando en una misma transacción múltiples métodos y divisas (ej. Efectivo USD + Pago Móvil Bs + BioPago / Punto de Venta, o Efectivo + Square + Gift Card).
- El motor determinista `computeRemainingTender(orderTotalMinor, existingPayments, targetCurrency, rateMicros)` calcula al instante el saldo exacto pendiente en la moneda seleccionada (alimentando el botón de 1 clic **"Restante"**) y determina el vuelto exacto por divisa disponible en gaveta.

### 2.3 Kiosco `SmartCheck`, Habladores y Alta Rápida
- **Modo `SmartCheck` (`/kiosk/price-check`):** Rol restringido `kiosk_device` con foco permanente de lector láser/cámara, marquesina de tasa cambiaria oficial vigente, precio desglosado con impuestos en todas las monedas activas y temporizador de **autocierre a los 10 segundos**.
- **Carrito de Habladores (`labelCart`):** Acumula SKUs manuales o filtrados por cambio de precio/categoría y renderiza plantillas listas para impresora térmica (`2.8"x1.8"` con código de barras + QR) o pliegos de góndola con doble moneda y fecha de emisión.
- **Padrón Fiscal Instantáneo:** Al digitar documento (`Cédula/RIF`, `NIT`, `RFC`), busca primero en D1/IndexedDB local; si no existe y hay red, consulta el conector regional, persiste el tercero automáticamente para futuras ventas offline o permite seleccionar **"Consumidor Final"** en 1 toque.

### 2.4 Devoluciones Separadas en 2 Fases
1. **Fase Física (`approveReturn` en `BranchInventoryDO`):** Reingresa las unidades aptas a `hot_bin_balances` (o las envía a ubicación `scrap`/`quarantine`) dejando traza en `hot_idempotency_log`.
2. **Fase Financiera (`settleReturn`):** Emite `CreditMemo` reutilizable o registra el egreso en la cuenta financiera de la divisa correspondiente dentro del turno abierto.

---

## 3. WMS de Doble Partida, GS1-128 FEFO y Flota (`@shac/mod-wms`)

### 3.1 Decodificación GS1-128 y Despacho FEFO en `BranchInventoryDO`
- El parser puro `parseGs1Barcode(raw)` extrae en tiempo constante `gtin` `(01)`, `lotCode` `(10)`, `expiryEpochMs` `(17)` y `serialNumber` `(21)` validando el dígito verificador Modulo-10.
- En productos `LOT_EXPIRY`, `checkoutSale` y `allocateWavePick` seleccionan dentro de `ctx.storage.transactionSync` los lotes activos no vencidos ordenados por `expiry_date ASC` (**FEFO**), abortando si la suma disponible es insuficiente.

### 3.2 Ubicaciones Virtuales, Costos en Destino y Backorders
- Soporta ubicaciones físicas (`storage`, `refrigerated`, `frozen`, `security_cage`, `buffer`, `shipping`) y ubicaciones contables virtuales (`vendor`, `customer`, `transit`, `scrap`, `inventory_loss`).
- **Valoración AVCO / FIFO + *Landed Costs*:** Cada recepción actualiza el costo promedio ponderado entero (`unitCostMinor`) y permite prorratear facturas de flete, aduana y seguro por valor, peso (`grams`) o volumen (`cm3`).
- **Despachos Parciales:** Si una orden mayorista se despacha parcialmente, se genera de forma atómica la orden hija con sufijo `-BACKORDER` conservando precios contractuales.
- **Reparto con `e-POD`:** Valida capacidad del vehículo (pallets, peso máximo y cadena de frío), registra rastro GPS y cierra la entrega con firma digital + evidencia fotográfica en R2.

---

## 4. Packs Fiscales y de Pago Regionales (`@shac/mod-regional`)

| `regionPack` | Reglas Fiscales Integradas | Métodos de Pago y Conectores Soportados |
| :--- | :--- | :--- |
| `ve` | RIF (`J/V/E/G`), IVA (`16%`, `8%`, `0%`), retención `ISLR`, tasas BCV (`USD`/`EUR`) | Pago Móvil, BioPago, Punto de Venta, Zelle, Efectivo `USD`/`VES`, puente serial HKA |
| `co` | NIT/CC, IVA `19%`, generación de **CUFE SHA-384** y QR DIAN | Nequi Push, Daviplata OTP, PSE, QR Bancolombia, llave Bre-B, Wompi |
| `mx` | RFC, IVA `16%`, estructura **CFDI 4.0** con UUID y QR SAT | OXXO Pay (código 14 dígitos), SPEI (CLABE 18 dígitos + CEP), CoDi, Dimo |
| `us` | EIN, Sales Tax por jurisdicción y exenciones B2B | Square Terminal/Web, Stripe, ACH sin comisión, Apple/Google Pay, House Account |
