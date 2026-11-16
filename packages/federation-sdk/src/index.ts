export {
  ANTI_REPLAY_WINDOW_MS,
  FederationEnvelopeSchema,
  FederationEventTypeSchema,
  canonicalJson,
  computePayloadSha256Hex,
  signFederationEnvelope,
  verifyFederationEnvelope,
  type FederationEnvelope,
  type FederationEventType,
  type SignFederationEnvelopeInput,
} from './envelope.js';

export {
  FORBIDDEN_PUBLIC_OFFER_FIELDS,
  assertPublicOfferSafe,
  convertPackQtyToBaseUnits,
  matchCatalogItem,
  normalizeGtin,
  type CatalogMappingEntry,
  type CatalogMatchQuery,
  type CatalogMatchResult,
} from './catalog-matcher.js';

export {
  DEFAULT_CONSOLIDATION_WINDOW_MS,
  consolidatePendingRestocks,
  evaluateReorderTrigger,
  type ConsolidatedRestockBatch,
  type PendingRestockItem,
  type ReorderTriggerDecision,
  type ReorderTriggerInput,
} from './consolidation-buffer.js';
