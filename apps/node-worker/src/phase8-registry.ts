import type { ShacD1Database } from '@shac/db-d1';
import type { CommandSpec, ProfileLoader } from '@shac/kernel';
import {
  modPhysicalManifest,
  physicalClipsRecordCommand,
  physicalLprScanCommand,
  physicalPassesIssueCommand,
  physicalPassesValidateCommand,
  physicalTamperReportCommand,
} from '@shac/mod-physical';
import { Hono } from 'hono';
import { jsonCommandHandler, type HonoEnv } from './command-registry.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PHASE8_COMMANDS: readonly CommandSpec<any, any, ShacD1Database>[] =
  [...modPhysicalManifest.commands];

/** Mounts /api/physical/* RPC routes with full Hono type inference. */
export function createPhysicalRoutes(profileLoader: ProfileLoader) {
  return new Hono<HonoEnv>()
    .post(
      '/passes/issue',
      jsonCommandHandler(physicalPassesIssueCommand, profileLoader),
    )
    .post(
      '/passes/validate',
      jsonCommandHandler(physicalPassesValidateCommand, profileLoader),
    )
    .post(
      '/lpr/scan',
      jsonCommandHandler(physicalLprScanCommand, profileLoader),
    )
    .post(
      '/clips',
      jsonCommandHandler(physicalClipsRecordCommand, profileLoader),
    )
    .post(
      '/tamper',
      jsonCommandHandler(physicalTamperReportCommand, profileLoader),
    );
}
