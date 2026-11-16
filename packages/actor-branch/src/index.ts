import { AppError } from '@shac/kernel';
import { DurableObject } from 'cloudflare:workers';
import {
  allocateFefoInTx,
  drainOutboxInTx,
  getBalancesInTx,
  listOutboxInTx,
  receiveLotInTx,
  type AllocateFefoInput,
  type AllocateFefoResult,
  type BalancesResult,
  type DrainOutboxOptions,
  type OutboxEvent,
  type ReceiveLotInput,
  type ReceiveLotResult,
} from './fefo-engine.js';
import { ensureHotTables } from './schema.js';
import {
  acquireSpaceLockInTx,
  listPosShiftsInTx,
  listSpaceLocksInTx,
  openPosShiftInTx,
  type AcquireSpaceLockInput,
  type OpenPosShiftInput,
  type OpenPosShiftResult,
  type PosShiftRecord,
  type SpaceLockRecord,
  type SpaceLockResult,
} from './space-and-shift.js';

export {
  allocateFefoInTx,
  allocateFefoInputSchema,
  drainOutboxInTx,
  drainOutboxOptionsSchema,
  getBalancesInTx,
  listOutboxInTx,
  receiveLotInTx,
  receiveLotInputSchema,
  type AllocateFefoInput,
  type AllocateFefoResult,
  type BalancesResult,
  type DrainOutboxOptions,
  type FefoAllocationSlice,
  type JsonScalar,
  type JsonValue,
  type LotBalanceItem,
  type OutboxEvent,
  type ReceiveLotInput,
  type ReceiveLotResult,
} from './fefo-engine.js';
export { ensureHotTables } from './schema.js';
export {
  acquireSpaceLockInTx,
  acquireSpaceLockInputSchema,
  listPosShiftsInTx,
  listSpaceLocksInTx,
  openPosShiftInTx,
  openPosShiftInputSchema,
  type AcquireSpaceLockInput,
  type OpenPosShiftInput,
  type OpenPosShiftResult,
  type PosShiftRecord,
  type SpaceLockRecord,
  type SpaceLockResult,
} from './space-and-shift.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: err.code,
          status: err.status,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
      err.status,
    );
  }
  return jsonResponse(
    {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Internal Server Error',
      },
    },
    500,
  );
}

async function readJsonBody(
  request: Request,
  allowEmpty = false,
): Promise<unknown> {
  const rawText = await request.text();
  if (rawText.trim() === '') {
    if (allowEmpty) return {};
    throw new AppError('BAD_REQUEST', 400, 'Request body is required');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new AppError('BAD_REQUEST', 400, 'Invalid JSON request body');
  }

  const headerMutationId = request.headers.get('X-Client-Mutation-Id');
  if (
    headerMutationId &&
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    !('clientMutationId' in parsed)
  ) {
    (parsed as Record<string, unknown>).clientMutationId = headerMutationId;
  }
  return parsed;
}

function parseLimitParam(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid limit query parameter');
  }
  return parsed;
}

/**
 * Per-branch transactional Durable Object owning the 8 hot SQLite tables.
 */
export class BranchInventoryDO extends DurableObject<unknown> {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ensureHotTables(this.ctx.storage.sql);
    });
  }

  async receiveLot(input: ReceiveLotInput): Promise<ReceiveLotResult> {
    return this.ctx.storage.transactionSync(() =>
      receiveLotInTx(this.ctx.storage.sql, input),
    );
  }

  async allocateFefo(input: AllocateFefoInput): Promise<AllocateFefoResult> {
    return this.ctx.storage.transactionSync(() =>
      allocateFefoInTx(this.ctx.storage.sql, input),
    );
  }

  async getBalances(
    productId?: string,
    variantId?: string,
  ): Promise<BalancesResult> {
    return this.ctx.storage.transactionSync(() =>
      getBalancesInTx(this.ctx.storage.sql, productId, variantId),
    );
  }

  async acquireSpaceLock(
    input: AcquireSpaceLockInput,
  ): Promise<SpaceLockResult> {
    return this.ctx.storage.transactionSync(() =>
      acquireSpaceLockInTx(this.ctx.storage.sql, input),
    );
  }

  async listSpaceLocks(spaceId?: string): Promise<SpaceLockRecord[]> {
    return this.ctx.storage.transactionSync(() =>
      listSpaceLocksInTx(this.ctx.storage.sql, spaceId),
    );
  }

  async openPosShift(input: OpenPosShiftInput): Promise<OpenPosShiftResult> {
    return this.ctx.storage.transactionSync(() =>
      openPosShiftInTx(this.ctx.storage.sql, input),
    );
  }

  async listPosShifts(registerId?: string): Promise<PosShiftRecord[]> {
    return this.ctx.storage.transactionSync(() =>
      listPosShiftsInTx(this.ctx.storage.sql, registerId),
    );
  }

  async listOutbox(limit?: number): Promise<OutboxEvent[]> {
    return this.ctx.storage.transactionSync(() =>
      listOutboxInTx(this.ctx.storage.sql, limit),
    );
  }

  async drainOutbox(options?: DrainOutboxOptions): Promise<OutboxEvent[]> {
    return this.ctx.storage.transactionSync(() =>
      drainOutboxInTx(this.ctx.storage.sql, options),
    );
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();

      if (method === 'GET' && path === '/health') {
        return jsonResponse({ ok: true, actor: 'BranchInventoryDO' });
      }
      if (method === 'POST' && path === '/receive-lot') {
        const body = (await readJsonBody(request)) as ReceiveLotInput;
        return jsonResponse(await this.receiveLot(body));
      }
      if (method === 'POST' && path === '/allocate-fefo') {
        const body = (await readJsonBody(request)) as AllocateFefoInput;
        return jsonResponse(await this.allocateFefo(body));
      }
      if (method === 'GET' && path === '/balances') {
        const productId = url.searchParams.get('productId') ?? undefined;
        const variantId = url.searchParams.get('variantId') ?? undefined;
        return jsonResponse(await this.getBalances(productId, variantId));
      }
      if (method === 'POST' && path === '/space-lock') {
        const body = (await readJsonBody(request)) as AcquireSpaceLockInput;
        return jsonResponse(await this.acquireSpaceLock(body));
      }
      if (method === 'GET' && path === '/space-lock') {
        const spaceId = url.searchParams.get('spaceId') ?? undefined;
        return jsonResponse({ locks: await this.listSpaceLocks(spaceId) });
      }
      if (method === 'POST' && path === '/pos-shift') {
        const body = (await readJsonBody(request)) as OpenPosShiftInput;
        return jsonResponse(await this.openPosShift(body));
      }
      if (method === 'GET' && path === '/pos-shift') {
        const registerId = url.searchParams.get('registerId') ?? undefined;
        return jsonResponse({ shifts: await this.listPosShifts(registerId) });
      }
      if (method === 'GET' && path === '/outbox') {
        const limit = parseLimitParam(url.searchParams.get('limit'));
        return jsonResponse({ events: await this.listOutbox(limit) });
      }
      if (method === 'POST' && path === '/outbox') {
        const body = (await readJsonBody(request, true)) as DrainOutboxOptions;
        const events = await this.drainOutbox(body);
        return jsonResponse({
          ok: true,
          events,
          drainedCount: events.length,
        });
      }

      throw new AppError(
        'NOT_FOUND',
        404,
        `Unknown route: ${method} ${path}`,
      );
    } catch (err) {
      return errorResponse(err);
    }
  }
}
