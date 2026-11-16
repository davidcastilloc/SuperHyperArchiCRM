# SuperHyperArchiCRM (`@shac/*`)

**Versión de Arquitectura:** 2.0.0 (Núcleo Universal + Packs Compilables por Familia)  
**Stack:** 100% Cloudflare Developer Platform (Workers, Static Assets, D1, Durable Objects SQLite, KV, Queues, R2, Vectorize, Workers AI) + SvelteKit SPA (`adapter-static`) + Tailwind CSS v4.

Línea de productos empresariales (*Software Product Line*) multi-mercado y multi-situación capaz de operar **Retail POS**, **Almacenes Mayoristas (WMS)**, **Servicio Técnico / RMA**, **Hotelería (PMS)**, **Administración de Condominios / Real Estate**, **Clínicas Médicas**, **Despachos Legales / Consultoría PSA** y **Control Físico / Garitas IoT** desde un único monorepo TypeScript, con operación offline-first, multimoneda resiliente y Red Comercial Federada B2B/B2C.

## Documentación Maestra del Repositorio

- [`SPEC.md`](./SPEC.md) — Arquitectura maestra v2.0.0 (Núcleo Universal, 4 Packs por Familia, 12 Motores, 9 Presets en KV, Control Plane y Hub Federado).
- [`AGENTS.md`](./AGENTS.md) — Manual operativo obligatorio para agentes de código (SDD + ODD/RDD, cotas de iteración, tabla de anti-patrones prohibidos y recibos de verificación).
- [`docs/superpowers/DECISIONS.md`](./docs/superpowers/DECISIONS.md) — Registro cronológico de decisiones arquitectónicas (ADR).
- [`docs/superpowers/specs/`](./docs/superpowers/specs/) — Especificaciones detalladas por pilar y matriz de la Licuadora de 9 repositorios.
- [`docs/superpowers/plans/`](./docs/superpowers/plans/) — Planes de implementación incrementales guiados por pruebas y recibos.
