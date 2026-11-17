import { describe, expect, it } from 'vitest';
import {
  parseRealtimeTopicsToTags,
  serializeRealtimeFrame,
  shouldDeliverToSocketTags,
} from '../src/index.js';

describe('@shac/actor-branch realtime-hub', () => {
  it('serializes realtime frames and filters socket tags by topic', () => {
    const frame = serializeRealtimeFrame({
      branchId: 'br_1',
      seqId: 7,
      topic: 'pos',
      eventType: 'pos.checkout',
      entityId: 'ord_1',
      occurredAtMs: 12345,
      payload: { totalMinor: 1500 },
    });
    expect(JSON.parse(frame)).toMatchObject({
      branchId: 'br_1',
      seqId: 7,
      topic: 'pos',
      eventType: 'pos.checkout',
    });

    expect(shouldDeliverToSocketTags(['topic:all'], 'pos')).toBe(true);
    expect(shouldDeliverToSocketTags(['topic:pos'], 'all')).toBe(true);
    expect(shouldDeliverToSocketTags(['topic:pos'], 'pos')).toBe(true);
    expect(shouldDeliverToSocketTags(['topic:spaces'], 'pos')).toBe(false);

    expect(parseRealtimeTopicsToTags('pos,spaces')).toEqual(['topic:pos', 'topic:spaces']);
    expect(parseRealtimeTopicsToTags(null)).toEqual(['topic:all']);
  });
});
