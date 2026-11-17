import { describe, expect, it } from 'vitest';
import {
  buildCursorPage,
  decodeKeysetCursor,
  encodeKeysetCursor,
} from '../src/index.js';

describe('@shac/kernel O(1) keyset cursor pagination', () => {
  it('encodes and decodes keyset cursors and handles invalid input gracefully', () => {
    const encoded = encodeKeysetCursor({ sortValue: 1700000000, id: 'rec_42' });
    expect(decodeKeysetCursor(encoded)).toEqual({
      sortValue: 1700000000,
      id: 'rec_42',
    });
    expect(decodeKeysetCursor('')).toBeNull();
    expect(decodeKeysetCursor('!!!not-base64!!!')).toBeNull();
  });

  it('builds cursor page from rowsPlusOne with hasMore and nextCursor', () => {
    const rows = [
      { id: '1', ts: 10 },
      { id: '2', ts: 20 },
      { id: '3', ts: 30 },
    ];
    const page1 = buildCursorPage(rows, 2, (r) => ({ sortValue: r.ts, id: r.id }));
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(decodeKeysetCursor(page1.nextCursor)).toEqual({ sortValue: 20, id: '2' });

    const page2 = buildCursorPage(rows.slice(0, 2), 2, (r) => ({ sortValue: r.ts, id: r.id }));
    expect(page2.items).toHaveLength(2);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });
});
