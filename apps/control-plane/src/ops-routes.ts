import { AppError } from '@shac/kernel';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  signApplianceLicense,
  verifyApplianceLicense,
  type SignedApplianceLicense,
} from './license-hmac.js';
import {
  cpApplianceLicenses,
  cpDeployments,
  cpRolloutJobs,
  cpTelemetryDaily,
} from './schema.js';
import {
  evaluateQuotaTelemetry,
  planRingRolloutBatches,
  type HostingMode,
} from './telemetry-and-rollout.js';

export interface ControlPlaneEnv {
  CP_DB: D1Database;
  CP_KV?: KVNamespace;
  CP_LICENSE_SECRET?: string;
}

export interface ControlPlaneAppOptions {
  defaultHmacSecret?: string;
}

const IssueLicenseSchema = z.object({
  deploymentId: z.string().min(1),
  hardwareFingerprint: z.string().min(4),
  editionPreset: z.string().min(1).optional(),
  expiresInSeconds: z.number().int().positive().nullable().optional(),
  issuedAt: z.number().int().nonnegative().optional(),
});

const VerifyLicenseSchema = z.object({
  licenseId: z.string().min(1).optional(),
  license: z
    .object({
      licenseId: z.string().min(1),
      deploymentId: z.string().min(1),
      hardwareFingerprint: z.string().min(1),
      editionPreset: z.string().optional(),
      issuedAt: z.number().int().nonnegative(),
      expiresAt: z.number().int().nullable(),
      revokedAt: z.number().int().nullable().optional(),
      hmacSignature: z.string().min(1),
    })
    .optional(),
  expectedFingerprint: z.string().min(1),
  nowSec: z.number().int().nonnegative().optional(),
});

const TelemetryIngestSchema = z.object({
  deploymentId: z.string().min(1),
  dateYmd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  d1RowsRead: z.number().int().nonnegative(),
  d1RowsWritten: z.number().int().nonnegative(),
  storageBytes: z.number().int().nonnegative(),
  workerRequests: z.number().int().nonnegative().default(0),
  activeRegisters: z.number().int().nonnegative().default(0),
});

const PlanRolloutSchema = z.object({
  targetVersion: z.string().min(1),
  channel: z.enum(['canary', 'stable']).default('stable'),
  canaryPercent: z.number().min(0).max(100).default(10),
  maxRequestsPer5Min: z.number().int().positive().default(1200),
  requestsPerNode: z.number().int().positive().default(1),
  migrationBatchHash: z.string().min(1).default('sha256:additive'),
});

const DEFAULT_DEV_HMAC_SECRET = 'shac-cp-dev-hmac-secret';

function resolveSecret(
  env: ControlPlaneEnv,
  options?: ControlPlaneAppOptions,
): string {
  return env.CP_LICENSE_SECRET ?? options?.defaultHmacSecret ?? DEFAULT_DEV_HMAC_SECRET;
}

