import { env } from 'cloudflare:test';
import {
  phyAccessPasses,
  phyDevicesAndLocks,
  phyLockerReservations,
  phyLprPlateEvents,
  phyMediaClips,
  phySmartLockers,
  phyTamperAlerts,
} from '@shac/db-d1';
import { AppError } from '@shac/kernel';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  modPhysicalManifest,
  physicalClipsRecordCommand,
  physicalLprScanCommand,
  physicalPassesIssueCommand,
  physicalPassesValidateCommand,
  physicalTamperReportCommand,
  sha256DigestHex,
  timingSafeEqualStrings,
} from '../src/index.js';
import { makePhysicalCtx, setupPhysicalD1 } from './test-helpers.js';

describe('@shac/mod-physical commands on workerd', () => {
  beforeAll(async () => {
    await setupPhysicalD1(env.DB);
  });

  it('exposes modPhysicalManifest with id physical and 5 MCP-enabled commands', () => {
    expect(modPhysicalManifest.id).toBe('physical');
    expect(modPhysicalManifest.commands.map((c) => c.id)).toEqual([
      'physical.passes.issue',
      'physical.passes.validate',
      'physical.lpr.scan',
      'physical.clips.record',
      'physical.tamper.report',
    ]);
    for (const cmd of modPhysicalManifest.commands) {
      expect(cmd.mcp?.expose).toBe(true);
    }
  });

  it('issues SHA-256 PIN pass, validates in constant time, unlocks lock/locker, and rejects invalid/expired/revoked with 403', async () => {
    expect(timingSafeEqualStrings('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqualStrings('abcdef', 'abcdeg')).toBe(false);
    expect(timingSafeEqualStrings('abc', 'abcd')).toBe(false);

    const { ctx } = makePhysicalCtx(env.DB);
    const now = 1763300000;
    const rawPin = '482910';

    const issued = await physicalPassesIssueCommand.handler(
      ctx,
      physicalPassesIssueCommand.inputSchema.parse({
        clientMutationId: 'pass-issue-1',
        partyId: 'party_1',
        passKind: 'VISITOR_TEMP',
        holderName: 'Elena Visitor',
        licensePlate: 'ab123cd',
        pinOrQrSecret: rawPin,
        allowedDeviceIds: ['dev_lock_1'],
        validFrom: now - 60,
        validUntil: now + 3600,
        maxUses: 2,
      }),
    );

    const expectedHash = await sha256DigestHex(rawPin);
    expect(issued.pinOrQrHash).toBe(expectedHash);
    expect(issued.licensePlate).toBe('AB123CD');
    expect(issued.status).toBe('ACTIVE');

    const storedRows = await ctx.db
      .select()
      .from(phyAccessPasses)
      .where(eq(phyAccessPasses.id, issued.id));
    expect(storedRows[0]?.pinOrQrHash).toBe(expectedHash);

    await expect(
      physicalPassesValidateCommand.handler(
        ctx,
        physicalPassesValidateCommand.inputSchema.parse({
          passId: issued.id,
          deviceId: 'dev_lock_1',
          pinOrQrSecret: '999999',
          nowSec: now,
        }),
      ),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<AppError>);

    await expect(
      physicalPassesValidateCommand.handler(
        ctx,
        physicalPassesValidateCommand.inputSchema.parse({
          passId: issued.id,
          deviceId: 'dev_lock_1',
          pinOrQrSecret: rawPin,
          nowSec: now + 7200,
        }),
      ),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<AppError>);

    const unlocked = await physicalPassesValidateCommand.handler(
      ctx,
      physicalPassesValidateCommand.inputSchema.parse({
        passId: issued.id,
        deviceId: 'dev_lock_1',
        pinOrQrSecret: rawPin,
        nowSec: now,
      }),
    );
    expect(unlocked.valid).toBe(true);
    expect(unlocked.unlockedDeviceId).toBe('dev_lock_1');

    const lockRows = await ctx.db
      .select()
      .from(phyDevicesAndLocks)
      .where(eq(phyDevicesAndLocks.id, 'dev_lock_1'));
    expect(lockRows[0]?.lockState).toBe('UNLOCKED');

    await ctx.db
      .update(phyAccessPasses)
      .set({ status: 'REVOKED' })
      .where(eq(phyAccessPasses.id, issued.id));

    await expect(
      physicalPassesValidateCommand.handler(
        ctx,
        physicalPassesValidateCommand.inputSchema.parse({
          passId: issued.id,
          deviceId: 'dev_lock_1',
          pinOrQrSecret: rawPin,
          nowSec: now,
        }),
      ),
    ).rejects.toMatchObject({ status: 403 } satisfies Partial<AppError>);

    const lockerUnlock = await physicalPassesValidateCommand.handler(
      ctx,
      physicalPassesValidateCommand.inputSchema.parse({
        lockerId: 'locker_1',
        pinOrQrSecret: 'LOCKER-8899',
        nowSec: now,
      }),
    );
    expect(lockerUnlock.valid).toBe(true);
    expect(lockerUnlock.targetKind).toBe('LOCKER_RESERVATION');
    expect(lockerUnlock.unlockedLockerId).toBe('locker_1');

    const resRows = await ctx.db
      .select()
      .from(phyLockerReservations)
      .where(eq(phyLockerReservations.id, 'lres_1'));
    expect(resRows[0]?.status).toBe('PICKED_UP');

    const lockerRows = await ctx.db
      .select()
      .from(phySmartLockers)
      .where(eq(phySmartLockers.id, 'locker_1'));
    expect(lockerRows[0]?.doorState).toBe('OPEN_UNLOCKED');
  });

  it('scans LPR plates (< 15ms check) for whitelisted vs unknown plates and returns doorman notification', async () => {
    const { ctx } = makePhysicalCtx(env.DB);
    const now = 1763300000;

    await physicalPassesIssueCommand.handler(
      ctx,
      physicalPassesIssueCommand.inputSchema.parse({
        clientMutationId: 'pass-lpr-1',
        passKind: 'VIP_LPR',
        holderName: 'VIP Fleet',
        licensePlate: 'VIP-777',
        pinOrQrSecret: 'vip-qr-777',
        validFrom: now - 60,
        validUntil: now + 3600,
      }),
    );

    const granted = await physicalLprScanCommand.handler(
      ctx,
      physicalLprScanCommand.inputSchema.parse({
        clientMutationId: 'lpr-scan-1',
        gateId: 'gate_1',
        licensePlate: 'vip-777',
        confidenceBps: 9850,
        snapshotR2Key: 'lpr/2026/11/vip777.jpg',
        nowSec: now,
      }),
    );

    expect(granted.decision).toBe('GRANTED');
    expect(granted.licensePlate).toBe('VIP-777');
    expect(granted.latencyMs).toBeLessThan(15);
    expect(granted.withinSla).toBe(true);
    expect(granted.doormanNotification.channel).toBe('whatsapp');
    expect(granted.doormanNotification.target).toBe('+584140001122');
    expect(granted.doormanNotification.message).toContain('[LPR GRANTED]');

    const denied = await physicalLprScanCommand.handler(
      ctx,
      physicalLprScanCommand.inputSchema.parse({
        clientMutationId: 'lpr-scan-2',
        gateId: 'GATE-NORTH-01',
        licensePlate: 'UNK-999',
        confidenceBps: 9100,
        nowSec: now,
      }),
    );

    expect(denied.decision).toBe('DENIED');
    expect(denied.passId).toBeNull();
    expect(denied.doormanNotified).toBe(true);
    expect(denied.doormanNotification.message).toContain('[LPR DENIED]');

    const eventRows = await ctx.db
      .select()
      .from(phyLprPlateEvents)
      .where(eq(phyLprPlateEvents.id, denied.id));
    expect(eventRows[0]?.decision).toBe('DENIED');
  });

  it('records R2 media clip with SHA-256 integrity hash and CRITICAL tamper alert', async () => {
    const { ctx } = makePhysicalCtx(env.DB);
    const now = 1763300000;

    const clip = await physicalClipsRecordCommand.handler(
      ctx,
      physicalClipsRecordCommand.inputSchema.parse({
        clientMutationId: 'clip-rec-1',
        cameraDeviceId: 'cam_gate_north',
        clipKind: 'TAMPER_EVIDENCE',
        r2Key: 'evidence/ten_1/2026/11/16/clip-001.mp4',
        integrityPayload: 'raw-mp4-frame-header-bytes-v1',
        durationSec: 12,
        sizeBytes: 409600,
        recordedAt: now,
      }),
    );

    const expectedClipHash = await sha256DigestHex(
      'raw-mp4-frame-header-bytes-v1',
    );
    expect(clip.sha256Hash).toBe(expectedClipHash);
    expect(clip.status).toBe('SEALED');

    const storedClips = await ctx.db
      .select()
      .from(phyMediaClips)
      .where(eq(phyMediaClips.id, clip.id));
    expect(storedClips[0]?.sha256Hash).toBe(expectedClipHash);

    const tamper = await physicalTamperReportCommand.handler(
      ctx,
      physicalTamperReportCommand.inputSchema.parse({
        clientMutationId: 'tamper-rep-1',
        deviceId: 'dev_lock_1',
        alertKind: 'ENCLOSURE_OPEN',
        description: 'Tamper reed switch triggered on smart lock enclosure',
        evidenceClipId: clip.id,
        originSiteDid: 'did:shac:gate-north',
        occurredAt: now,
      }),
    );

    expect(tamper.severity).toBe('CRITICAL');
    expect(tamper.status).toBe('OPEN');
    expect(tamper.evidenceClipId).toBe(clip.id);

    const storedAlerts = await ctx.db
      .select()
      .from(phyTamperAlerts)
      .where(eq(phyTamperAlerts.id, tamper.id));
    expect(storedAlerts[0]?.severity).toBe('CRITICAL');
  });
});
