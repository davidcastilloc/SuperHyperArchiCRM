import { AppError, type KvStore } from '@shac/kernel';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import {
  registerOpsRoutes,
  type ControlPlaneAppOptions,
  type ControlPlaneEnv,
} from './ops-routes.js';
import {
  ProvisionDeploymentSchema,
  provisionDeployment,
  toggleDeploymentAppStore,
} from './provisioning.js';
import { cpDeployments, cpMarketProfiles } from './schema.js';

export type { ControlPlaneAppOptions, ControlPlaneEnv } from './ops-routes.js';

export function createControlPlaneApp(
  options?: ControlPlaneAppOptions,
): Hono<{ Bindings: ControlPlaneEnv }> {
  const app = new Hono<{ Bindings: ControlPlaneEnv }>();

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        err.status as 400 | 403 | 404 | 409 | 500,
      );
    }
    if (err instanceof ZodError) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: err.message, issues: err.issues } },
        400,
      );
    }
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: err.message } },
      500,
    );
  });

  app.post('/api/cp/deployments', async (c) => {
    const body = ProvisionDeploymentSchema.parse(await c.req.json());
    const db = drizzle(c.env.CP_DB);
    const result = await provisionDeployment(
      db,
      c.env.CP_KV as unknown as KvStore | undefined,
      body,
    );
    return c.json(result, 201);
  });

  app.get('/api/cp/deployments/:id', async (c) => {
    const deploymentId = c.req.param('id');
    const db = drizzle(c.env.CP_DB);
    const deployment = await db
      .select()
      .from(cpDeployments)
      .where(eq(cpDeployments.id, deploymentId))
      .get();
    if (!deployment) {
      throw new AppError('DEPLOYMENT_NOT_FOUND', 404, 'Deployment not found');
    }
    const profileRow = await db
      .select()
      .from(cpMarketProfiles)
      .where(eq(cpMarketProfiles.deploymentId, deploymentId))
      .get();
    return c.json({ deployment, profileRow });
  });

  app.post('/api/cp/deployments/:id/app-store', async (c) => {
    const deploymentId = c.req.param('id');
    const body = await c.req.json();
    const db = drizzle(c.env.CP_DB);
    const result = await toggleDeploymentAppStore(
      db,
      c.env.CP_KV as unknown as KvStore | undefined,
      deploymentId,
      body,
    );
    return c.json(result, 200);
  });

  registerOpsRoutes(app, options);
  return app;
}