export function registerOpsRoutes(
  app: Hono<{ Bindings: ControlPlaneEnv }>,
  options?: ControlPlaneAppOptions,
): void {
  app.post('/api/cp/licenses/issue', async (c) => {
    const body = IssueLicenseSchema.parse(await c.req.json());
    const db = drizzle(c.env.CP_DB);
    const deployment = await db
      .select({ id: cpDeployments.id })
      .from(cpDeployments)
      .where(eq(cpDeployments.id, body.deploymentId))
      .get();
    if (!deployment) {
      throw new AppError('DEPLOYMENT_NOT_FOUND', 404, 'Deployment not found');
    }

    const issuedAt = body.issuedAt ?? Math.floor(Date.now() / 1000);
    const expiresAt =
      body.expiresInSeconds === undefined || body.expiresInSeconds === null
        ? null
        : issuedAt + body.expiresInSeconds;
    const licenseId = `lic_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const license = await signApplianceLicense(
      {
        licenseId,
        deploymentId: body.deploymentId,
        hardwareFingerprint: body.hardwareFingerprint,
        editionPreset: body.editionPreset ?? 'omni-enterprise',
        issuedAt,
        expiresAt,
      },
      resolveSecret(c.env, options),
    );

    await db.insert(cpApplianceLicenses).values({
      licenseId: license.licenseId,
      deploymentId: license.deploymentId,
      hardwareFingerprint: license.hardwareFingerprint,
      editionPreset: license.editionPreset ?? 'omni-enterprise',
      issuedAt: license.issuedAt,
      expiresAt: license.expiresAt,
      hmacSignature: license.hmacSignature,
      revokedAt: null,
    });

    return c.json({ license }, 201);
  });

  app.post('/api/cp/licenses/verify', async (c) => {
    const body = VerifyLicenseSchema.parse(await c.req.json());
    let candidate: SignedApplianceLicense | null = body.license
      ? { ...body.license, revokedAt: body.license.revokedAt ?? null }
      : null;

    if (!candidate && body.licenseId) {
      const db = drizzle(c.env.CP_DB);
      const row = await db
        .select()
        .from(cpApplianceLicenses)
        .where(eq(cpApplianceLicenses.licenseId, body.licenseId))
        .get();
      if (!row) {
        throw new AppError('LICENSE_NOT_FOUND', 404, 'License not found');
      }
      candidate = {
        licenseId: row.licenseId,
        deploymentId: row.deploymentId,
        hardwareFingerprint: row.hardwareFingerprint,
        editionPreset: row.editionPreset,
        issuedAt: row.issuedAt,
        expiresAt: row.expiresAt,
        hmacSignature: row.hmacSignature,
        revokedAt: row.revokedAt,
      };
    }

    if (!candidate) {
      throw new AppError('INVALID_REQUEST', 400, 'Provide license or licenseId');
    }

    const result = await verifyApplianceLicense(
      candidate,
      resolveSecret(c.env, options),
      body.expectedFingerprint,
      body.nowSec,
    );
    return c.json(result, result.valid ? 200 : 403);
  });

  app.post('/api/cp/telemetry/ingest', async (c) => {
    const body = TelemetryIngestSchema.parse(await c.req.json());
    const db = drizzle(c.env.CP_DB);
    const deployment = await db
      .select({ id: cpDeployments.id, hostingMode: cpDeployments.hostingMode })
      .from(cpDeployments)
      .where(eq(cpDeployments.id, body.deploymentId))
      .get();
    if (!deployment) {
      throw new AppError('DEPLOYMENT_NOT_FOUND', 404, 'Deployment not found');
    }

    const evaluation = evaluateQuotaTelemetry(
      {
        d1RowsRead: body.d1RowsRead,
        d1RowsWritten: body.d1RowsWritten,
        storageBytes: body.storageBytes,
        workerRequests: body.workerRequests,
        activeRegisters: body.activeRegisters,
      },
      deployment.hostingMode as HostingMode,
    );

    const now = new Date().toISOString();
    await db
      .insert(cpTelemetryDaily)
      .values({
        deploymentId: body.deploymentId,
        dateYmd: body.dateYmd,
        d1RowsRead: body.d1RowsRead,
        d1RowsWritten: body.d1RowsWritten,
        workerRequests: body.workerRequests,
        storageBytes: body.storageBytes,
        activeRegisters: body.activeRegisters,
        alertLevel: evaluation.alertLevel,
        recommendedMode: evaluation.recommendedMode,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cpTelemetryDaily.deploymentId, cpTelemetryDaily.dateYmd],
        set: {
          d1RowsRead: body.d1RowsRead,
          d1RowsWritten: body.d1RowsWritten,
          workerRequests: body.workerRequests,
          storageBytes: body.storageBytes,
          activeRegisters: body.activeRegisters,
          alertLevel: evaluation.alertLevel,
          recommendedMode: evaluation.recommendedMode,
          updatedAt: now,
        },
      });

    return c.json({ evaluation }, 200);
  });

  app.post('/api/cp/rollouts/plan', async (c) => {
    const body = PlanRolloutSchema.parse(await c.req.json());
    const db = drizzle(c.env.CP_DB);
    const rows = await db
      .select({
        id: cpDeployments.id,
        releaseChannel: cpDeployments.releaseChannel,
        currentVersion: cpDeployments.currentVersion,
        status: cpDeployments.status,
      })
      .from(cpDeployments);

    const activeNodes = rows
      .filter((r) => r.status === 'active')
      .map((r) => ({
        id: r.id,
        releaseChannel: (r.releaseChannel === 'canary' ? 'canary' : 'stable') as
          | 'canary'
          | 'stable',
        currentVersion: r.currentVersion,
      }));

    const plan = planRingRolloutBatches(activeNodes, {
      targetVersion: body.targetVersion,
      canaryPercent: body.canaryPercent,
      maxRequestsPer5Min: body.maxRequestsPer5Min,
      requestsPerNode: body.requestsPerNode,
    });

    const jobId = `job_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = new Date().toISOString();
    await db.insert(cpRolloutJobs).values({
      jobId,
      targetVersion: plan.targetVersion,
      channel: body.channel,
      migrationBatchHash: body.migrationBatchHash,
      totalNodes: plan.totalNodes,
      succeededNodes: 0,
      failedNodes: 0,
      batchesJson: JSON.stringify(plan.batches),
      status: 'planned',
      createdAt: now,
      updatedAt: now,
    });

    return c.json({ jobId, plan }, 201);
  });
}
