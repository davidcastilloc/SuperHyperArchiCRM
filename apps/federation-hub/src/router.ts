import { AppError } from '@shac/kernel';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import { processHubEnvelope } from './envelopes.js';
import {
  findBestOffers,
  FindBestOffersSchema,
  holdInventoryTTL,
  HoldInventorySchema,
  MarketplaceSearchSchema,
  searchMarketplace,
} from './marketplace.js';
import { hubNodes } from './schema.js';

export interface FederationHubEnv {
  HUB_DB: D1Database;
  HUB_KV?: KVNamespace;
}

export interface FederationHubAppOptions {
  nowMs?: () => number;
}

const RegisterNodeSchema = z.object({
  did: z.string().min(1).optional(),
  deploymentId: z.string().min(1),
  companyName: z.string().min(1),
  region: z.string().min(1),
  city: z.string().min(1),
  publicKeyJwk: z.record(z.unknown()),
  status: z.enum(['active', 'suspended']).default('active'),
});

export function createFederationHubApp(
  options?: FederationHubAppOptions,
): Hono<{ Bindings: FederationHubEnv }> {
  const app = new Hono<{ Bindings: FederationHubEnv }>();

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        err.status as 400 | 401 | 403 | 404 | 409 | 500,
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

  app.post('/api/hub/nodes/register', async (c) => {
    const body = RegisterNodeSchema.parse(await c.req.json());
    const db = drizzle(c.env.HUB_DB);
    const did = body.did ?? `did:shac:${body.deploymentId}`;
    const nowIso = new Date(options?.nowMs ? options.nowMs() : Date.now()).toISOString();

    await db
      .insert(hubNodes)
      .values({
        did,
        deploymentId: body.deploymentId,
        companyName: body.companyName,
        region: body.region,
        city: body.city,
        publicKeyJwk: JSON.stringify(body.publicKeyJwk),
        status: body.status,
        createdAt: nowIso,
      })
      .onConflictDoUpdate({
        target: hubNodes.did,
        set: {
          companyName: body.companyName,
          region: body.region,
          city: body.city,
          publicKeyJwk: JSON.stringify(body.publicKeyJwk),
          status: body.status,
        },
      });

    return c.json(
      {
        node: {
          did,
          deploymentId: body.deploymentId,
          companyName: body.companyName,
          region: body.region,
          city: body.city,
          status: body.status,
          createdAt: nowIso,
        },
      },
      201,
    );
  });

  app.post('/api/hub/envelopes', async (c) => {
    const body = await c.req.json();
    const db = drizzle(c.env.HUB_DB);
    const nowMs = options?.nowMs ? options.nowMs() : Date.now();
    const processed = await processHubEnvelope(db, body, nowMs);
    return c.json(processed, processed.status);
  });

  app.post('/api/hub/b2b/find-best-offers', async (c) => {
    const body = FindBestOffersSchema.parse(await c.req.json());
    const db = drizzle(c.env.HUB_DB);
    const result = await findBestOffers(db, body);
    return c.json(result, 200);
  });

  app.get('/api/hub/marketplace/search', async (c) => {
    const rawMaxPrice = c.req.query('maxPriceMinor');
    const rawLimit = c.req.query('limit');
    const query = MarketplaceSearchSchema.parse({
      q: c.req.query('q') || undefined,
      city: c.req.query('city') || undefined,
      region: c.req.query('region') || undefined,
      category: c.req.query('category') || undefined,
      gtin: c.req.query('gtin') || undefined,
      maxPriceMinor: rawMaxPrice !== undefined ? Number(rawMaxPrice) : undefined,
      limit: rawLimit !== undefined ? Number(rawLimit) : undefined,
    });
    const db = drizzle(c.env.HUB_DB);
    const result = await searchMarketplace(db, query);
    return c.json(result, 200);
  });

  app.post('/api/hub/marketplace/hold', async (c) => {
    const body = HoldInventorySchema.parse(await c.req.json());
    const db = drizzle(c.env.HUB_DB);
    const result = await holdInventoryTTL(
      db,
      c.env.HUB_KV,
      body,
    );
    return c.json(result, 201);
  });

  return app;
}
