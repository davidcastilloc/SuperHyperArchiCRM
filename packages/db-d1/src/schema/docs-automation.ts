import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const baseCols = () => ({
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  orgId: text('org_id').notNull(),
});

const tailCols = () => ({
  customFields: text('custom_fields').notNull().default('{}'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export const docAttachments = sqliteTable(
  'doc_attachments',
  {
    ...baseCols(),
    partitionCode: text('partition_code').notNull().default('private_docs'),
    entityType: text('entity_type').notNull(),
    recordId: text('record_id').notNull(),
    partyId: text('party_id'),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull().default(0),
    r2ObjectKey: text('r2_object_key').notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    ocrExtractedText: text('ocr_extracted_text'),
    isConfidential: integer('is_confidential', { mode: 'boolean' }).notNull().default(false),
    uploadedByUserId: text('uploaded_by_user_id').notNull(),
    ...tailCols(),
  },
  (t) => [
    index('doc_att_tenant_org_conf_idx').on(t.tenantId, t.orgId, t.isConfidential),
    index('doc_att_tenant_record_idx').on(t.tenantId, t.entityType, t.recordId),
  ],
);

export const docCollaborativePages = sqliteTable(
  'doc_collaborative_pages',
  {
    ...baseCols(),
    folderId: text('folder_id'),
    title: text('title').notNull(),
    templateId: text('template_id'),
    yjsStateR2Key: text('yjs_state_r2_key'),
    contentHtml: text('content_html'),
    versionNo: integer('version_no').notNull().default(1),
    linkedEntitiesJson: text('linked_entities_json').notNull().default('[]'),
    sharesAclJson: text('shares_acl_json').notNull().default('{}'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    ...tailCols(),
  },
  (t) => [index('doc_pages_tenant_org_idx').on(t.tenantId, t.orgId)],
);

export const docFormsAndSubmissions = sqliteTable(
  'doc_forms_and_submissions',
  {
    ...baseCols(),
    recordKind: text('record_kind').notNull().default('form_submission'),
    formSlug: text('form_slug').notNull(),
    versionNo: integer('version_no').notNull().default(1),
    schemaJson: text('schema_json').notNull().default('{}'),
    partyId: text('party_id'),
    caseOrEncounterId: text('case_or_encounter_id'),
    answersEncryptedJson: text('answers_encrypted_json').notNull().default('{}'),
    clauseSha256: text('clause_sha256'),
    signatureSvg: text('signature_svg'),
    signedByIp: text('signed_by_ip'),
    gdprRetentionUntil: integer('gdpr_retention_until'),
    anonymizedAt: integer('anonymized_at'),
    status: text('status').notNull().default('SUBMITTED'),
    ...tailCols(),
  },
  (t) => [
    index('doc_forms_tenant_slug_idx').on(t.tenantId, t.formSlug),
    index('doc_forms_tenant_party_idx').on(t.tenantId, t.partyId),
  ],
);

export const commChannels = sqliteTable(
  'comm_channels',
  {
    ...baseCols(),
    ownerUserId: text('owner_user_id').notNull(),
    providerKey: text('provider_key').notNull().default('resend'),
    visibility: text('visibility').notNull().default('shared_org'),
    credentialsEncrypted: text('credentials_encrypted').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    ...tailCols(),
  },
  (t) => [index('comm_channels_tenant_org_idx').on(t.tenantId, t.orgId, t.providerKey)],
);

export const commThreadsAndMessages = sqliteTable(
  'comm_threads_and_messages',
  {
    ...baseCols(),
    channelId: text('channel_id'),
    threadKind: text('thread_kind').notNull().default('portal_support'),
    subject: text('subject'),
    partyId: text('party_id'),
    linkedObjectRefJson: text('linked_object_ref_json').notNull().default('{}'),
    sharedWithUserIdsJson: text('shared_with_user_ids_json').notNull().default('[]'),
    senderId: text('sender_id').notNull(),
    senderType: text('sender_type').notNull().default('staff'),
    body: text('body').notNull(),
    attachmentsJson: text('attachments_json').notNull().default('[]'),
    readByJson: text('read_by_json').notNull().default('[]'),
    isConfidential: integer('is_confidential', { mode: 'boolean' }).notNull().default(false),
    sentAt: integer('sent_at').notNull(),
    ...tailCols(),
  },
  (t) => [
    index('comm_threads_tenant_org_conf_idx').on(t.tenantId, t.orgId, t.isConfidential),
    index('comm_threads_tenant_party_idx').on(t.tenantId, t.partyId, t.sentAt),
  ],
);

export const commVoiceAiAndCalls = sqliteTable(
  'comm_voice_ai_and_calls',
  {
    ...baseCols(),
    recordKind: text('record_kind').notNull().default('phone_call_log'),
    agentName: text('agent_name'),
    phoneNumber: text('phone_number').notNull(),
    voiceModel: text('voice_model'),
    systemPrompt: text('system_prompt'),
    transferNumber: text('transfer_number'),
    partyId: text('party_id'),
    direction: text('direction').notNull().default('inbound'),
    durationSec: integer('duration_sec').notNull().default(0),
    recordingR2Key: text('recording_r2_key'),
    transcript: text('transcript'),
    aiExtractedIntentJson: text('ai_extracted_intent_json').notNull().default('{}'),
    campaignLeadsJson: text('campaign_leads_json').notNull().default('[]'),
    status: text('status').notNull().default('COMPLETED'),
    ...tailCols(),
  },
  (t) => [index('comm_voice_tenant_org_kind_idx').on(t.tenantId, t.orgId, t.recordKind)],
);

export const commNotifications = sqliteTable(
  'comm_notifications',
  {
    ...baseCols(),
    recipientUserId: text('recipient_user_id').notNull(),
    notificationType: text('notification_type').notNull(),
    severity: text('severity').notNull().default('INFO'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    actionUrl: text('action_url'),
    channelsJson: text('channels_json').notNull().default('["in_app"]'),
    readAt: integer('read_at'),
    actionedAt: integer('actioned_at'),
    ...tailCols(),
  },
  (t) => [index('comm_notif_tenant_user_idx').on(t.tenantId, t.recipientUserId, t.readAt)],
);

export const autoBusinessRules = sqliteTable(
  'auto_business_rules',
  {
    ...baseCols(),
    ruleCode: text('rule_code').notNull(),
    name: text('name').notNull(),
    ruleKind: text('rule_kind').notNull().default('ACTION'),
    entityType: text('entity_type').notNull(),
    lifecycleEvent: text('lifecycle_event').notNull(),
    priority: integer('priority').notNull().default(100),
    conditionAstJson: text('condition_ast_json').notNull().default('{}'),
    actionsJson: text('actions_json').notNull().default('[]'),
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    ...tailCols(),
  },
  (t) => [
    uniqueIndex('auto_rules_tenant_code_uniq').on(t.tenantId, t.ruleCode),
    index('auto_rules_tenant_org_event_idx').on(t.tenantId, t.orgId, t.entityType, t.lifecycleEvent),
  ],
);

export const autoWorkflows = sqliteTable(
  'auto_workflows',
  {
    ...baseCols(),
    workflowCode: text('workflow_code').notNull(),
    versionNo: integer('version_no').notNull().default(1),
    definitionGraphJson: text('definition_graph_json').notNull().default('{}'),
    eventTriggersJson: text('event_triggers_json').notNull().default('[]'),
    isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    ...tailCols(),
  },
  (t) => [uniqueIndex('auto_wf_tenant_code_ver_uniq').on(t.tenantId, t.workflowCode, t.versionNo)],
);

export const autoWorkflowInstancesAndTasks = sqliteTable(
  'auto_workflow_instances_and_tasks',
  {
    ...baseCols(),
    workflowId: text('workflow_id').notNull(),
    correlationKey: text('correlation_key').notNull(),
    currentStepId: text('current_step_id').notNull(),
    contextJson: text('context_json').notNull().default('{}'),
    userTasksJson: text('user_tasks_json').notNull().default('[]'),
    status: text('status').notNull().default('running'),
    ...tailCols(),
  },
  (t) => [
    index('auto_wfi_tenant_wf_status_idx').on(t.tenantId, t.workflowId, t.status),
    index('auto_wfi_tenant_corr_idx').on(t.tenantId, t.correlationKey),
  ],
);

export const autoInboxOps = sqliteTable(
  'auto_inbox_ops',
  {
    ...baseCols(),
    channelId: text('channel_id'),
    senderEmailOrHandle: text('sender_email_or_handle').notNull(),
    subject: text('subject').notNull(),
    rawBody: text('raw_body').notNull(),
    extractedIntent: text('extracted_intent'),
    extractedEntitiesJson: text('extracted_entities_json').notNull().default('{}'),
    proposalId: text('proposal_id'),
    status: text('status').notNull().default('NEW'),
    ...tailCols(),
  },
  (t) => [index('auto_inbox_tenant_org_status_idx').on(t.tenantId, t.orgId, t.status)],
);

export const kernelAiProposals = sqliteTable(
  'kernel_ai_proposals',
  {
    ...baseCols(),
    recordKind: text('record_kind').notNull().default('mutation_proposal_card'),
    ownerUserId: text('owner_user_id').notNull(),
    agentId: text('agent_id').notNull(),
    modelId: text('model_id').notNull(),
    messagesOrEmailJson: text('messages_or_email_json').notNull().default('[]'),
    targetCommandId: text('target_command_id').notNull(),
    targetRecordId: text('target_record_id'),
    proposedDiffJson: text('proposed_diff_json').notNull().default('{}'),
    confidenceBps: integer('confidence_bps').notNull().default(0),
    disposition: text('disposition').notNull().default('PENDING'),
    resolvedByUserId: text('resolved_by_user_id'),
    executedAt: integer('executed_at'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costMinor: integer('cost_minor').notNull().default(0),
    ...tailCols(),
  },
  (t) => [
    index('kernel_ai_prop_tenant_org_disp_idx').on(t.tenantId, t.orgId, t.disposition),
    index('kernel_ai_prop_tenant_owner_idx').on(t.tenantId, t.ownerUserId),
  ],
);

export const intWebhooksAndSyncJobs = sqliteTable(
  'int_webhooks_and_sync_jobs',
  {
    ...baseCols(),
    recordKind: text('record_kind').notNull().default('webhook_endpoint'),
    providerOrUrl: text('provider_or_url').notNull(),
    hmacSecretEnc: text('hmac_secret_enc'),
    subscribedEventsJson: text('subscribed_events_json').notNull().default('[]'),
    cursorState: text('cursor_state'),
    fieldMappingJson: text('field_mapping_json').notNull().default('{}'),
    processedCount: integer('processed_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    lastError: text('last_error'),
    status: text('status').notNull().default('ACTIVE'),
    ...tailCols(),
  },
  (t) => [index('int_wh_tenant_org_kind_idx').on(t.tenantId, t.orgId, t.recordKind)],
);
