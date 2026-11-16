# SuperHyperArchiCRM (`@shac/*`)

**Versión de Arquitectura:** 2.2.0 (True All-in-One + Almacenamiento en 5 Capas + App Store en KV)  
**Stack Backend:** 100% Cloudflare Developer Platform (Workers, Static Assets, D1, Durable Objects SQLite, KV, Queues, R2, Vectorize, Workers AI).  
**Stack Frontend:** React 19 + Vite (`@cloudflare/vite-plugin`) + TanStack Router + TanStack Query (`offlineFirst` + IndexedDB) + Tailwind CSS v4 + `shadcn/ui` (`@shac/ui`).

Plataforma empresarial **All-in-One** multi-mercado y multi-situación capaz de operar **Retail POS**, **Almacenes Mayoristas (WMS)**, **Servicio Técnico / RMA**, **Hotelería (PMS)**, **Administración de Condominios / Real Estate**, **Clínicas Médicas y Terapias ABA**, **Despachos Legales / Consultoría PSA** y **Control Físico / Garitas IoT** desde un único monorepo TypeScript, con aislamiento físico de 1 base D1 por cliente, operación offline-first, multimoneda resiliente y Red Comercial Federada B2B/B2C.

## Documentación Maestra del Repositorio

- [`SPEC.md`](./SPEC.md) — Arquitectura maestra v2.2.0 (Motor Único All-in-One, 5 Capas Físicas, 9 Presets iniciales en KV, Control Plane y Hub Federado).
- [`DATA_MODEL.md`](./DATA_MODEL.md) — Diccionario canónico unificado de **116 tablas** (`108` D1 + `8` Durable Object) destilado columna por columna desde **711 tablas/modelos** reales.
- [`DESIGN.md`](./DESIGN.md) — Sistema de diseño *Industrial Tactile Precision* (React 19, Vite, TanStack, Tailwind v4, `shadcn/ui` y catálogo de vistas para Google Stitch).
- [`AGENTS.md`](./AGENTS.md) — Manual operativo obligatorio para agentes de código (SDD + ODD/RDD, cotas de iteración, anti-patrones prohibidos y recibos de verificación).
- [`docs/superpowers/specs/2026-11-16-multi-market-storage-architecture.md`](./docs/superpowers/specs/2026-11-16-multi-market-storage-architecture.md) — Plan detallado de almacenamiento multi-mercado en 5 capas (Tronco + Satélites + `v_cf_*`).
- [`docs/superpowers/DECISIONS.md`](./docs/superpowers/DECISIONS.md) — Registro cronológico de decisiones arquitectónicas (`ADR-001` a `ADR-007`).
- [`docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md`](./docs/superpowers/plans/2026-11-16-phase-1-micro-core-foundation.md) — Plan ejecutable TDD/RDD de la Fase 1.
