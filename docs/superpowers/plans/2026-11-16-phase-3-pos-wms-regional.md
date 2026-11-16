# Phase 3 Implementation Plan: POS Todo-Terreno, WMS Industrial y Packs Regionales (`SuperHyperArchiCRM`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use native `swarm` (`shac-phase-3-pos-wms-regional`) with `workspace: "inherit"` and strict disjoint file ownership per task. Every code step follows TDD + Receipt-Driven Development (`workerd` real via `@cloudflare/vitest-plugin`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir, verificar en `workerd` y desplegar en Cloudflare los Dominios 5 y 6 de `SuperHyperArchiCRM`: `@shac/mod-pos` (POS multimoneda, candado de turno, invariante `Cuenta=Moneda`, botón `"Restante"`, Kiosco `SmartCheck` 10s, devoluciones en 2 fases), `@shac/mod-wms` (WMS de doble partida, parser GS1-128 Modulo-10, valoración AVCO/FIFO + *landed costs*, órdenes `-BACKORDER`, flota `e-POD`), `@shac/mod-regional` (`ve`/`co`/`mx`/`us` con RIF/ISLR/HKA, CUFE SHA-384 DIAN, CFDI 4.0 SAT y Sales Tax US) y cola offline IndexedDB en `@shac/web-spa`, superando la prueba de fuego de **20 ventas multimoneda desconectadas + 3 reintentos de reconexión con 0 duplicados en `hot_idempotency_log`**.

