import { createStore, get, set, type UseStore } from 'idb-keyval';

const OFFLINE_QUEUE_KEY = 'shac-offline-mutations-v1';

export interface OfflineMutationItem<TPayload = Record<string, unknown>> {
  clientMutationId: string;
  endpoint: string;
  method: 'POST';
  kind: string;
  payload: TPayload;
  enqueuedAt: number;
  attempts: number;
  lastErrorStatus?: number;
  lastErrorCode?: string;
}

export interface EnqueueOfflineMutationInput<TPayload = Record<string, unknown>> {
  clientMutationId: string;
  endpoint: string;
  kind: string;
  payload: TPayload;
}

export interface OfflineQueueOptions {
  store?: UseStore;
  queueKey?: string;
}

export type OfflineMutationSender = (
  item: OfflineMutationItem,
) => Promise<Pick<Response, 'status' | 'json'>>;

export interface FlushOfflineQueueResult {
  processed: number;
  settled: number;
  retained: number;
  remainingItems: OfflineMutationItem[];
}

/** In-memory IDBObjectStore shim backing idb-keyval when IndexedDB is unavailable (e.g. Node Vitest). */
function createMemoryIdbStore(): UseStore {
  const data = new Map<string, unknown>();

  return <T>(
    _txMode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => T | PromiseLike<T>,
  ): Promise<T> => {
    const tx: {
      oncomplete: ((ev: Event) => void) | null;
      onsuccess: ((ev: Event) => void) | null;
      onabort: ((ev: Event) => void) | null;
      onerror: ((ev: Event) => void) | null;
      error: DOMException | null;
    } = {
      oncomplete: null,
      onsuccess: null,
      onabort: null,
      onerror: null,
      error: null,
    };

    const fakeStore = {
      transaction: tx,
      get(key: IDBValidKey) {
        const val = data.get(String(key));
        const req: {
          result: unknown;
          onsuccess: ((ev: Event) => void) | null;
          oncomplete: ((ev: Event) => void) | null;
          onerror: ((ev: Event) => void) | null;
          onabort: ((ev: Event) => void) | null;
          error: DOMException | null;
        } = {
          result:
            val !== undefined && typeof structuredClone === 'function'
              ? structuredClone(val)
              : val,
          onsuccess: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
          error: null,
        };
        queueMicrotask(() => {
          req.onsuccess?.({} as Event);
        });
        return req as unknown as IDBRequest;
      },
      put(value: unknown, key?: IDBValidKey) {
        const cloned =
          value !== undefined && typeof structuredClone === 'function'
            ? structuredClone(value)
            : value;
        data.set(String(key), cloned);
        queueMicrotask(() => {
          tx.oncomplete?.({} as Event);
        });
        return {} as IDBRequest;
      },
      delete(key: IDBValidKey) {
        data.delete(String(key));
        queueMicrotask(() => {
          tx.oncomplete?.({} as Event);
        });
        return {} as IDBRequest;
      },
    } as unknown as IDBObjectStore;

    return Promise.resolve(callback(fakeStore));
  };
}

let defaultStore: UseStore | undefined;

function resolveStore(custom?: UseStore): UseStore {
  if (custom) return custom;
  if (!defaultStore) {
    defaultStore =
      typeof indexedDB !== 'undefined'
        ? createStore('shac-offline-queue-v1', 'mutations')
        : createMemoryIdbStore();
  }
  return defaultStore;
}

/** Lists all pending offline mutations stored in IndexedDB via idb-keyval. */
export async function listOfflineQueue(
  options: OfflineQueueOptions = {},
): Promise<OfflineMutationItem[]> {
  const store = resolveStore(options.store);
  const queueKey = options.queueKey ?? OFFLINE_QUEUE_KEY;
  const current = await get<OfflineMutationItem[]>(queueKey, store);
  return Array.isArray(current) ? current : [];
}

/** Enqueues a mutation into IndexedDB idempotently by clientMutationId. */
export async function enqueueOfflineMutation<
  TPayload = Record<string, unknown>,
>(
  input: EnqueueOfflineMutationInput<TPayload>,
  options: OfflineQueueOptions = {},
): Promise<OfflineMutationItem<TPayload>> {
  const store = resolveStore(options.store);
  const queueKey = options.queueKey ?? OFFLINE_QUEUE_KEY;
  const queue = await listOfflineQueue({ store, queueKey });
  const existing = queue.find(
    (entry) => entry.clientMutationId === input.clientMutationId,
  );
  if (existing) {
    return existing as OfflineMutationItem<TPayload>;
  }

  const item: OfflineMutationItem<TPayload> = {
    clientMutationId: input.clientMutationId,
    endpoint: input.endpoint,
    method: 'POST',
    kind: input.kind,
    payload: input.payload,
    enqueuedAt: Date.now(),
    attempts: 0,
  };

  await set(queueKey, [...queue, item], store);
  return item;
}

async function readErrorCode(
  res: Pick<Response, 'status' | 'json'>,
): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { code?: string } };
    return typeof body?.error?.code === 'string' ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Flushes queued offline mutations in FIFO order.
 * Removes settled 2xx and 409 IDEMPOTENCY_CONFLICT items; retains 503/network failures for retry.
 */
export async function flushOfflineQueue(
  sender: OfflineMutationSender,
  options: OfflineQueueOptions = {},
): Promise<FlushOfflineQueueResult> {
  const store = resolveStore(options.store);
  const queueKey = options.queueKey ?? OFFLINE_QUEUE_KEY;
  const queue = await listOfflineQueue({ store, queueKey });
  const remainingItems: OfflineMutationItem[] = [];
  let settled = 0;

  for (const item of queue) {
    try {
      const res = await sender(item);
      if (res.status >= 200 && res.status < 300) {
        settled += 1;
        continue;
      }
      const errCode = await readErrorCode(res);
      if (res.status === 409 && errCode === 'IDEMPOTENCY_CONFLICT') {
        settled += 1;
        continue;
      }
      remainingItems.push({
        ...item,
        attempts: item.attempts + 1,
        lastErrorStatus: res.status,
        ...(errCode ? { lastErrorCode: errCode } : {}),
      });
    } catch {
      remainingItems.push({
        ...item,
        attempts: item.attempts + 1,
        lastErrorCode: 'NETWORK_ERROR',
      });
    }
  }

  await set(queueKey, remainingItems, store);
  return {
    processed: queue.length,
    settled,
    retained: remainingItems.length,
    remainingItems,
  };
}
