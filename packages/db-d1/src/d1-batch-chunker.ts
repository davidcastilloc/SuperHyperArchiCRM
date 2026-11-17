export const D1_MAX_BOUND_PARAMETERS = 100;
export const SAFE_D1_PARAMETER_CEILING = 90;

/**
 * Divide una lista de filas en sub-lotes seguros para que `rows.length * colsPerRow <= 90`
 * (respetando el límite estricto de 100 parámetros ligados por sentencia en Cloudflare D1).
 */
export function chunkRowsForD1Insert<TRow>(
  rows: readonly TRow[],
  columnsPerRow: number,
  maxParamsPerStatement: number = SAFE_D1_PARAMETER_CEILING,
): TRow[][] {
  if (rows.length === 0) return [];
  if (columnsPerRow <= 0 || columnsPerRow > maxParamsPerStatement) {
    throw new Error(`INVALID_D1_COLUMNS_PER_ROW: ${columnsPerRow}`);
  }
  const rowsPerChunk = Math.max(1, Math.floor(maxParamsPerStatement / columnsPerRow));
  const chunks: TRow[][] = [];
  for (let i = 0; i < rows.length; i += rowsPerChunk) {
    chunks.push(rows.slice(i, i + rowsPerChunk));
  }
  return chunks;
}

/**
 * Divide un arreglo de IDs para cláusulas `WHERE col IN (?, ?, ...)` reservando parámetros
 * para los filtros fijos de tenant (`org_id`, `branch_id`, etc.).
 */
export function chunkIdsForD1InClause<TId>(
  ids: readonly TId[],
  reservedScopeParams: number = 4,
  maxParamsPerStatement: number = SAFE_D1_PARAMETER_CEILING,
): TId[][] {
  if (ids.length === 0) return [];
  const maxIdsPerQuery = Math.max(1, maxParamsPerStatement - reservedScopeParams);
  const chunks: TId[][] = [];
  for (let i = 0; i < ids.length; i += maxIdsPerQuery) {
    chunks.push(ids.slice(i, i + maxIdsPerQuery));
  }
  return chunks;
}