**Architecture:** Extiende `@shac/db-d1` con la migración aditiva `0003_phase3_pos_wms_regional.sql` (22 tablas: 10 de Dominio 5, 11 de Dominio 6 y `fin_accounts` #93 para validar `account.currency === payment.currency`), amplía `BranchInventoryDO` (`@shac/actor-branch`) con `checkoutPosSaleInTx`, `closePosShiftInTx` y `approvePhysicalReturnInTx` bajo `ctx.storage.transactionSync`, e incorpora 3 módulos puros (`@shac/mod-regional`, `@shac/mod-pos`, `@shac/mod-wms`) conectados a Hono RPC + MCP (`/mcp`) y a la cola offline IndexedDB de `@shac/web-spa`.

**Tech Stack:** TypeScript 5.8 ESM (`"type": "module"`, `"sideEffects": false`), Cloudflare Workers (`workerd`), Cloudflare D1 + Drizzle ORM, Durable Objects SQLite (`BranchInventoryDO`), Hono RPC (`hc<AppRouter>`), `@modelcontextprotocol/server` + `agents`, Zod, React 19 + Vite + TanStack Router/Query (`offlineFirst` + `idb-keyval`), `@cloudflare/vitest-plugin`.

**Spec:** `SPEC.md` (§6 Fase 3), `DATA_MODEL.md` (§2.5 Dominio 5 #45–#54, §2.6 Dominio 6 #55–#65 y §2.10 #93 `fin_accounts`), `STORAGE_ARCHITECTURE_PLAN` (`docs/superpowers/specs/2026-11-16-multi-market-storage-architecture.md`) y `docs/superpowers/specs/2026-11-16-pilar-1-micro-core-pos-wms-spec.md`.

## Global Constraints

- Límite estricto `<= 300` líneas por archivo `.ts`/`.tsx` en todo `packages/` y `apps/`.
- Prohibido usar decimales `number` para dinero, cantidades físicas o tasas cambiarias; usar enteros (`*Minor`, `*Bps`, `*Micros`) y aritmética `BigInt`.
- Presupuesto de consultas D1 en listados y Kiosco `SmartCheck`: `<= 2` sentencias mediante `db.batch()`, afirmado en tests con `wrapD1WithCounter`.
- Selección explícita de columnas en cualquier `LEFT JOIN` / `INNER JOIN` dentro de `db.batch()` (evitando colisión de columnas homónimas `tenant_id`, `custom_fields`, `version`, `created_at`, `updated_at`, per Fase 2 live catch).
- Migraciones D1 estrictamente aditivas (`0` `DROP TABLE` / `DROP COLUMN`) y `0` rutas absolutas dependientes del sistema operativo.
- Todos los `package.json` deben declarar `"type": "module"` y `"sideEffects": false`; `pnpm dlx knip --strict` debe salir con `exit 0`.
- Presupuesto de tamaño del Worker en Fase 3: `wrangler deploy --dry-run` `gzip < 500 KiB` (referencia Fase 2: `167.04 KiB gzip`).

## Review Focus

1. **Descuadre `Cuenta=Moneda` en cobro mixto POS:** Enviar un pago en `VES` (`PAGO_MOVIL`) apuntando a una cuenta `fin_accounts` cuya moneda sea `USD` debe abortar con `422 ERR_CURRENCY_ACCOUNT_MISMATCH` antes de escribir en D1 o mutar `BranchInventoryDO`.
2. **Reconexión de ráfaga offline duplicada (20 ventas x 3 reintentos):** Reenviar 3 veces el mismo lote de 20 ventas multimoneda desconectadas (`60` invocaciones totales con `clientMutationId` estables) contra `BranchInventoryDO` debe producir exactamente `20` ventas confirmadas, `next_ticket_seq = 21`, `0` sobregiros de lote FEFO y `0` filas duplicadas en `hot_idempotency_log` / `hot_outbox`.
3. **Pérdida de centavos en prorrateo de *Landed Costs*:** Al prorratear un flete/aduana (ej. `1000` minor) entre 3 líneas iguales (`333 + 333 + 333 = 999`), el residuo (`+1` minor) debe asignarse determinísticamente para que la suma de capas coincida exactamente con el costo total liquidado.
4. **Código GS1-128 adulterado o lote vencido:** `parseGs1Barcode` debe rechazar GTINs con dígito verificador Modulo-10 inválido (`400 INVALID_GS1_CHECK_DIGIT`), y `checkoutPosSaleInTx` debe respetar las mismas reglas FEFO (`quarantine_status = 'RELEASED'`, no vencido).
5. **Colisión de columnas homónimas en `d1.batch()` con `JOIN`:** Todo listado con `JOIN` en `@shac/mod-pos` y `@shac/mod-wms` debe proyectar alias explícitos en `.select({ ... })` en lugar de seleccionar objetos de tabla completos en ambos lados del join.

---

### Task 1: `@shac/db-d1` — Esquemas Drizzle Dominios 5, 6 + `fin_accounts` & Migración `0003` (`db-author-3`)

**Files:**
- Create: `packages/db-d1/src/schema/pos.ts` (tablas #45–#49 y #93 `fin_accounts`)
- Create: `packages/db-d1/src/schema/commerce-orders.ts` (tablas #50–#54)
- Create: `packages/db-d1/src/schema/wms-warehouse.ts` (tablas #55–#60)
- Create: `packages/db-d1/src/schema/wms-fleet.ts` (tablas #61–#65)
- Modify: `packages/db-d1/src/scope.ts`, `packages/db-d1/src/index.ts`
- Create: `packages/db-d1/migrations/0003_phase3_pos_wms_regional.sql`
- Test: `packages/db-d1/test/phase3-schema.test.ts`

**Interfaces:**
- Consumes: `packages/db-d1/src/schema/iam.ts`, `packages/db-d1/src/scope.ts`, `packages/db-d1/migrations/0002_phase2_universal_trunk.sql`.
- Produces: 22 tablas Drizzle exportadas desde `@shac/db-d1` (`posRegistersAndDisplays`, `posCashClosings`, `comChannelsAndStores`, `comCartsAndPaylinks`, `comQuotes`, `finAccounts`, `comOrders`, `comOrderLines`, `comInvoicesAndFiscal`, `comPayments`, `comReturnsAndCreditMemos`, `wmsWarehousesAndZones`, `wmsLocations`, `wmsPackagesAndLots`, `wmsPickings`, `wmsStockMoves`, `wmsValuationAndLandedCosts`, `wmsReorderingAndPutawayRules`, `wmsQcAndCycleCounts`, `wmsPurchaseOrders`, `wmsStockRequestsAndChat`, `wmsFleetAndDeliveries`) y `ShacD1Database` actualizado con los 54 esquemas acumulados.

- [ ] **Step 1: Escribir el test fallido en `packages/db-d1/test/phase3-schema.test.ts`**
  Aserciones: aplicar migraciones `0001`, `0002` y `0003` sobre `env.DB` (`workerd`), verificar inserción y lectura tipada de `fin_accounts`, `com_orders` + `com_order_lines` + `com_payments` + `com_invoices_and_fiscal`, y `wms_warehouses_and_zones` + `wms_locations` + `wms_pickings` + `wms_stock_moves`, validando que `SELECT` sin floats preserve exactitud entera.
- [ ] **Step 2: Ejecutar `pnpm --filter @shac/db-d1 test:run` para confirmar fallo inicial**
  Expected: FAIL por ausencia de `0003_phase3_pos_wms_regional.sql` y exportaciones en `@shac/db-d1`.
- [ ] **Step 3: Implementar `pos.ts`, `commerce-orders.ts`, `wms-warehouse.ts`, `wms-fleet.ts` (`<= 300` líneas c/u) y migración `0003_phase3_pos_wms_regional.sql`**
  Siguiendo `DATA_MODEL.md` §§2.5, 2.6 y #93 al pie de la letra con índices compuestos encabezados por `tenant_id` (`UNIQUE` en `fin_accounts(tenant_id, code)`, `com_orders(tenant_id, order_number)` y `com_orders(tenant_id, client_mutation_id)`, `com_payments(tenant_id, idempotency_key)`, `wms_stock_moves(tenant_id, idempotency_key)`).
- [ ] **Step 4: Actualizar `scope.ts` y `index.ts`, ejecutar `typecheck`, `test:run` y guardias SQL (`! rg -i "DROP TABLE|DROP COLUMN"`)**
  Run: `pnpm --filter @shac/db-d1 typecheck && pnpm --filter @shac/db-d1 test:run && pnpm --filter @shac/mod-customers test:run && pnpm --filter @shac/mod-catalog test:run`
  Expected: PASS (exit 0).
- [ ] **Step 5: Marcar `[x]` y preparar handoff hacia `regional-author`, `pos-author`, `wms-author` y `verifier-3`**

---

### Task 2: `@shac/actor-branch` — Checkout POS en Turno, Cierre de Turno, Devolución Física y Test 20 Ventas x 3 Reintentos (`actor-author-2`)

**Files:**
- Create: `packages/actor-branch/src/pos-contracts.ts`
- Create: `packages/actor-branch/src/pos-checkout.ts`
- Create: `packages/actor-branch/src/pos-close-and-return.ts`
- Create: `packages/actor-branch/src/http-router.ts` (extracción de rutas HTTP de `src/index.ts` para mantener `<= 300` líneas)
- Modify: `packages/actor-branch/src/index.ts`, `packages/actor-branch/src/contracts.ts` (si requiere tipo `JsonValue`)
- Test: `packages/actor-branch/test/pos-offline-sync.test.ts`

**Interfaces:**
- Consumes: `packages/actor-branch/src/{schema.ts,idempotency.ts,outbox.ts,fefo-allocate.ts,fefo-receive.ts,pos-shift.ts}`.
- Produces: `checkoutPosSaleInTx(sql, input): CheckoutPosSaleResult`, `closePosShiftInTx(sql, input): ClosePosShiftResult`, `approvePhysicalReturnInTx(sql, input): ApprovePhysicalReturnResult` y métodos/rutas DO `/pos-checkout`, `/pos-close`, `/pos-return-approve`.

- [ ] **Step 1: Escribir el test fallido en `packages/actor-branch/test/pos-offline-sync.test.ts`**
  Aserciones (Recibo Obligatorio de Fase 3 + Review Focus #1 y #2):
  1. Abrir turno POS en `hot_pos_shifts` y recibir lotes `FEFO` (`25` unidades `LOT-EARLY`, `15` `LOT-LATE`).
  2. Enviar un pago con `accountCurrency: 'USD'` y `paymentCurrency: 'VES'` -> verificar rechazo `422 ERR_CURRENCY_ACCOUNT_MISMATCH` sin alterar saldos ni `next_ticket_seq`.
  3. Simular **20 ventas multimoneda desconectadas** (`USD` efectivo + `VES` Pago Móvil) con `clientMutationId` únicos `offline_sale_01..20`, y ejecutar **3 reintentos de reconexión completos** (`60` peticiones): verificar `next_ticket_seq === 21`, `hot_idempotency_log` con exactamente `20` filas de `branch.pos.checkout` (`0` duplicados), `hot_outbox` con `20` eventos `POS_SALE_COMPLETED` (`0` duplicados), y saldos FEFO exactos.
  4. Cerrar turno (`closePosShiftInTx`) verificando transición `CLOSED`, conteo físico vs esperado y `409 SHIFT_CLOSED` al intentar vender luego.
  5. Aprobar devolución física (`approvePhysicalReturnInTx`) en modos `RESTOCK` (`hot_bin_balances`) y `SCRAP` / `QUARANTINE`.
- [ ] **Step 2: Ejecutar `pnpm --filter @shac/actor-branch test:run` para confirmar fallo inicial**
- [ ] **Step 3: Implementar `pos-contracts.ts`, `pos-checkout.ts`, `pos-close-and-return.ts`, `http-router.ts` y conectar `src/index.ts` (`<= 300` líneas c/u)**
  Ejecutando toda la lógica dentro de `this.ctx.storage.transactionSync(() => ...)`:
  - Validar `shift.status === 'OPEN'` (`409 SHIFT_NOT_OPEN`), `accountCurrency === paymentCurrency` (`422 ERR_CURRENCY_ACCOUNT_MISMATCH`), consultar `hot_idempotency_log` por `clientMutationId`, descontar ítems con inventario vía `allocateFefoInTx` reutilizando lógica FEFO interna sin doble idempotencia (o usando sufijo determinista `line:${i}`), actualizar acumulados JSON en `hot_pos_shifts` (`BigInt`), emitir `POS_SALE_COMPLETED` en `hot_outbox` y guardar recibo idempotente.
- [ ] **Step 4: Ejecutar `pnpm --filter @shac/actor-branch typecheck && pnpm --filter @shac/actor-branch test:run`**
  Expected: PASS (incluyendo `branch-actor.concurrency.test.ts` + `pos-offline-sync.test.ts`).
- [ ] **Step 5: Marcar `[x]` y notificar a `@verifier-3` y `@pos-author`**

---

### Task 3: `@shac/mod-regional` — Packs Fiscales y de Pago (`ve`/`co`/`mx`/`us`) (`regional-author`)

**Files:**
- Create: `packages/modules/regional/package.json` (`"type": "module"`, `"sideEffects": false`)
- Create: `packages/modules/regional/{tsconfig.json,vitest.config.ts,wrangler.test.jsonc}`
- Create: `packages/modules/regional/src/tax-ids.ts`
- Create: `packages/modules/regional/src/fiscal-engines.ts`
- Create: `packages/modules/regional/src/commands/validate-tax-id.ts`
- Create: `packages/modules/regional/src/commands/stamp-invoice.ts`
- Create: `packages/modules/regional/src/index.ts`
- Test: `packages/modules/regional/test/regional.commands.test.ts`

**Interfaces:**
- Consumes: `@shac/kernel`, `@shac/db-d1` (`comInvoicesAndFiscal`, `checkIdempotency`, `buildIdempotencyInsert`, `buildActionLogInsert`).
- Produces: `modRegionalManifest` (`id: 'regional'`), `validateRegionalTaxId(countryOrPack, taxIdType, rawValue)`, `computeRegionalFiscalBreakdown(...)`, `regionalTaxIdValidateCommand` (`POST /api/regional/tax-id/validate`), `regionalFiscalStampCommand` (`POST /api/regional/fiscal/stamp`).

- [ ] **Step 1: Escribir el test fallido en `packages/modules/regional/test/regional.commands.test.ts`**
  Aserciones sobre `workerd`:
  - Validación `ve` (`J-40123456-7`, `V-18.444.555`), `co` (`NIT` con dígito Modulo-11), `mx` (`RFC` 12/13 caracteres), `us` (`EIN` `XX-XXXXXXX`) + rechazo `422 INVALID_TAX_ID`.
  - Sellado fiscal en `com_invoices_and_fiscal`: `ve` (IVA `1600`/`800`/`0` bps, retención ISLR en bps, payload Z HKA), `co` (`dianCufeSha384` calculado con `crypto.subtle.digest('SHA-384', ...)` en `workerd` + QR DIAN), `mx` (`satCfdiUuid` + QR SAT + referencias OXXO 14 dígitos / SPEI CLABE 18 dígitos), `us` (Sales Tax por tasa jurisdiccional + exención `isTaxExempt`).
  - Idempotencia (`409 IDEMPOTENCY_CONFLICT`) y aislamiento multi-tenant (`404`/`403`).
- [ ] **Step 2: Ejecutar `pnpm --filter @shac/mod-regional test:run` para confirmar fallo inicial**
- [ ] **Step 3: Implementar `tax-ids.ts`, `fiscal-engines.ts`, comandos y `index.ts` (`<= 300` líneas c/u, enteros `BigInt`)**
- [ ] **Step 4: Ejecutar `pnpm --filter @shac/mod-regional typecheck && pnpm --filter @shac/mod-regional test:run`**
- [ ] **Step 5: Marcar `[x]` y notificar a `@verifier-3` y `@pos-author`**

---

### Task 4: `@shac/mod-pos` — POS Todo-Terreno, Botón `"Restante"`, Kiosco `SmartCheck` 10s y Devoluciones 2 Fases (`pos-author`)

**Files:**
- Create: `packages/modules/pos/package.json` (`"type": "module"`, `"sideEffects": false`)
- Create: `packages/modules/pos/{tsconfig.json,vitest.config.ts,wrangler.test.jsonc}`
- Create: `packages/modules/pos/src/tender-engine.ts`
- Create: `packages/modules/pos/src/commands/pos-schemas.ts`
- Create: `packages/modules/pos/src/commands/pos-shifts.ts`
- Create: `packages/modules/pos/src/commands/pos-checkout.ts`
- Create: `packages/modules/pos/src/commands/smartcheck-and-returns.ts`
- Create: `packages/modules/pos/src/index.ts`
- Test: `packages/modules/pos/test/pos.commands.test.ts`

**Interfaces:**
- Consumes: `@shac/kernel`, `@shac/db-d1`, `@shac/actor-branch` (contratos), `@shac/mod-catalog` (`resolveFiveLayerPrice`).
- Produces: `modPosManifest` (`id: 'pos'`), `computeRemainingTender(...)`, `posShiftsOpenCommand` (`POST /api/pos/shifts/open`), `posShiftsCloseCommand` (`POST /api/pos/shifts/close`), `posSalesCheckoutCommand` (`POST /api/pos/sales/checkout`), `posKioskSmartCheckCommand` (`GET /api/pos/kiosk/smartcheck`), `posReturnsSettleCommand` (`POST /api/pos/returns/settle`).
- **Regla de DO Binding en `ExecutionContext`:** Extender `ExecutionContext` (en `packages/kernel/src/contracts.ts` opcional `branchDo?: BranchDoStubResolver` — o pasar stub en `ctx` opcional sin romper Fase 1/2!) o recibir `branchActor` en helper; para mantener CERO cambios disruptivos en `@shac/kernel`, `pos-checkout.ts` / `pos-shifts.ts` / `smartcheck-and-returns.ts` aceptarán un puerto ligero opcional en `ExecutionContext` (`branchDoNamespace?: DurableObjectNamespace`) añadido de forma backwards-compatible en `@shac/kernel/src/contracts.ts` (o inyectado por `apps/node-worker`) **solo si** el coordinador aprueba esa adición mínima, O bien los comandos POS reciben/invocan un `BranchClient` registrado en contexto. **(Definido aquí de forma explícita: añadir campo opcional `branchDo?: { getByBranchKey(key: string): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } }` en `ExecutionContext` en `packages/kernel/src/contracts.ts`, para que `mod-pos` y `mod-wms` invoquen `BranchInventoryDO` de forma tipada y testeable en `workerd` sin acoplarse a `Env` global!)**

- [ ] **Step 1: Escribir el test fallido en `packages/modules/pos/test/pos.commands.test.ts`**
  Aserciones sobre `workerd` (D1 + `BranchInventoryDO` real):
  - `computeRemainingTender`: orden de `2500` minor USD con pago parcial `1000` minor USD + tasa `BCV` `36500000` micro (`36.5 Bs/USD`), calcula exactamente `54750` minor `VES` para el botón `"Restante"`.
  - Invariante `Cuenta=Moneda` (Review Focus #1): pago en `VES` contra `fin_accounts` en `USD` lanza `422 ERR_CURRENCY_ACCOUNT_MISMATCH` (`<= 2` queries D1, 0 mutaciones).
  - Venta mixta completa (`USD` efectivo + `VES` Pago Móvil) -> ejecuta turno `OPEN` + descuento FEFO en `BranchInventoryDO` + batch D1 en `com_orders`, `com_order_lines`, `com_payments` + actualización de saldo en `fin_accounts`, e idempotencia con `clientMutationId`.
  - Kiosco `SmartCheck` (`GET /api/pos/kiosk/smartcheck`): devuelve `autoCloseSeconds: 10`, precio desglosado con IVA en `USD` y `VES` usando `cat_currencies_and_rates` en `<= 2` queries D1 (`wrapD1WithCounter`).
  - Devolución en 2 fases (`pos.returns.settle`): reingresa stock físico en `BranchInventoryDO` y emite `com_returns_and_credit_memos` (`credit_memo_issued` o reembolso en `fin_accounts` con validación `Cuenta=Moneda`).
- [ ] **Step 2: Ejecutar `pnpm --filter @shac/mod-pos test:run` para confirmar fallo inicial**
- [ ] **Step 3: Añadir puerto opcional `branchDo` en `packages/kernel/src/contracts.ts` e implementar `tender-engine.ts`, comandos POS y `index.ts` (`<= 300` líneas c/u)**
- [ ] **Step 4: Ejecutar `pnpm --filter @shac/kernel typecheck && pnpm --filter @shac/mod-pos typecheck && pnpm --filter @shac/mod-pos test:run`**
- [ ] **Step 5: Marcar `[x]` y notificar a `@verifier-3` y `@app-author-2`**

---

### Task 5: `@shac/mod-wms` — WMS Doble Partida, GS1-128, AVCO + Landed Costs, `-BACKORDER` y `e-POD` (`wms-author`)

**Files:**
- Create: `packages/modules/wms/package.json` (`"type": "module"`, `"sideEffects": false`)
- Create: `packages/modules/wms/{tsconfig.json,vitest.config.ts,wrangler.test.jsonc}`
- Create: `packages/modules/wms/src/gs1-parser.ts`
- Create: `packages/modules/wms/src/valuation-engine.ts`
- Create: `packages/modules/wms/src/commands/pickings-and-backorder.ts`
- Create: `packages/modules/wms/src/commands/landed-costs-and-epod.ts`
- Create: `packages/modules/wms/src/index.ts`
- Test: `packages/modules/wms/test/wms.commands.test.ts`

**Interfaces:**
- Consumes: `@shac/kernel`, `@shac/db-d1`, `@shac/actor-branch` (`BranchInventoryDO` para recibos/despachos FEFO).
- Produces: `modWmsManifest` (`id: 'wms'`), `parseGs1Barcode(raw)`, `computeAvcoValuation(...)`, `allocateLandedCosts(...)`, `wmsPickingsProcessCommand` (`POST /api/wms/pickings/process`), `wmsPickingsListCommand` (`GET /api/wms/pickings`), `wmsLandedCostsAllocateCommand` (`POST /api/wms/landed-costs/allocate`), `wmsFleetCompleteEpodCommand` (`POST /api/wms/fleet/epod`).

- [ ] **Step 1: Escribir el test fallido en `packages/modules/wms/test/wms.commands.test.ts`**
  Aserciones sobre `workerd`:
  - `parseGs1Barcode`: decodifica `(01)07501031311309(10)LOT2026A(17)271231(21)SER991` validando Modulo-10, `expiryEpochMs` y rechazando dígito verificador adulterado con `400 INVALID_GS1_CHECK_DIGIT` (Review Focus #4).
  - `wms.pickings.process` parcial (`demanded: 10, done: 6`): crea movimiento doble partida en `wms_stock_moves`, actualiza inventario y genera automáticamente orden hija en `wms_pickings` con sufijo `-BACKORDER` por las `4` unidades restantes.
  - `wms.pickings.list`: usa `db.batch()` y alias explícitos sin colisión en JOIN (`<= 2` queries D1 con `wrapD1WithCounter`).
  - `wms.landed_costs.allocate` (`by_value`, `by_weight`): `1000` minor prorrateados entre 3 líneas iguales suman exactamente `1000` (`334 + 333 + 333`) y actualizan `wms_valuation_and_landed_costs` AVCO en enteros `BigInt` (Review Focus #3).
  - `wms.fleet.complete_epod`: valida peso máximo / refrigeración del vehículo (`422 VEHICLE_CAPACITY_EXCEEDED` / `422 COLD_CHAIN_REQUIRED`), registra firma SVG + `epodPhotoR2Key` + coordenadas en `wms_fleet_and_deliveries`.
- [ ] **Step 2: Ejecutar `pnpm --filter @shac/mod-wms test:run` para confirmar fallo inicial**
- [ ] **Step 3: Implementar `gs1-parser.ts`, `valuation-engine.ts`, comandos WMS y `index.ts` (`<= 300` líneas c/u)**
- [ ] **Step 4: Ejecutar `pnpm --filter @shac/mod-wms typecheck && pnpm --filter @shac/mod-wms test:run`**
- [ ] **Step 5: Marcar `[x]` y notificar a `@verifier-3` y `@app-author-2`**

---

### Task 6: Integración Edge Worker, Cola Offline `@shac/web-spa`, RDD Final y Despliegue en Vivo (`app-author-2`)

**Files:**
- Modify: `apps/node-worker/package.json` (añadir `@shac/mod-regional`, `@shac/mod-pos`, `@shac/mod-wms`)
- Create: `apps/node-worker/src/pos-wms-registry.ts`
- Modify: `apps/node-worker/src/command-registry.ts`, `apps/node-worker/src/router.ts`, `apps/node-worker/src/branch-routes.ts`
- Create: `apps/node-worker/test/phase3.worker.test.ts`
- Create: `apps/web-spa/src/lib/offlineQueue.ts`
- Create: `apps/web-spa/src/views/PosWmsViews.tsx`
- Modify: `apps/web-spa/src/main.tsx`, `apps/web-spa/test/spa.offline.test.ts`, `knip.json`

**Interfaces:**
- Consumes: `modRegionalManifest`, `modPosManifest`, `modWmsManifest`, `BranchInventoryDO`, `AppRouter`.
- Produces: rutas REST `/api/regional/*`, `/api/pos/*`, `/api/wms/*` + `/api/branch/pos/*`, herramientas MCP en `/mcp`, cola offline `enqueueOfflineMutation` / `flushOfflineQueue` en `apps/web-spa/src/lib/offlineQueue.ts`, y rutas SPA `/pos`, `/kiosk/price-check` (`SmartCheck` 10s), `/wms`.

- [ ] **Step 1: Escribir pruebas fallidas en `apps/node-worker/test/phase3.worker.test.ts` y `apps/web-spa/test/spa.offline.test.ts`**
  Aserciones:
  - Integración completa REST + MCP + D1 (`0001`+`0002`+`0003`) + `BranchInventoryDO` sobre `workerd`: abrir caja -> venta multimoneda USD+VES con botón `"Restante"` -> verificar rechazo `403 MODULE_NOT_ENABLED` cuando `pos`/`wms`/`regional` están apagados en `CONFIG_KV` -> picking parcial `-BACKORDER` -> sello fiscal `ve`/`co`/`mx` -> Kiosco `SmartCheck` (`queryCount <= 2`).
  - Cola offline IndexedDB (`apps/web-spa/test/spa.offline.test.ts`): encolar 20 ventas con `clientMutationId` únicos offline y simular 3 flushes de reconexión verificando vaciado seguro al recibir `200` / `409 IDEMPOTENCY_CONFLICT` y conservación ante fallos `503`.
- [ ] **Step 2: Conectar paquetes en `apps/node-worker` (inyectando `branchDo` en `ExecutionContext` de `router.ts`) y construir UI `/pos`, `/kiosk/price-check`, `/wms` + `offlineQueue.ts` en `apps/web-spa`**
  Manteniendo todo archivo `<= 300` líneas y `knip.json` actualizado.
- [ ] **Step 3: Ejecutar batería RDD completa y presupuesto de borde**
  - `pnpm -r typecheck` -> `exit 0`
  - `pnpm dlx knip --strict` -> `exit 0`
  - `pnpm -r test:run` -> `exit 0` (todos los paquetes incluyendo 20 ventas x 3 reintentos)
  - `pnpm --filter @shac/web-spa build` -> `exit 0`
  - `pnpm --filter @shac/node-worker exec wrangler deploy --dry-run --outdir .wrangler/dist` -> `exit 0`, **`gzip < 500 KiB`**
  - `! rg -i "DROP TABLE|DROP COLUMN" packages/db-d1/migrations/` -> `0` matches
  - Guard de portabilidad (0 rutas absolutas de OS en `packages`, `apps`, `docs`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `knip.json`) -> `0` matches
- [ ] **Step 4: Actualizar `DECISIONS.md` si aplica, marcar `- [x]` en este plan y crear commit atómico en `main`**
- [ ] **Step 5: Aplicar `0003_phase3_pos_wms_regional.sql` en `shac-primary` D1 remoto, activar `regional` y `pos` en `CONFIG_KV` `profile:current`, ejecutar `wrangler deploy` en `PC911 IT Services Global` y verificar endpoints de Fase 3 en vivo**
