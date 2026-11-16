import { McpServer } from '@modelcontextprotocol/server';
import { createD1Client, type ShacD1Database } from '@shac/db-d1';
import {
  AppError,
  authenticateRequest,
  createProfileLoader,
  enforceModuleGate,
  type CommandSpec,
  type ExecutionContext,
  type ProfileLoader,
} from '@shac/kernel';
import {
  iamApiKeysCreateCommand,
  iamDelegationIssuePinCommand,
  iamModule,
  iamOrgsCreateCommand,
  iamOrgsListCommand,
} from '@shac/mod-iam';
import { createMcpHandler } from 'agents/mcp/server';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { createAdaptiveCorsMiddleware, type CorsEnv } from './cors.js';
import { zod3ToStandardSchema } from './mcp-schema.js';

export interface WorkerEnv extends CorsEnv {
  DB: D1Database;
  CONFIG_KV: KVNamespace;
  SESSION_KV: KVNamespace;
  BRANCH_DO: DurableObjectNamespace;
  JWT_PUBLIC_KEY_JWK?: string;
}

type HonoEnv = { Bindings: WorkerEnv };

const defaultProfileLoader = createProfileLoader();

export function invalidateProfileCache(): void {
  defaultProfileLoader.invalidate();
}

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

async function executeCommand<TIn extends z.ZodTypeAny, TOut>(
  cmd: CommandSpec<TIn, TOut, ShacD1Database>,
  env: WorkerEnv,
  rawHeaders: Headers,
  rawInput: unknown,
  profileLoader: ProfileLoader,
  requestId: string,
): Promise<TOut> {
  const profile = await profileLoader.load(env.CONFIG_KV);
  enforceModuleGate(profile, cmd.moduleId);

  const headers = normalizeAuthHeaders(rawHeaders);
  const actor = await authenticateRequest(
    headers,
    env.SESSION_KV,
    parsePublicKeyJwk(env.JWT_PUBLIC_KEY_JWK),
  );

  if (
    !actor.perms.includes('*') &&
    !actor.perms.includes(cmd.requiredPermission)
  ) {
    throw new AppError(
      'FORBIDDEN',
      403,
      `Missing required permission: ${cmd.requiredPermission}`,
    );
  }

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
    requestId,
  };

  return cmd.handler(ctx, parsed.data);
}

async function handleHttpCommand<TIn extends z.ZodTypeAny, TOut>(
  c: Context<HonoEnv>,
  cmd: CommandSpec<TIn, TOut, ShacD1Database>,
  profileLoader: ProfileLoader,
) {
  const requestId = c.req.header('X-Request-Id') ?? crypto.randomUUID();
  c.header('X-Request-Id', requestId);
  c.header('X-SHAC-Mode', 'edge');

  let rawInput: unknown;
  if (cmd.method === 'GET') {
    rawInput = c.req.query();
  } else {
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
      !('clientMutationId' in rawInput)
    ) {
      (rawInput as Record<string, unknown>).clientMutationId = headerMutationId;
    }
  }

  const output = await executeCommand(
    cmd,
    c.env,
    c.req.raw.headers,
    rawInput,
    profileLoader,
    requestId,
  );
  return c.json(output, 200);
}

function buildMcpServerForRequest(
  env: WorkerEnv,
  rawHeaders: Headers,
  profileLoader: ProfileLoader,
  requestId: string,
): McpServer {
  const server = new McpServer({
    name: 'shac-node-worker',
    version: '0.1.0',
  });

  for (const cmd of iamModule.commands) {
    if (!cmd.mcp.expose) continue;
    server.registerTool(
      cmd.id,
      {
        title: cmd.id,
        description: cmd.mcp.description ?? cmd.summary,
        inputSchema: zod3ToStandardSchema(cmd.inputSchema),
        annotations: {
          readOnlyHint: cmd.mcp.readOnlyHint,
          destructiveHint: cmd.mcp.destructiveHint,
          idempotentHint: cmd.mcp.idempotentHint,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await executeCommand(
            cmd as CommandSpec<z.ZodTypeAny, unknown, ShacD1Database>,
            env,
            rawHeaders,
            args ?? {},
            profileLoader,
            requestId,
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (err) {
          const appErr =
            err instanceof AppError
              ? err
              : new AppError('INTERNAL_ERROR', 500, 'Unexpected MCP tool error');
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: {
                    code: appErr.code,
                    status: appErr.status,
                    message: appErr.message,
                  },
                }),
              },
            ],
          };
        }
      },
    );
  }

  return server;
}

function createWorkerApp(
  profileLoader: ProfileLoader = defaultProfileLoader,
) {
  const app = new Hono<HonoEnv>()
    .use('*', createAdaptiveCorsMiddleware<HonoEnv>())
    .onError((err, c) => {
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
    })
    .get('/api/health', (c) =>
      c.json({ ok: true, service: 'shac-node-worker' }, 200),
    )
    .get('/api/iam/orgs', (c) =>
      handleHttpCommand(c, iamOrgsListCommand, profileLoader),
    )
    .post('/api/iam/orgs', (c) =>
      handleHttpCommand(c, iamOrgsCreateCommand, profileLoader),
    )
    .post('/api/iam/api-keys', (c) =>
      handleHttpCommand(c, iamApiKeysCreateCommand, profileLoader),
    )
    .post('/api/iam/delegation/pins', (c) =>
      handleHttpCommand(c, iamDelegationIssuePinCommand, profileLoader),
    )
    .all('/mcp', async (c) => {
      const requestId = c.req.header('X-Request-Id') ?? crypto.randomUUID();
      const handler = createMcpHandler(
        () =>
          buildMcpServerForRequest(
            c.env,
            c.req.raw.headers,
            profileLoader,
            requestId,
          ),
        {
          route: '/mcp',
          corsOptions: false,
          allowedOriginHostnames: '*',
        },
      );
      return handler(
        c.req.raw,
        c.env,
        c.executionCtx as unknown as Parameters<typeof handler>[2],
      );
    });

  return app;
}

export const workerApp = createWorkerApp();
export type AppRouter = typeof workerApp;
