import {
  allocateFefoInputSchema,
  approvePhysicalReturnInputSchema,
  checkoutPosSaleInputSchema,
  closePosShiftInputSchema,
  receiveLotInputSchema,
  type AllocateFefoInput,
  type AllocateFefoResult,
  type ApprovePhysicalReturnInput,
  type ApprovePhysicalReturnResult,
  type BalancesResult,
  type CheckoutPosSaleInput,
  type CheckoutPosSaleResult,
  type ClosePosShiftInput,
  type ClosePosShiftResult,
  type ReceiveLotInput,
  type ReceiveLotResult,
} from '@shac/actor-branch';
import { AppError, type ProfileLoader } from '@shac/kernel';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import {
  authenticateWorkerActor,
  readJsonBodyWithMutationId,
  type HonoEnv,
} from './command-registry.js';

interface BranchDoErrorBody {
  ok: false;
  error: {
    code: string;
    status: number;
    message: string;
    details?: unknown;
  };
}

type BranchErrorStatus = 400 | 404 | 409 | 422 | 500;

function toBranchErrorStatus(status: number): BranchErrorStatus {
  if (
    status === 400 ||
    status === 404 ||
    status === 409 ||
    status === 422 ||
    status === 500
  ) {
    return status;
  }
  return 500;
}

function getBranchStub(
  c: Context<HonoEnv>,
  tenantId: string,
  orgId: string,
): DurableObjectStub {
  const doId = c.env.BRANCH_DO.idFromName(`${tenantId}:${orgId}`);
  return c.env.BRANCH_DO.get(doId);
}

async function postBranchDo<TIn extends z.ZodTypeAny, TOut>(
  c: Context<HonoEnv>,
  profileLoader: ProfileLoader,
  moduleId: string,
  requiredPermission: string,
  schema: TIn,
  doPath: string,
  invalidMessage: string,
) {
  const requestId = c.req.header('X-Request-Id') ?? crypto.randomUUID();
  c.header('X-Request-Id', requestId);
  c.header('X-SHAC-Mode', 'edge');

  const { actor } = await authenticateWorkerActor(
    c.env,
    c.req.raw.headers,
    profileLoader,
    moduleId,
    requiredPermission,
  );

  const rawInput = await readJsonBodyWithMutationId(c);
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      invalidMessage,
      parsed.error.flatten(),
    );
  }

  const stub = getBranchStub(c, actor.tenantId, actor.orgId);
  const doRes = await stub.fetch(`https://do.internal${doPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
  });
  const payload = await doRes.json();

  if (doRes.ok) {
    return c.json(payload as TOut, 200);
  }
  return c.json(
    payload as BranchDoErrorBody,
    toBranchErrorStatus(doRes.status),
  );
}

/**
 * Mounts /api/branch/inventory/* routes proxying tenant:org state to BranchInventoryDO.
 */
export function createBranchRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post(
      '/receive-lot',
      (
        c: Context<
          HonoEnv,
          string,
          { in: { json: ReceiveLotInput }; out: { json: ReceiveLotInput } }
        >,
      ) =>
        postBranchDo<typeof receiveLotInputSchema, ReceiveLotResult>(
          c,
          profileLoader,
          'wms',
          'branch.inventory.write',
          receiveLotInputSchema,
          '/receive-lot',
          'Invalid branch inventory input',
        ),
    )
    .post(
      '/allocate-fefo',
      (
        c: Context<
          HonoEnv,
          string,
          { in: { json: AllocateFefoInput }; out: { json: AllocateFefoInput } }
        >,
      ) =>
        postBranchDo<typeof allocateFefoInputSchema, AllocateFefoResult>(
          c,
          profileLoader,
          'wms',
          'branch.inventory.write',
          allocateFefoInputSchema,
          '/allocate-fefo',
          'Invalid branch inventory input',
        ),
    )
    .get(
      '/balances',
      async (
        c: Context<
          HonoEnv,
          string,
          {
            in: { query: { productId?: string; variantId?: string } };
            out: { query: { productId?: string; variantId?: string } };
          }
        >,
      ) => {
        const requestId = c.req.header('X-Request-Id') ?? crypto.randomUUID();
        c.header('X-Request-Id', requestId);
        c.header('X-SHAC-Mode', 'edge');

        const { actor } = await authenticateWorkerActor(
          c.env,
          c.req.raw.headers,
          profileLoader,
          'wms',
          'branch.inventory.read',
        );

        const doUrl = new URL('https://do.internal/balances');
        const productId = c.req.query('productId')?.trim();
        const variantId = c.req.query('variantId')?.trim();
        if (productId) doUrl.searchParams.set('productId', productId);
        if (variantId) doUrl.searchParams.set('variantId', variantId);

        const stub = getBranchStub(c, actor.tenantId, actor.orgId);
        const doRes = await stub.fetch(doUrl.toString(), { method: 'GET' });
        const payload = await doRes.json();

        if (doRes.ok) {
          return c.json(payload as BalancesResult, 200);
        }
        return c.json(
          payload as BranchDoErrorBody,
          toBranchErrorStatus(doRes.status),
        );
      },
    );
}

/**
 * Mounts /api/branch/pos/* routes proxying POS shift/checkout/return state to BranchInventoryDO.
 */
export function createBranchPosRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post(
      '/checkout',
      (
        c: Context<
          HonoEnv,
          string,
          {
            in: { json: CheckoutPosSaleInput };
            out: { json: z.output<typeof checkoutPosSaleInputSchema> };
          }
        >,
      ) =>
        postBranchDo<typeof checkoutPosSaleInputSchema, CheckoutPosSaleResult>(
          c,
          profileLoader,
          'pos',
          'pos.sales.write',
          checkoutPosSaleInputSchema,
          '/pos-checkout',
          'Invalid branch POS checkout input',
        ),
    )
    .post(
      '/close',
      (
        c: Context<
          HonoEnv,
          string,
          {
            in: { json: ClosePosShiftInput };
            out: { json: z.output<typeof closePosShiftInputSchema> };
          }
        >,
      ) =>
        postBranchDo<typeof closePosShiftInputSchema, ClosePosShiftResult>(
          c,
          profileLoader,
          'pos',
          'pos.shifts.write',
          closePosShiftInputSchema,
          '/pos-close',
          'Invalid branch POS shift close input',
        ),
    )
    .post(
      '/return-approve',
      (
        c: Context<
          HonoEnv,
          string,
          {
            in: { json: ApprovePhysicalReturnInput };
            out: { json: z.output<typeof approvePhysicalReturnInputSchema> };
          }
        >,
      ) =>
        postBranchDo<
          typeof approvePhysicalReturnInputSchema,
          ApprovePhysicalReturnResult
        >(
          c,
          profileLoader,
          'pos',
          'pos.returns.write',
          approvePhysicalReturnInputSchema,
          '/pos-return-approve',
          'Invalid branch POS return approval input',
        ),
    );
}
