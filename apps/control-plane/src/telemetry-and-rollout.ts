export type HostingMode = 'BYOC_FREE' | 'SAAS_MULTI_D1' | 'HYBRID_APPLIANCE';

export interface QuotaTelemetryMetrics {
  d1RowsRead: number;
  d1RowsWritten: number;
  storageBytes: number;
  workerRequests?: number;
  activeRegisters?: number;
}

export interface QuotaTelemetryEvaluation {
  alertLevel: 'OK' | 'WARN_75';
  recommendedMode: 'SAAS_MULTI_D1' | null;
  maxRatio: number;
  breachedMetrics: Array<'d1RowsRead' | 'd1RowsWritten' | 'storageBytes'>;
  ratios: {
    d1RowsRead: number;
    d1RowsWritten: number;
    storageBytes: number;
  };
}

export const BYOC_FREE_LIMITS = {
  d1RowsRead: 5_000_000,
  d1RowsWritten: 100_000,
  storageBytes: 500 * 1024 * 1024,
  warnThreshold: 0.75,
} as const;

export const CLOUDFLARE_MAX_REQUESTS_PER_5MIN = 1200;

/**
 * Evaluates daily D1/storage telemetry against BYOC_FREE free-tier limits.
 * Emits WARN_75 and recommends SAAS_MULTI_D1 when any metric reaches >=75%.
 */
export function evaluateQuotaTelemetry(
  metrics: QuotaTelemetryMetrics,
  hostingMode: HostingMode,
): QuotaTelemetryEvaluation {
  const readsRatio = metrics.d1RowsRead / BYOC_FREE_LIMITS.d1RowsRead;
  const writesRatio = metrics.d1RowsWritten / BYOC_FREE_LIMITS.d1RowsWritten;
  const storageRatio = metrics.storageBytes / BYOC_FREE_LIMITS.storageBytes;

  const breachedMetrics: Array<'d1RowsRead' | 'd1RowsWritten' | 'storageBytes'> = [];
  if (hostingMode === 'BYOC_FREE') {
    if (readsRatio >= BYOC_FREE_LIMITS.warnThreshold) {
      breachedMetrics.push('d1RowsRead');
    }
    if (writesRatio >= BYOC_FREE_LIMITS.warnThreshold) {
      breachedMetrics.push('d1RowsWritten');
    }
    if (storageRatio >= BYOC_FREE_LIMITS.warnThreshold) {
      breachedMetrics.push('storageBytes');
    }
  }

  const maxRatio = Math.max(readsRatio, writesRatio, storageRatio);
  const warn = breachedMetrics.length > 0;

  return {
    alertLevel: warn ? 'WARN_75' : 'OK',
    recommendedMode: warn ? 'SAAS_MULTI_D1' : null,
    maxRatio,
    breachedMetrics,
    ratios: {
      d1RowsRead: readsRatio,
      d1RowsWritten: writesRatio,
      storageBytes: storageRatio,
    },
  };
}

export interface RolloutDeploymentNode {
  id: string;
  releaseChannel: 'canary' | 'stable';
  currentVersion: string;
}

export interface PlanRolloutOptions {
  targetVersion: string;
  canaryPercent?: number;
  maxRequestsPer5Min?: number;
  requestsPerNode?: number;
}

export interface RolloutBatch {
  batchIndex: number;
  ring: 'canary' | 'stable';
  delayMinutes: number;
  targetVersion: string;
  deploymentIds: string[];
  estimatedRequests: number;
}

export interface RolloutPlan {
  targetVersion: string;
  totalNodes: number;
  maxBatchNodes: number;
  maxRequestsPer5Min: number;
  batches: RolloutBatch[];
}

function chunkNodes(
  nodes: RolloutDeploymentNode[],
  ring: 'canary' | 'stable',
  maxBatchNodes: number,
  requestsPerNode: number,
  targetVersion: string,
  startBatchIndex: number,
): RolloutBatch[] {
  const batches: RolloutBatch[] = [];
  for (let i = 0; i < nodes.length; i += maxBatchNodes) {
    const slice = nodes.slice(i, i + maxBatchNodes);
    const batchIndex = startBatchIndex + batches.length;
    batches.push({
      batchIndex,
      ring,
      delayMinutes: batchIndex * 5,
      targetVersion,
      deploymentIds: slice.map((n) => n.id),
      estimatedRequests: slice.length * requestsPerNode,
    });
  }
  return batches;
}

/**
 * Plans canary + stable ring rollout batches respecting Cloudflare's
 * 1,200 requests per 5-minute API rate limit.
 */
export function planRingRolloutBatches(
  deployments: readonly RolloutDeploymentNode[],
  options: PlanRolloutOptions,
): RolloutPlan {
  const requestedLimit = options.maxRequestsPer5Min ?? CLOUDFLARE_MAX_REQUESTS_PER_5MIN;
  const maxRequestsPer5Min = Math.max(
    1,
    Math.min(requestedLimit, CLOUDFLARE_MAX_REQUESTS_PER_5MIN),
  );
  const requestsPerNode = Math.max(1, options.requestsPerNode ?? 1);
  const maxBatchNodes = Math.max(1, Math.floor(maxRequestsPer5Min / requestsPerNode));

  const pending = deployments.filter((d) => d.currentVersion !== options.targetVersion);
  const explicitCanaries = pending.filter((d) => d.releaseChannel === 'canary');
  const stablePool = pending.filter((d) => d.releaseChannel !== 'canary');

  const canaryPercent = Math.max(0, Math.min(100, options.canaryPercent ?? 10));
  const minCanaryCount =
    pending.length > 0 && canaryPercent > 0
      ? Math.max(1, Math.ceil((pending.length * canaryPercent) / 100))
      : 0;

  const extraNeeded = Math.max(0, minCanaryCount - explicitCanaries.length);
  const canaryNodes = [...explicitCanaries, ...stablePool.slice(0, extraNeeded)];
  const stableNodes = stablePool.slice(extraNeeded);

  const canaryBatches = chunkNodes(
    canaryNodes,
    'canary',
    maxBatchNodes,
    requestsPerNode,
    options.targetVersion,
    0,
  );
  const stableBatches = chunkNodes(
    stableNodes,
    'stable',
    maxBatchNodes,
    requestsPerNode,
    options.targetVersion,
    canaryBatches.length,
  );

  return {
    targetVersion: options.targetVersion,
    totalNodes: pending.length,
    maxBatchNodes,
    maxRequestsPer5Min,
    batches: [...canaryBatches, ...stableBatches],
  };
}
