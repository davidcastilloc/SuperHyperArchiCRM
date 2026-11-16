# Diseño de Sesión Interactiva Bimodal (`AuthBranchGate` + `SESSION_KV`)

**Fecha:** 2026-11-16  
**Tamaño del trabajo:** Corte vertical pequeño-mediano (~200 LOC en `@shac/kernel`, `@shac/node-worker` y `@shac/web-spa`; `0` migraciones SQL porque `iam_users`, `iam_organizations` y `SESSION_KV` ya existen).

---

## 1. Intención y Por Qué

Al abrir `shac-node-worker` desplegado en Cloudflare desde el navegador, la SPA (`@shac/web-spa`) dispara llamadas Hono RPC sin credenciales y recibe `401 (Unauthorized)` porque `<AuthBranchGate>` en `/auth` quedó como cascarón visual en Fase 1, el cliente RPC no adjunta cabeceras de autenticación y el Worker no expone endpoints públicos de inicio de sesión humano. El objetivo es conectar de punta a punta el login corporativo (correo + contraseña WebCrypto PBKDF2) y el teclado táctil de PIN (cajero 4 dígitos / delegación 6 dígitos) usando las tablas canónicas `iam_users` e `iam_organizations` en D1 y sesiones rápidas en `SESSION_KV`.

## 2. Objetivos, No-Objetivos y Anti-Objetivos

- **Objetivos:**
  - Hidratar en `/auth` y en el shell el `TenantMarketProfile` real (`CONFIG_KV`) y el listado real de sucursales activas (`iam_organizations` en D1).
  - Autenticar operadores por correo + contraseña (`verifyPasswordPbkdf2` en WebCrypto) y por PIN táctil de 4 dígitos (`floor_pin_hash` SHA-256) o 6 dígitos (`delegation:<sha256>` en `SESSION_KV`), emitiendo sesiones opacas `shac_sess_*` en `SESSION_KV` (`< 0.5 ms` por request subsiguiente).
  - Adjuntar automáticamente `Authorization: Bearer <token>` y `X-Org-Id` en `createRpcClient`, proteger las vistas de la SPA cuando no exista sesión activa (cero ráfagas de `401` al abrir la app) y permitir cerrar sesión (`POST /api/auth/logout`).
  - Sembrar el usuario administrador inicial en D1 remoto (`shac-primary`, tenant `ten_1`, organización `org_1`), redesplegar y verificar `200 OK` en vivo sobre `/api/customers/parties`.
- **No-Objetivos:** Flujos de registro público autoservicio, recuperación de contraseña por correo (`Email Service`) o federación SSO OIDC externa.
- **Anti-Objetivos (fallo aunque funcione):** Hardcodear llaves `mk_live_*` o contraseñas en código fuente/Git, usar `pbkdf2Sync` o `bcrypt` JS, exigir nuevos secretos de Worker cuando `SESSION_KV` ya resuelve sesiones revocables, o permitir acceso con permisos implícitos si `preferences_json.perms` está vacío (*fail-closed*).

## 3. Restricciones (`AGENTS.md` + `SPEC.md`)

- Máximo `<= 2` sentencias D1 por endpoint usando `db.batch([...])` y filtro estricto `eq(table.tenantId, profile.tenantId)`.
- WebCrypto asíncrono (`crypto.subtle`) exclusivamente; verificación de sesión subsiguiente en `SESSION_KV` (`< 0.5 ms` CPU).
- Ningún archivo `.ts`/`.tsx` puede superar `300` líneas; `0` issues en `knip --strict`; bundle del Worker `< 1024 KiB` gzip.
- Cero rutas absolutas de sistema operativo y cero credenciales en texto plano dentro del repositorio Git.

## 4. Enfoques Evaluados

1. **Opción A (Elegida — Login bimodal real respaldado en `SESSION_KV` + `iam_users`):**
   - *Cómo funciona:* `@shac/kernel` reconoce tokens `Bearer shac_sess_<hex>` verificados por `SHA-256` contra `SESSION_KV` (`session:<sha256>`) igual que `apikey:*` y `delegation:*`, sin requerir clave privada JWT adicional en el Worker y permitiendo revocación inmediata en logout. `@shac/node-worker` monta `/api/auth/{bootstrap,login,pin,logout}` y `@shac/web-spa` conecta `<AuthBranchGate>`, `authSession` y `createRpcClient`.
   - *Ventajas:* Producto real fiel a `SPEC.md` y `DESIGN.md`, revocación instantánea, cero secretos nuevos en Cloudflare, compatible con JWT EdDSA, `mk_live_*` y `X-Delegation-Pin` existentes.
   - *Trade-off:* Toca 3 paquetes (~200 LOC).
