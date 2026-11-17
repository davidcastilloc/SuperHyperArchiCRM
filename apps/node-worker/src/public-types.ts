import type { ALL_COMMANDS } from './command-registry.js';

export type { AppRouter, WorkerEnv } from './router.js';

export type RpcCommandName = (typeof ALL_COMMANDS)[number]['id'];

export type RpcEnvelopeResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
