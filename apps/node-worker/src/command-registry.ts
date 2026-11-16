import { createD1Client, type ShacD1Database } from '@shac/db-d1';
import {
  AppError,
  authenticateRequest,
  enforceModuleGate,
  type AuthenticatedActor,
  type CommandSpec,
  type ExecutionContext,
  type ProfileLoader,
  type TenantMarketProfile,
} from '@shac/kernel';
import { modCatalogManifest } from '@shac/mod-catalog';
import { modCustomersManifest } from '@shac/mod-customers';
import { iamModule } from '@shac/mod-iam';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import type { CorsEnv } from './cors.js';
import { PHASE3_COMMANDS } from './pos-wms-registry.js';
import { PHASE7_COMMANDS } from './phase7-registry.js';
import { PHASE6_COMMANDS } from './spaces-leases-registry.js';
import { PHASE4_SYSTEM_COMMANDS } from './system-routes.js';

export interface WorkerEnv extends CorsEnv {
  DB: D1Database;
  CONFIG_KV: KVNamespace;
  SESSION_KV: KVNamespace;
  BRANCH_DO: DurableObjectNamespace;
  JWT_PUBLIC_KEY_JWK?: string;
  LICENSE_HMAC_SECRET?: string;
}

export type HonoEnv = { Bindings: WorkerEnv };

type QueryInput<T> = {
  [K in keyof T]?: string | string[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ALL_COMMANDS: readonly CommandSpec<any, any, ShacD1Database>[] = [
  ...iamModule.commands,
  ...modCustomersManifest.commands,
  ...modCatalogManifest.commands,
  ...PHASE3_COMMANDS,
  ...PHASE4_SYSTEM_COMMANDS,
  ...PHASE6_COMMANDS,
  ...PHASE7_COMMANDS,
];

function normalizeAuthHeaders(rawHeaders: Headers): Headers {
  const apiKey = rawHeaders.get('X-API-Key');
  if (apiKey && !rawHeaders.get('Authorization')) {
    const next = new Headers(rawHeaders);
    next.set('Authorization', `Bearer ${apiKey}`);
    return next;
  }
  return rawHeaders;
}

function parsePublicKeyJwk(raw?: string): JsonWebKey {
  if (!raw) return { kty: 'OKP' };
  try {
    return JSON.parse(raw) as JsonWebKey;
  } catch {
    throw new AppError('UNAUTHORIZED', 401, 'Invalid JWT public key config');
  }
}

function hasPermission(
  perms: readonly string[],
  requiredPermission: string,
): boolean {
  if (perms.includes('*') || perms.includes(requiredPermission)) {
    return true;
  }
  const parts = requiredPermission.split('.');
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    if (perms.includes(`${parts.slice(0, i).join('.')}.*`)) {
      return true;
    }
  }
  return false;
}

export async function authenticateWorkerActor(
  env: WorkerEnv,
  rawHeaders: Headers,
  profileLoader: ProfileLoader,
  moduleId: string,
  requiredPermission: string,
): Promise<{ profile: TenantMarketProfile; actor: AuthenticatedActor }> {
  const profile = await profileLoader.load(env.CONFIG_KV);
  enforceModuleGate(profile, moduleId);

  const headers = normalizeAuthHeaders(rawHeaders);
  const actor = await authenticateRequest(
    headers,
    env.SESSION_KV,
    parsePublicKeyJwk(env.JWT_PUBLIC_KEY_JWK),
  );

  if (!hasPermission(actor.perms, requiredPermission)) {
    throw new AppError(
      'FORBIDDEN',
      403,
      `Missing required permission: ${requiredPermission}`,
    );
  }

  return { profile, actor };
}

export async function readJsonBodyWithMutationId(
  c: Context<HonoEnv>,
): Promise<unknown> {
  let rawInput: unknown;
  try {
    rawInput = await c.req.json();
  } catch {
    throw new AppError('BAD_REQUEST', 400, 'Invalid JSON request body');
  }

  const headerMutationId = c.req.header('X-Client-Mutation-Id');
  if (
    headerMutationId &&
    typeof rawInput === 'object' &&
    rawInput !== null &&
    !Array.isArray(rawInput) &&
    !('clientMutationId' in rawInput)
  ) {
    (rawInput as Record<string, unknown>).clientMutationId = headerMutationId;
  }
  return rawInput;
}

export async function executeCommand<TIn extends z.ZodTypeAny, TOut>(
  cmd: CommandSpec<TIn, TOut, ShacD1Database>,
  env: WorkerEnv,
  rawHeaders: Headers,
  rawInput: unknown,
  profileLoader: ProfileLoader,
  requestId: string,
): Promise<TOut> {
  const { profile, actor } = await authenticateWorkerActor(
    env,
    rawHeaders,
    profileLoader,
    cmd.moduleId,
    cmd.requiredPermission,
  );

  const parsed = cmd.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'Invalid command input',
      parsed.error.flatten(),
    );
  }

  const ctx: ExecutionContext<ShacD1Database> = {
    tenantId: actor.tenantId,
    orgId: actor.orgId,
    orgPath: actor.orgPath,
    actor: {
      id: actor.id,
      type: actor.type,
      perms: actor.perms,
      ...(actor.delegatedById ? { delegatedById: actor.delegatedById } : {}),
    },
    profile,
    db: createD1Client(env.DB),
    sessionKv: env.SESSION_KV,
    configKv: env.CONFIG_KV,
    branchDo: {
      getByBranchKey: (key: string) =>
        env.BRANCH_DO.get(env.BRANCH_DO.idFromName(key)),
    },
    requestId,
  };

  return cmd.handler(ctx, parsed.data);
}

function stampEdgeHeaders(c: Context<HonoEnv>): string {
  const requestId = c.req.header('X-Request-Id') ?? crypto.randomUUID();
  c.header('X-Request-Id', requestId);
  c.header('X-SHAC-Mode', 'edge');
  return requestId;
}

export function jsonCommandHandler<TIn extends z.ZodTypeAny, TOut>(
  cmd: CommandSpec<TIn, TOut, ShacD1Database>,
  profileLoader: ProfileLoader,
) {
  return async (
    c: Context<
      HonoEnv,
      string,
      { in: { json: z.input<TIn> }; out: { json: z.output<TIn> } }
    >,
  ) => {
    const requestId = stampEdgeHeaders(c);
    const rawInput = await readJsonBodyWithMutationId(c);
    const output = await executeCommand(
      cmd,
      c.env,
      c.req.raw.headers,
      rawInput,
      profileLoader,
      requestId,
    );
    return c.json(output, 200);
  };
}

export function queryCommandHandler<TIn extends z.ZodTypeAny, TOut>(
  cmd: CommandSpec<TIn, TOut, ShacD1Database>,
  profileLoader: ProfileLoader,
) {
  return async (
    c: Context<
      HonoEnv,
      string,
      { in: { query: QueryInput<z.input<TIn>> }; out: { query: z.output<TIn> } }
    >,
  ) => {
    const requestId = stampEdgeHeaders(c);
    const output = await executeCommand(
      cmd,
      c.env,
      c.req.raw.headers,
      c.req.query(),
      profileLoader,
      requestId,
    );
    return c.json(output, 200);
  };
}

export function onWorkerError(err: Error, c: Context<HonoEnv>): Response {
  if (err instanceof AppError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
      err.status as ContentfulStatusCode,
    );
  }
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' } },
    500,
  );
}
