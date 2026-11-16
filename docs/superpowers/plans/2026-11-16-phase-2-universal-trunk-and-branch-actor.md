# Phase 2 Implementation Plan: Tronco Universal (`Parties`, Catálogo, `v_cf_*`) y `BranchInventoryDO`

> **For agentic workers:** Executed via Native Swarm (`shac-phase-2-trunk-and-actor`). Follow `AGENTS.md` invariants cleanly (`<= 300` lines/file, integer money `*Minor`/`*Bps`/`*Micros`, `<= 2` D1 queries per list via `db.batch()`, strict additive migrations, zero OS paths, real `workerd` tests).

**Goal:** Build and verify on `workerd` + deploy to `PC911 IT Services Global`:
1. `@shac/db-d1` Phase 2 additive migration (`0002_phase2_universal_trunk.sql`), Drizzle schemas for Dominios 1 (custom fields/locks + `FTS5`), 2 (`crm_parties`, `crm_party_*`, `crm_deals`, `crm_conflict_checks`, `hr_*`), 3 (`cat_*`), and dynamic `v_cf_*` SQL builder.
2. `@shac/actor-branch` (`BranchInventoryDO`) with the 8 hot SQLite tables and transactional **FEFO** allocation (`ctx.storage.transactionSync`), verified by the 50-concurrent-operations stress test.
3. `@shac/mod-customers` (`parties.upsert`, `parties.list`, `links.create`, `deals.create`, `conflicts.check`).
4. `@shac/mod-catalog` (pure integer 5-layer pricing + margin guardrail + BCV `rateMicros` + Omnibus 30d + `products.upsert`, `products.list`, `pricing.quote`, `rates.upsert`, `labels.batch`).
5. Integration in `@shac/node-worker` (REST + MCP + `/api/branch/*` DO proxy) & `@shac/web-spa` (`/parties` & `/catalog`), full RDD verification, live remote migration, `CONFIG_KV` update, deploy, and live smoke checks.

---

## Task 1: `@shac/db-d1` Phase 2 Schemas, `v_cf_*`, `FTS5` & Migration `0002` (`db-author`)

- [x] **Step 1:** Create `packages/db-d1/src/schema/custom-fields.ts` (`kernel_custom_field_defs`, `kernel_custom_records`, `kernel_record_locks`, `buildVirtualColumnSql`) `<= 300` lines.
- [x] **Step 2:** Create `packages/db-d1/src/schema/parties.ts` (tables 15–20 of `DATA_MODEL.md`) `<= 300` lines.
- [x] **Step 3:** Create `packages/db-d1/src/schema/crm-hr.ts` (tables 21–26 of `DATA_MODEL.md`) `<= 300` lines.
- [x] **Step 4:** Create `packages/db-d1/src/schema/catalog.ts` (tables 27–31 of `DATA_MODEL.md`) `<= 300` lines.
- [x] **Step 5:** Create `packages/db-d1/src/schema/pricing.ts` (tables 32–36 of `DATA_MODEL.md`) `<= 300` lines.
- [x] **Step 6:** Update `packages/db-d1/src/scope.ts`, `packages/db-d1/src/idempotency.ts` (shared `checkIdempotency`, `buildIdempotencyInsert`, `buildActionLogInsert`), and `packages/db-d1/src/index.ts`.
- [x] **Step 7:** Create additive migration `packages/db-d1/migrations/0002_phase2_universal_trunk.sql` (zero `DROP TABLE` / `DROP COLUMN`) including `kernel_custom_records_fts` (`FTS5`).
- [x] **Step 8:** Create real `workerd` D1 schema test `packages/db-d1/test/phase2-schema.test.ts` verifying `0001` + `0002`, `buildVirtualColumnSql` (`v_cf_registro_sanitario` on `cat_products`), and `FTS5` `MATCH`.
- [x] **Step 9:** Run `pnpm --filter @shac/db-d1 typecheck` and `pnpm --filter @shac/db-d1 test:run`.

## Task 2: `@shac/actor-branch` (`BranchInventoryDO` + 8 Hot SQLite Tables) (`actor-author`)

