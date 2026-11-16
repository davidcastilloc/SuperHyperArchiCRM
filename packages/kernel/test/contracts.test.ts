import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, defineCommand, defineModule } from '../src/index.js';

describe('@shac/kernel contracts', () => {
  it('registers typed command and preserves MCP metadata', () => {
    const ping = defineCommand({
      id: 'system.ping',
      moduleId: 'iam',
      method: 'GET',
      path: '/system/ping',
      summary: 'Health check',
      requiredPermission: 'system.read',
      mcp: { expose: true, readOnlyHint: true },
      inputSchema: z.object({ echo: z.string().min(1) }),
      outputSchema: z.object({ ok: z.literal(true), echo: z.string() }),
      handler: async (_ctx, input) => ({ ok: true as const, echo: input.echo }),
    });
    const mod = defineModule({ id: 'iam', version: '1.0.0', commands: [ping] });
    expect(mod.commands[0]?.id).toBe('system.ping');
    expect(new AppError('MODULE_NOT_ENABLED', 403, 'Disabled').status).toBe(403);
  });
});
