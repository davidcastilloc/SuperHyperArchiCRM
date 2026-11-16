import {
  commThreadsAndMessages,
  docAttachments,
  type ShacD1Database,
} from '@shac/db-d1';
import { defineCommand } from '@shac/kernel';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { resolveScopedTargetOrg } from '../lib/scope-helpers.js';

const portalRecordsListInputSchema = z.object({
  orgId: z.string().min(1).optional(),
  partyId: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

const portalAttachmentSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  partitionCode: z.string(),
  entityType: z.string(),
  recordId: z.string(),
  partyId: z.string().nullable(),
  fileName: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number().int(),
  isConfidential: z.literal(false),
  createdAt: z.number().int(),
});

const portalMessageSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  threadKind: z.string(),
  subject: z.string().nullable(),
  partyId: z.string().nullable(),
  senderId: z.string(),
  senderType: z.string(),
  body: z.string(),
  isConfidential: z.literal(false),
  sentAt: z.number().int(),
});

const portalRecordsListOutputSchema = z.object({
  orgId: z.string(),
  attachments: z.array(portalAttachmentSchema),
  messages: z.array(portalMessageSchema),
});

export const portalRecordsListCommand = defineCommand<
  typeof portalRecordsListInputSchema,
  z.infer<typeof portalRecordsListOutputSchema>,
  ShacD1Database
>({
  id: 'portal.records.list',
  moduleId: 'portal',
  method: 'GET',
  path: '/api/portal/records',
  summary:
    'List non-confidential portal attachments and communication messages in <= 2 D1 batch queries',
  requiredPermission: 'portal.records.read',
  mcp: {
    expose: true,
    readOnlyHint: true,
    description:
      'Query doc_attachments and comm_threads_and_messages with strict SQL is_confidential = 0 filter',
  },
  inputSchema: portalRecordsListInputSchema,
  outputSchema: portalRecordsListOutputSchema,
  async handler(ctx, input) {
    const targetOrgId = await resolveScopedTargetOrg(ctx, input.orgId);

    // Strict SQL is_confidential = 0 (eq(..., false)) ensures confidential PHI/legal records are never fetched.
    const docConditions = [
      eq(docAttachments.tenantId, ctx.tenantId),
      eq(docAttachments.orgId, targetOrgId),
      eq(docAttachments.isConfidential, false),
      isNull(docAttachments.deletedAt),
    ];
    if (input.partyId) {
      docConditions.push(eq(docAttachments.partyId, input.partyId));
    }
    if (input.entityType) {
      docConditions.push(eq(docAttachments.entityType, input.entityType));
    }

    const msgConditions = [
      eq(commThreadsAndMessages.tenantId, ctx.tenantId),
      eq(commThreadsAndMessages.orgId, targetOrgId),
      eq(commThreadsAndMessages.isConfidential, false),
      isNull(commThreadsAndMessages.deletedAt),
    ];
    if (input.partyId) {
      msgConditions.push(eq(commThreadsAndMessages.partyId, input.partyId));
    }

    const [attachmentRows, messageRows] = await ctx.db.batch([
      ctx.db
        .select({
          id: docAttachments.id,
          orgId: docAttachments.orgId,
          partitionCode: docAttachments.partitionCode,
          entityType: docAttachments.entityType,
          recordId: docAttachments.recordId,
          partyId: docAttachments.partyId,
          fileName: docAttachments.fileName,
          mimeType: docAttachments.mimeType,
          fileSizeBytes: docAttachments.fileSizeBytes,
          isConfidential: docAttachments.isConfidential,
          createdAt: docAttachments.createdAt,
        })
        .from(docAttachments)
        .where(and(...docConditions))
        .orderBy(desc(docAttachments.createdAt))
        .limit(input.limit),
      ctx.db
        .select({
          id: commThreadsAndMessages.id,
          orgId: commThreadsAndMessages.orgId,
          threadKind: commThreadsAndMessages.threadKind,
          subject: commThreadsAndMessages.subject,
          partyId: commThreadsAndMessages.partyId,
          senderId: commThreadsAndMessages.senderId,
          senderType: commThreadsAndMessages.senderType,
          body: commThreadsAndMessages.body,
          isConfidential: commThreadsAndMessages.isConfidential,
          sentAt: commThreadsAndMessages.sentAt,
        })
        .from(commThreadsAndMessages)
        .where(and(...msgConditions))
        .orderBy(desc(commThreadsAndMessages.sentAt))
        .limit(input.limit),
    ]);

    return {
      orgId: targetOrgId,
      attachments: attachmentRows.map((row) => ({
        ...row,
        isConfidential: false as const,
      })),
      messages: messageRows.map((row) => ({
        ...row,
        isConfidential: false as const,
      })),
    };
  },
});
