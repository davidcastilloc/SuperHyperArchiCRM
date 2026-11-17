import { AppError } from '@shac/kernel';
import type {
  AcquireSpaceLockInput,
  AllocateFefoInput,
  AllocateFefoResult,
  BalancesResult,
  DrainOutboxOptions,
  OpenPosShiftInput,
  OpenPosShiftResult,
  OutboxEvent,
  PosShiftRecord,
  ReceiveLotInput,
  ReceiveLotResult,
  SpaceLockRecord,
  SpaceLockResult,
} from './contracts.js';
import type {
  ApprovePhysicalReturnInput,
  ApprovePhysicalReturnResult,
  CheckoutPosSaleInput,
  CheckoutPosSaleResult,
  ClosePosShiftInput,
  ClosePosShiftResult,
} from './pos-contracts.js';

export interface BranchActorHttpTarget {
  receiveLot(input: ReceiveLotInput): Promise<ReceiveLotResult>;
  allocateFefo(input: AllocateFefoInput): Promise<AllocateFefoResult>;
  getBalances(productId?: string, variantId?: string): Promise<BalancesResult>;
  acquireSpaceLock(input: AcquireSpaceLockInput): Promise<SpaceLockResult>;
  listSpaceLocks(spaceId?: string): Promise<SpaceLockRecord[]>;
  openPosShift(input: OpenPosShiftInput): Promise<OpenPosShiftResult>;
  listPosShifts(registerId?: string): Promise<PosShiftRecord[]>;
  checkoutPosSale(input: CheckoutPosSaleInput): Promise<CheckoutPosSaleResult>;
  closePosShift(input: ClosePosShiftInput): Promise<ClosePosShiftResult>;
  approvePhysicalReturn(
    input: ApprovePhysicalReturnInput,
  ): Promise<ApprovePhysicalReturnResult>;
  listOutbox(limit?: number): Promise<OutboxEvent[]>;
  drainOutbox(options?: DrainOutboxOptions): Promise<OutboxEvent[]>;
  acceptBranchWebSocket?(ws: WebSocket): void;
}

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
 * Dispatches HTTP requests for BranchInventoryDO with uniform AppError JSON responses.
 */
export async function handleBranchHttpRequest(
  actor: BranchActorHttpTarget,
  request: Request,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (method === 'GET' && path === '/health') {
      return jsonResponse({ ok: true, actor: 'BranchInventoryDO' });
    }
    if (method === 'POST' && path === '/receive-lot') {
      const body = (await readJsonBody(request)) as ReceiveLotInput;
      return jsonResponse(await actor.receiveLot(body));
    }
    if (method === 'POST' && path === '/allocate-fefo') {
      const body = (await readJsonBody(request)) as AllocateFefoInput;
      return jsonResponse(await actor.allocateFefo(body));
    }
    if (method === 'GET' && path === '/balances') {
      const productId = url.searchParams.get('productId') ?? undefined;
      const variantId = url.searchParams.get('variantId') ?? undefined;
      return jsonResponse(await actor.getBalances(productId, variantId));
    }
    if (method === 'POST' && path === '/space-lock') {
      const body = (await readJsonBody(request)) as AcquireSpaceLockInput;
      return jsonResponse(await actor.acquireSpaceLock(body));
    }
    if (method === 'GET' && path === '/space-lock') {
      const spaceId = url.searchParams.get('spaceId') ?? undefined;
      return jsonResponse({ locks: await actor.listSpaceLocks(spaceId) });
    }
    if (method === 'POST' && path === '/pos-shift') {
      const body = (await readJsonBody(request)) as OpenPosShiftInput;
      return jsonResponse(await actor.openPosShift(body));
    }
    if (method === 'GET' && path === '/pos-shift') {
      const registerId = url.searchParams.get('registerId') ?? undefined;
      return jsonResponse({ shifts: await actor.listPosShifts(registerId) });
    }
    if (method === 'POST' && path === '/pos-checkout') {
      const body = (await readJsonBody(request)) as CheckoutPosSaleInput;
      return jsonResponse(await actor.checkoutPosSale(body));
    }
    if (method === 'POST' && path === '/pos-close') {
      const body = (await readJsonBody(request)) as ClosePosShiftInput;
      return jsonResponse(await actor.closePosShift(body));
    }
    if (method === 'POST' && path === '/pos-return-approve') {
      const body = (await readJsonBody(request)) as ApprovePhysicalReturnInput;
      return jsonResponse(await actor.approvePhysicalReturn(body));
    }
    if (method === 'GET' && path === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      if (actor.acceptBranchWebSocket) {
        actor.acceptBranchWebSocket(server);
      } else {
        server.accept();
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    if (method === 'GET' && path === '/outbox') {
      const limit = parseLimitParam(url.searchParams.get('limit'));
      return jsonResponse({ events: await actor.listOutbox(limit) });
    }
    if (method === 'POST' && path === '/outbox') {
      const body = (await readJsonBody(request, true)) as DrainOutboxOptions;
      const events = await actor.drainOutbox(body);
      return jsonResponse({
        ok: true,
        events,
        drainedCount: events.length,
      });
    }

    throw new AppError('NOT_FOUND', 404, `Unknown route: ${method} ${path}`);
  } catch (err) {
    return errorResponse(err);
  }
}
