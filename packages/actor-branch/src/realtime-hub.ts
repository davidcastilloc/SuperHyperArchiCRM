export type RealtimeTopic = 'pos' | 'spaces' | 'wms' | 'helios' | 'all';

export interface BranchRealtimeEvent<TPayload = unknown> {
  readonly branchId: string;
  readonly seqId: number;
  readonly topic: RealtimeTopic;
  readonly eventType: string;
  readonly entityId: string;
  readonly occurredAtMs: number;
  readonly payload: TPayload;
}

const VALID_TOPICS = new Set<string>(['pos', 'spaces', 'wms', 'helios', 'all']);

export function parseRealtimeTopicsToTags(rawTopics: string | null | undefined): string[] {
  if (!rawTopics || rawTopics.trim() === '') {
    return ['topic:all'];
  }
  const tags = rawTopics
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => VALID_TOPICS.has(t))
    .map((t) => `topic:${t}`);
  return tags.length > 0 ? tags : ['topic:all'];
}

export function serializeRealtimeFrame<TPayload>(
  event: BranchRealtimeEvent<TPayload>,
): string {
  return JSON.stringify(event);
}

export function shouldDeliverToSocketTags(
  socketTags: readonly string[],
  eventTopic: RealtimeTopic,
): boolean {
  if (socketTags.includes('topic:all') || eventTopic === 'all') return true;
  return socketTags.includes(`topic:${eventTopic}`);
}