- [x] **Step 1:** Scaffold `packages/actor-branch/{package.json,tsconfig.json,vitest.config.ts,wrangler.test.jsonc}` with `"type": "module"`, `"sideEffects": false`, and `@cloudflare/vitest-plugin`.
- [x] **Step 2:** Implement `packages/actor-branch/src/schema.ts` (`ensureHotTables(sql)` creating all 8 hot tables `hot_bin_balances`, `hot_inventory_lots`, `hot_pos_shifts`, `hot_space_locks`, `hot_queue_board`, `hot_access_passes`, `hot_idempotency_log`, `hot_outbox`).
- [x] **Step 3:** Implement `packages/actor-branch/src/fefo-engine.ts` (`receiveLotInTx`, `allocateFefoInTx` with strict FEFO order `COALESCE(expiry_epoch_ms, 9007199254740991) ASC, received_at ASC, lot_id ASC` and `hot_idempotency_log` dedup).
- [x] **Step 4:** Implement `packages/actor-branch/src/space-and-shift.ts` (`acquireSpaceLockInTx`, `openPosShiftInTx`) and `packages/actor-branch/src/index.ts` (`BranchInventoryDO` wrapping calls in `ctx.storage.transactionSync`).
- [x] **Step 5:** Implement `packages/actor-branch/test/branch-actor.concurrency.test.ts` with the mandatory **50-concurrent FEFO stress test** (`LOT-EARLY` 30 + `LOT-LATE` 10 -> 40 pass FEFO order, 10 fail `409 INSUFFICIENT_STOCK`, final balances `0`, zero outbox duplicates on idempotent retry).
- [x] **Step 6:** Run `pnpm --filter @shac/actor-branch typecheck` and `pnpm --filter @shac/actor-branch test:run`.

## Task 3: `@shac/mod-customers` (Dominio 2) (`customers-author`)

- [x] **Step 1:** Scaffold `packages/modules/customers/{package.json,tsconfig.json,vitest.config.ts}`.
- [x] **Step 2:** Implement `src/commands/parties-upsert.ts`, `src/commands/parties-list.ts` (`db.batch()` `<= 2` queries), `src/commands/party-links.ts`, `src/commands/deals-and-conflicts.ts`, and `src/index.ts` (`<= 300` lines/file).
- [x] **Step 3:** Implement `test/customers.commands.test.ts` (multi-role "María Gómez", tenant isolation, `wrapD1WithCounter` `<= 2` queries, idempotency) and run `typecheck` + `test:run`.

## Task 4: `@shac/mod-catalog` (Dominio 3) (`catalog-author`)

- [x] **Step 1:** Scaffold `packages/modules/catalog/{package.json,tsconfig.json,vitest.config.ts}`.
- [x] **Step 2:** Implement pure integer `src/pricing-engine.ts` (`resolveFiveLayerPrice`, `marginBps`, `lowest30dMinor`, `rateMicros`).
- [x] **Step 3:** Implement `src/commands/products.ts`, `src/commands/quote-price.ts`, `src/commands/rates-and-labels.ts`, and `src/index.ts` (`<= 300` lines/file).
- [x] **Step 4:** Implement `test/catalog.commands.test.ts` (5-layer cascade, margin floor rejection, BCV `rateMicros`, label batches, `<= 2` queries D1) and run `typecheck` + `test:run`.

## Task 5: Integration in `@shac/node-worker` & `@shac/web-spa` (`app-author`)

- [x] **Step 1:** Wire `@shac/actor-branch`, `@shac/mod-customers`, `@shac/mod-catalog` into `apps/node-worker/package.json` and `apps/node-worker/src/index.ts`.
- [x] **Step 2:** Create `apps/node-worker/src/command-registry.ts` and `apps/node-worker/src/branch-routes.ts` exposing all Phase 2 commands over Hono RPC (`/api/...`) + `/mcp`, plus `/api/branch/inventory/{receive-lot,allocate-fefo,balances}` bound to `BranchInventoryDO`.
- [x] **Step 3:** Add `/parties` and `/catalog` dynamic-vocabulary views to `apps/web-spa/src/views/Phase2Views.tsx` and `apps/web-spa/src/main.tsx` (`<= 300` lines/file).
- [x] **Step 4:** Add `apps/node-worker/test/phase2.worker.test.ts` on real `workerd` testing REST + MCP + `BranchInventoryDO` + D1 end-to-end, and update `knip.json`.

## Task 6: Full RDD Verification, Commit & Live Cloudflare Deploy (`verifier` + `coordinator`)

- [x] **Step 1:** Verify `pnpm -r typecheck`, `pnpm dlx knip --strict`, `pnpm -r test:run`, `pnpm --filter @shac/web-spa build`, `wrangler deploy --dry-run` (`gzip < 500 KiB`), 0 `DROP TABLE|DROP COLUMN`, 0 OS paths, all `.ts`/`.tsx` `<= 300` lines.
- [x] **Step 2:** Mark `- [x]` in this plan, update `docs/superpowers/DECISIONS.md`, and create atomic commit on `main`.
- [x] **Step 3:** Apply `0002` to remote `shac-primary` D1, update remote `CONFIG_KV` `profile:current`, deploy to `PC911 IT Services Global` (`https://shac-node-worker.pc911itservices.workers.dev`), and verify live Phase 2 endpoints.
