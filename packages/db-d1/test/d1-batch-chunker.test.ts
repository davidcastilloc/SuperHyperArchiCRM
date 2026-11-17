import { describe, expect, it } from 'vitest';
import {
  chunkIdsForD1InClause,
  chunkRowsForD1Insert,
  SAFE_D1_PARAMETER_CEILING,
} from '../src/index.js';

describe('@shac/db-d1 batch parameter chunker (<= 90 params)', () => {
  it('chunks 250 insert rows of 10 columns keeping each chunk <= 90 bound parameters', () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: `row_${i}` }));
    const chunks = chunkRowsForD1Insert(rows, 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length * 10).toBeLessThanOrEqual(SAFE_D1_PARAMETER_CEILING);
    }
    expect(chunks.flat()).toHaveLength(250);
    expect(() => chunkRowsForD1Insert(rows, 95)).toThrow(/INVALID_D1_COLUMNS_PER_ROW/);
  });

  it('chunks 250 IN-clause IDs reserving scope parameters', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id_${i}`);
    const chunks = chunkIdsForD1InClause(ids, 4);
    for (const chunk of chunks) {
      expect(chunk.length + 4).toBeLessThanOrEqual(SAFE_D1_PARAMETER_CEILING);
    }
    expect(chunks.flat()).toHaveLength(250);
  });
});
