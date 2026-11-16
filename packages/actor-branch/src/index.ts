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
import { handleBranchHttpRequest } from './http-router.js';
import { checkoutPosSaleInTx } from './pos-checkout.js';
import {
  approvePhysicalReturnInTx,
  closePosShiftInTx,
} from './pos-close-and-return.js';
import type {
  ApprovePhysicalReturnInput,
  ApprovePhysicalReturnResult,
  CheckoutPosSaleInput,
  CheckoutPosSaleResult,
  ClosePosShiftInput,
  ClosePosShiftResult,
} from './pos-contracts.js';
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
export { checkoutPosSaleInTx } from './pos-checkout.js';
export {
  approvePhysicalReturnInTx,
  closePosShiftInTx,
} from './pos-close-and-return.js';
export {
  approvePhysicalReturnInputSchema,
  checkoutPosSaleInputSchema,
  closePosShiftInputSchema,
  currencyCodeSchema,
  posPaymentLineSchema,
  posReturnItemInputSchema,
  posSaleLineItemSchema,
  type ApprovedReturnItemResult,
  type ApprovePhysicalReturnInput,
  type ApprovePhysicalReturnResult,
  type CheckoutPosSaleInput,
  type CheckoutPosSaleResult,
  type ClosePosShiftInput,
  type ClosePosShiftResult,
  type PosPaymentLine,
  type PosReturnItemInput,
  type PosSaleLineAllocation,
  type PosSaleLineItem,
} from './pos-contracts.js';
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

  async checkoutPosSale(
    input: CheckoutPosSaleInput,
  ): Promise<CheckoutPosSaleResult> {
    return this.ctx.storage.transactionSync(() =>
      checkoutPosSaleInTx(this.ctx.storage.sql, input),
    );
  }

  async closePosShift(input: ClosePosShiftInput): Promise<ClosePosShiftResult> {
    return this.ctx.storage.transactionSync(() =>
      closePosShiftInTx(this.ctx.storage.sql, input),
    );
  }

  async approvePhysicalReturn(
    input: ApprovePhysicalReturnInput,
  ): Promise<ApprovePhysicalReturnResult> {
    return this.ctx.storage.transactionSync(() =>
      approvePhysicalReturnInTx(this.ctx.storage.sql, input),
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
    return handleBranchHttpRequest(this, request);
  }
}
