import type { MiddlewareHandler } from 'hono';

export interface CorsEnv {
  CORS_ALLOWED_ORIGINS?: string;
}

const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOW_HEADERS =
  'Content-Type, Authorization, X-API-Key, X-Tenant-Id, X-Org-Id, X-Client-Mutation-Id, If-Match';
const EXPOSE_HEADERS = 'X-Request-Id, ETag, X-SHAC-Mode';

function isOriginAllowed(origin: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === origin) return true;
    const wildcardIdx = pattern.indexOf('*.');
    if (wildcardIdx > 0) {
      const prefix = pattern.slice(0, wildcardIdx);
      const suffix = pattern.slice(wildcardIdx + 1); // ".domain.tld"
      if (
        origin.startsWith(prefix) &&
        origin.endsWith(suffix) &&
        origin.length > prefix.length + suffix.length
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Adaptive CORS middleware governed by CORS_ALLOWED_ORIGINS.
 * Responds to OPTIONS preflight in < 0.2 ms without touching KV or D1.
 */
export function createAdaptiveCorsMiddleware<
  T extends { Bindings: CorsEnv },
>(staticEnv?: CorsEnv): MiddlewareHandler<T> {
  return async (c, next) => {
    const raw =
      staticEnv?.CORS_ALLOWED_ORIGINS ?? c.env.CORS_ALLOWED_ORIGINS ?? '';
    const patterns = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const origin = c.req.header('Origin');
    const allowed =
      origin !== undefined &&
      patterns.length > 0 &&
      isOriginAllowed(origin, patterns);

    if (allowed) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Methods', ALLOW_METHODS);
      c.header('Access-Control-Allow-Headers', ALLOW_HEADERS);
      c.header('Access-Control-Expose-Headers', EXPOSE_HEADERS);
      c.header('Access-Control-Max-Age', '86400');
    }

    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }

    await next();
  };
}
