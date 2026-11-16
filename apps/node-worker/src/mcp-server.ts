import { McpServer } from '@modelcontextprotocol/server';
import type { ShacD1Database } from '@shac/db-d1';
import {
  AppError,
  type CommandSpec,
  type ProfileLoader,
} from '@shac/kernel';
import type { z } from 'zod';
import {
  ALL_COMMANDS,
  executeCommand,
  type WorkerEnv,
} from './command-registry.js';
import { zod3ToStandardSchema } from './mcp-schema.js';

/** Builds a stateless MCP server exposing all active module commands. */
export function buildMcpServerForRequest(
  env: WorkerEnv,
  rawHeaders: Headers,
  profileLoader: ProfileLoader,
  requestId: string,
): McpServer {
  const server = new McpServer({
    name: 'shac-node-worker',
    version: '0.1.0',
  });

  for (const cmd of ALL_COMMANDS) {
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
