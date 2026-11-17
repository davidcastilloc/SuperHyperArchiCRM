export interface KeysetCursor {
  readonly sortValue: string | number;
  readonly id: string;
}

export interface CursorPageResult<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export function encodeKeysetCursor(cursor: KeysetCursor): string {
  const json = JSON.stringify([cursor.sortValue, cursor.id]);
  return btoa(encodeURIComponent(json));
}

export function decodeKeysetCursor(encoded: string | null | undefined): KeysetCursor | null {
  if (!encoded || !encoded.trim()) return null;
  try {
    const raw = decodeURIComponent(atob(encoded.trim()));
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      (typeof parsed[0] === 'string' || typeof parsed[0] === 'number') &&
      typeof parsed[1] === 'string'
    ) {
      return { sortValue: parsed[0], id: parsed[1] };
    }
    return null;
  } catch {
    return null;
  }
}

export function buildCursorPage<TItem>(
  rowsPlusOne: readonly TItem[],
  limit: number,
  extractCursor: (item: TItem) => KeysetCursor,
): CursorPageResult<TItem> {
  const safeLimit = Math.max(1, Math.min(250, limit));
  const hasMore = rowsPlusOne.length > safeLimit;
  const items = hasMore ? rowsPlusOne.slice(0, safeLimit) : rowsPlusOne;
  const lastItem = items.length > 0 ? items[items.length - 1]! : null;

  return {
    items,
    nextCursor: hasMore && lastItem ? encodeKeysetCursor(extractCursor(lastItem)) : null,
    hasMore,
  };
}