2. **Opción B (Descartada — Inyección manual de `mk_live_*` / PIN en el navegador):**
   - *Trade-off:* Cambio mínimo solo en frontend, pero obliga a compartir llaves máquina en navegadores de operadores y deja inoperante el login corporativo de `AuthBranchGate`.
3. **Opción C (Descartada — Emisión de JWT EdDSA stateless en login sin `SESSION_KV`):**
   - *Trade-off:* Exige aprovisionar y rotar un nuevo secreto `JWT_PRIVATE_KEY_JWK` en cada nodo Worker y no permite revocar sesiones individuales al cerrar turno/sesión antes de que expire el JWT.

## 5. Decisiones Técnicas Concretas (Propuestas del Constructor)

1. **Contrato de Sesión en `@shac/kernel` (`packages/kernel/src/contracts.ts` y `pipeline.ts`):**
   - Ampliar `KvStore` con `delete?(key: string): Promise<void>` y `put?(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>`.
   - En `authenticateRequest`, si el `Bearer` inicia con `shac_sess_`, resolver `session:<sha256Hex(token)>` en `SESSION_KV` validando esquema Zod (`userId`, `tenantId`, `orgId`, `orgPath`, `actorType`, `perms`, `delegatedById?`, `expiresAt > nowSec`).
2. **Rutas Públicas `/api/auth/*` en `@shac/node-worker` (`apps/node-worker/src/auth-routes.ts`):**
   - `GET /api/auth/bootstrap`: Lee `profile` desde `ProfileLoader` (`CONFIG_KV`) y consulta `iam_organizations` activas del `profile.tenantId` (`1` query D1), devolviendo `{ tenantId, editionPreset, activeModules, vocabulary, branches }`.
   - `POST /api/auth/login`: Valida `{ email, password, branchId }`, ejecuta `db.batch` (`iam_users` por `(tenantId, emailHash)` + `iam_organizations` por `(tenantId, branchId)`), comprueba bloqueo temporal (`lockedUntil`, bloqueo de `15 min` al 5to intento fallido), verifica `verifyPasswordPbkdf2`, extrae `perms` desde `preferences_json.perms` (*fail-closed*: `[]` si no existe), emite `shac_sess_<64hex>` con TTL `12h` en `SESSION_KV` y resetea `failedLoginAttempts` / actualiza `lastLoginAt`.
   - `POST /api/auth/pin`: Soporta `mode: 'cashier'` (`4` dígitos -> `iam_users.floor_pin_hash` en `tenantId` + validación de sucursal, TTL `8h`) y `mode: 'delegation'` (`6` dígitos -> sesión `delegation:<sha256>` en `SESSION_KV` validada contra `branchId`, emitiendo `shac_sess_*` con el `expiresAt` restante del PIN).
   - `POST /api/auth/logout`: Elimina `session:<sha256>` de `SESSION_KV` si recibe `Bearer shac_sess_*` y responde `{ ok: true }`.
   - Añadir `X-Delegation-Pin` a `ALLOW_HEADERS` en `apps/node-worker/src/cors.ts`.
3. **Estado de Sesión y Gate en `@shac/web-spa` (`apps/web-spa/src/lib/authSession.ts`, `rpc.ts`, `main.tsx`):**
   - Persistir sesión `{ token, expiresAt, actor }` en `localStorage` (`shac.auth.session.v1`) con lectura reactiva (`useSyncExternalStore`) y limpieza automática si expira o si cualquier llamada `/api/*` (fuera de `/api/auth/*`) devuelve `401`.
   - `createRpcClient` inyecta `Authorization: Bearer <token>` y `X-Org-Id: <actor.orgId>` dinámicamente en cada request.
   - Si no hay sesión activa, el shell muestra `<AuthBranchGate>` conectado a `/api/auth/login` y `/api/auth/pin` sin montar las vistas protegidas (evitando peticiones `401` innecesarias) e incluye indicador de operador + botón `"Salir"` en `headerActions` al autenticar.
4. **Semilla Administrativa en Producción (`shac-primary`):**
   - Insertar de forma idempotente en D1 remoto (`ten_1`, `org_1`) el usuario administrador inicial con hash WebCrypto PBKDF2, PIN de piso de 4 dígitos hasheado con `SHA-256` y `preferences_json = '{"perms":["*"]}'`, generando las credenciales en el momento del despliegue sin guardarlas en Git.
