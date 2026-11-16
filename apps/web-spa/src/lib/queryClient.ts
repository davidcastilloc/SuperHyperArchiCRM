import { QueryClient } from '@tanstack/react-query';
import {
  persistQueryClient,
  type PersistedClient,
  type Persister,
} from '@tanstack/query-persist-client-core';
import { del, get, set } from 'idb-keyval';

const SHAC_QUERY_STORAGE_KEY = 'shac-tanstack-query-cache-v1';
const TWENTY_FOUR_HOURS_MS = 1000 * 60 * 60 * 24;
const FIVE_MINUTES_MS = 1000 * 60 * 5;

/** Creates an IndexedDB-backed TanStack Query persister using idb-keyval. */
function createIdbPersister(storageKey = SHAC_QUERY_STORAGE_KEY): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await set(storageKey, client);
    },
    restoreClient: async () => {
      return await get<PersistedClient>(storageKey);
    },
    removeClient: async () => {
      await del(storageKey);
    },
  };
}

export interface CreateShacQueryClientOptions {
  enablePersistence?: boolean;
  storageKey?: string;
}

/** Creates a QueryClient configured for offline-first POS/WMS resilience with IndexedDB persistence. */
export function createShacQueryClient(options: CreateShacQueryClientOptions = {}): QueryClient {
  const { enablePersistence = typeof indexedDB !== 'undefined', storageKey = SHAC_QUERY_STORAGE_KEY } =
    options;

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'offlineFirst',
        staleTime: FIVE_MINUTES_MS,
        gcTime: TWENTY_FOUR_HOURS_MS,
        retry: 1,
      },
      mutations: {
        networkMode: 'offlineFirst',
        retry: 1,
      },
    },
  });

  if (enablePersistence) {
    const persister = createIdbPersister(storageKey);
    persistQueryClient({
      queryClient,
      persister,
      maxAge: TWENTY_FOUR_HOURS_MS,
    });
  }

  return queryClient;
}
